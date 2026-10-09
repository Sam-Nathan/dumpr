import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, type TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithProvider, type OAuthProvider } from '@/features/auth/oauth';
import { continueAsGuest, sendPhoneOtp, verifyPhoneOtp } from '@/features/auth/phone';
import { usePendingInvite } from '@/features/invites/pendingInvite';
import { errorCopy, toAppError } from '@/lib/errors';
import { formatResend } from '@/lib/format';
import {
  type Country,
  COUNTRIES,
  DEFAULT_COUNTRY,
  formatInternational,
  formatNational,
  isValidNational,
  nationalDigits,
  toE164,
} from '@/lib/phone';
import {
  Button,
  haptic,
  Icon,
  IconButton,
  OtpBoxes,
  PressableScale,
  Screen,
  Text,
  TextField,
  useColors,
} from '@/ui';

const RESEND_SECONDS = 30;
const MAX_TRIES = 3;

/** Seconds countdown that survives re-renders. */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

/**
 * A2 Phone sign-in. +91 default, numeric field, 6-box OTP (iOS one-time-code / Android SMS autofill),
 * resend timer 30 s in mono, wrong code shake + tries left, rate-limit wait. Apple / Google via web
 * OAuth. "Continue as guest" only with a pending invite that allows guests.
 */
export default function PhoneSignIn() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const login = mode === 'login';
  const colors = useColors();
  const pending = usePendingInvite((s) => s.pending);

  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [picker, setPicker] = useState(false);
  const [digits, setDigits] = useState('');
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [triesLeft, setTriesLeft] = useState(MAX_TRIES);
  const [shakeKey, setShakeKey] = useState(0);
  const [resendIn, setResendIn] = useCountdown();
  const [waitIn, setWaitIn] = useCountdown();
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | 'guest' | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const numberRef = useRef<TextInput>(null);

  const valid = isValidNational(digits, country);
  const e164 = toE164(digits, country);

  const send = async () => {
    if (!valid || sending || waitIn > 0) return;
    setSending(true);
    setError(null);
    try {
      await sendPhoneOtp(e164);
      setStep('code');
      setCode('');
      setCodeError(null);
      setTriesLeft(MAX_TRIES);
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'rate_limited') {
        setWaitIn(60);
        setError('Too many codes asked for. Try again when the timer ends.');
      } else {
        setError(errorCopy(err.code).message);
      }
    } finally {
      setSending(false);
    }
  };

  const verify = async (token = code) => {
    if (token.length !== 6 || verifying || triesLeft <= 0) return;
    setVerifying(true);
    setCodeError(null);
    try {
      resumeInvite();
      await verifyPhoneOtp(e164, token);
      haptic.success();
      // The root gate moves on (A3 or Home) once the session arrives.
    } catch (e) {
      usePendingInvite.getState().setAutoJoin(false);
      const err = toAppError(e);
      if (err.code === 'otp_invalid' || err.code === 'otp_expired') {
        const left = triesLeft - 1;
        setTriesLeft(left);
        setShakeKey((k) => k + 1);
        setCode('');
        setCodeError(
          left > 0
            ? `Code didn't match — ${left} ${left === 1 ? 'try' : 'tries'} left`
            : 'That code has run out of tries. Send a new one and we’ll start fresh.',
        );
      } else if (err.code === 'rate_limited') {
        setWaitIn(60);
        setCodeError('Too many tries in a row. Take a breather and try again when the timer ends.');
      } else {
        setCodeError(errorCopy(err.code).message);
      }
    } finally {
      setVerifying(false);
    }
  };

  /** After any successful sign-in with an invite waiting, the gate opens A4 once sign-up is done. */
  const resumeInvite = () => {
    if (usePendingInvite.getState().pending) usePendingInvite.getState().setAutoJoin(true);
  };

  const oauth = async (provider: OAuthProvider) => {
    if (oauthBusy) return;
    setOauthBusy(provider);
    setOauthError(null);
    try {
      if (await signInWithProvider(provider)) resumeInvite();
    } catch (e) {
      setOauthError(errorCopy(toAppError(e).code).message);
    } finally {
      setOauthBusy(null);
    }
  };

  const guest = async () => {
    setOauthBusy('guest');
    setOauthError(null);
    // Guests skip A3; the gate resumes the invite (autoJoin) and lands in the Roll.
    resumeInvite();
    try {
      await continueAsGuest();
    } catch (e) {
      usePendingInvite.getState().setAutoJoin(false);
      setOauthError(errorCopy(toAppError(e).code).message);
    } finally {
      setOauthBusy(null);
    }
  };

  const editNumber = () => {
    setStep('number');
    setCode('');
    setCodeError(null);
    setTimeout(() => numberRef.current?.focus(), 50);
  };

  const primary =
    step === 'number' ? (
      <Button
        label={waitIn > 0 ? `Try again in ${formatResend(waitIn)}` : 'Send code'}
        variant="primary"
        size="lg"
        loading={sending}
        disabled={!valid || waitIn > 0}
        disabledReason={
          waitIn > 0
            ? 'Codes are paused for a moment.'
            : `Enter your ${country.lengths[0]}-digit number`
        }
        onPress={() => void send()}
      />
    ) : (
      <Button
        label="Verify"
        variant="primary"
        size="lg"
        loading={verifying}
        disabled={code.length !== 6 || triesLeft <= 0 || waitIn > 0}
        disabledReason={
          triesLeft <= 0
            ? 'Send a new code to try again'
            : waitIn > 0
              ? `Try again in ${formatResend(waitIn)}`
              : 'Enter the 6-digit code'
        }
        onPress={() => void verify()}
      />
    );

  return (
    <Screen
      scroll
      header={{
        back: true,
        onBack: step === 'code' ? editNumber : undefined,
        right: (
          <Text variant="stamp" tone="tertiary" className="text-[11px]">
            {login ? 'LOG IN' : 'STEP 1 OF 2'}
          </Text>
        ),
      }}
      onHardwareBack={step === 'code' ? () => (editNumber(), true) : undefined}
      footer={
        <View className="gap-3">
          {primary}
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-line dark:bg-line-dark" />
            <Text variant="caption">or</Text>
            <View className="h-px flex-1 bg-line dark:bg-line-dark" />
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button
                label="Apple"
                variant="secondary"
                fullWidth
                loading={oauthBusy === 'apple'}
                onPress={() => void oauth('apple')}
                accessibilityHint="Continue with Apple"
              />
            </View>
            <View className="flex-1">
              <Button
                label="Google"
                variant="secondary"
                fullWidth
                loading={oauthBusy === 'google'}
                onPress={() => void oauth('google')}
                accessibilityHint="Continue with Google"
              />
            </View>
          </View>
          {oauthError ? (
            <Text
              variant="caption"
              tone="danger"
              className="text-center"
              accessibilityLiveRegion="polite"
            >
              {oauthError}
            </Text>
          ) : null}
          {pending?.allowGuests ? (
            <Button
              label="Continue as guest"
              variant="tertiary"
              fullWidth
              loading={oauthBusy === 'guest'}
              accessibilityHint={`Join ${pending.title ?? 'the Roll'} without an account`}
              onPress={() => void guest()}
            />
          ) : null}
        </View>
      }
    >
      <Text variant="title" heading className="mt-2 text-[32px] leading-[35px]">
        {login ? 'Welcome back' : "What's your number?"}
      </Text>
      <Text variant="body" className="mt-2">
        We&rsquo;ll text a 6-digit code. Your number is never shown to Crews unless you allow it.
      </Text>

      <Text variant="caption" tone="secondary" className="mb-1.5 mt-6 font-body-semibold">
        Mobile number
      </Text>
      <View className="flex-row gap-2">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Country: ${country.name}, plus ${country.dial}. Change`}
          onPress={() => setPicker(true)}
          disabled={step === 'code'}
          className="h-[52px] flex-row items-center gap-1.5 rounded-input border border-line bg-surface px-3.5 dark:border-line-dark dark:bg-surface-dark"
        >
          <Text variant="body" tone="default" className="font-body-semibold">
            {country.iso} +{country.dial}
          </Text>
          <Icon name="chevronDown" size={16} color={colors.ink2} />
        </PressableScale>
        <View className="flex-1">
          <TextField
            ref={numberRef}
            value={formatNational(digits, country)}
            onChangeText={(t) => {
              setDigits(nationalDigits(t, country));
              setError(null);
            }}
            placeholder={country.iso === 'IN' ? '98450 12345' : 'Phone number'}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            autoFocus
            editable={step === 'number'}
            accessibilityLabel="Mobile number"
            returnKeyType="send"
            onSubmitEditing={() => void send()}
          />
        </View>
      </View>
      {error ? (
        <Text variant="caption" tone="danger" className="mt-1.5" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {step === 'code' ? (
        <View className="mt-5 rounded-card border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark">
          <View className="mb-3 flex-row items-center justify-between">
            <Text variant="body" tone="default" className="flex-1 font-body-semibold">
              Code sent to {formatInternational(digits, country)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit number"
              hitSlop={12}
              onPress={editNumber}
            >
              <Text variant="body" tone="default" className="font-body-bold underline">
                Edit
              </Text>
            </Pressable>
          </View>
          <OtpBoxes
            value={code}
            onChange={(v) => {
              setCode(v);
              if (codeError && triesLeft > 0) setCodeError(null);
            }}
            onComplete={(c) => void verify(c)}
            error={!!codeError}
            shakeKey={shakeKey}
            disabled={verifying || triesLeft <= 0}
          />
          {codeError ? (
            <Text variant="caption" tone="danger" className="mt-2" accessibilityLiveRegion="polite">
              {codeError}
            </Text>
          ) : null}
          <View className="mt-3 flex-row items-center justify-between">
            {resendIn > 0 ? (
              <Text variant="stamp" tone="tertiary" className="text-[11px]">
                AUTO-READING SMS · RESEND IN {formatResend(resendIn)}
              </Text>
            ) : (
              <Button
                label={sending ? 'Sending…' : 'Resend code'}
                variant="tertiary"
                size="sm"
                loading={sending}
                disabled={waitIn > 0}
                disabledReason={`Wait ${formatResend(waitIn)}`}
                onPress={() => void send()}
              />
            )}
          </View>
        </View>
      ) : null}

      <CountryPicker
        visible={picker}
        selected={country}
        onClose={() => setPicker(false)}
        onPick={(c) => {
          setCountry(c);
          setDigits((d) => nationalDigits(d, c));
          setPicker(false);
        }}
      />
    </Screen>
  );
}

function CountryPicker({
  visible,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: Country;
  onPick: (c: Country) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={onClose} />
        <View
          className="rounded-t-sheet bg-paper px-5 pt-4 dark:bg-paper-dark"
          style={{ paddingBottom: Math.max(insets.bottom, 16), maxHeight: '70%' }}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <Text variant="title" heading>
              Country
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          <FlatList
            data={COUNTRIES}
            keyExtractor={(c) => c.iso}
            renderItem={({ item }) => (
              <PressableScale
                accessibilityRole="button"
                accessibilityState={{ selected: item.iso === selected.iso }}
                accessibilityLabel={`${item.name}, plus ${item.dial}`}
                onPress={() => onPick(item)}
                className="min-h-[52px] flex-row items-center justify-between border-b border-line dark:border-line-dark"
              >
                <Text variant="body" tone="default">
                  {item.name}
                </Text>
                <View className="flex-row items-center gap-3">
                  <Text variant="body" tone="tertiary" className="font-mono">
                    +{item.dial}
                  </Text>
                  {item.iso === selected.iso ? (
                    <Icon name="check" size={18} color={colors.ink} />
                  ) : (
                    <View style={{ width: 18 }} />
                  )}
                </View>
              </PressableScale>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
