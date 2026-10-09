import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inviteHref, parseInviteLink } from '../../lib/deeplinks';
import {
  Button,
  haptic,
  IconButton,
  PermissionPrimer,
  Text,
  TextField,
  toPermissionOutcome,
} from '../../ui';

export interface InviteLinkSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "I have an invite link": paste a dumpr.app link / code, or scan a QR (camera behind the A6 primer).
 * Opens A4 (`/invite/<code>`) for anything that parses.
 */
export function InviteLinkSheet({ visible, onClose }: InviteLinkSheetProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'paste' | 'primer' | 'scan'>('paste');
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const handled = useRef(false);

  const close = () => {
    setMode('paste');
    setError(null);
    setText('');
    onClose();
  };

  const open = (value: string) => {
    const parsed = parseInviteLink(value);
    if (!parsed) {
      setError("That doesn't look like a Dumpr link. Paste the whole link, or just the code.");
      return false;
    }
    haptic.success();
    close();
    router.push(inviteHref(parsed.code));
    return true;
  };

  const paste = async () => {
    try {
      const value = await Clipboard.getStringAsync();
      setText(value);
      if (value) open(value);
      else setError('Nothing to paste yet. Copy the link from WhatsApp or SMS first.');
    } catch {
      setError('We could not read the clipboard. Long-press the field to paste.');
    }
  };

  const startScan = () => {
    handled.current = false;
    setError(null);
    setMode(permission?.granted ? 'scan' : 'primer');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={close} />
        <View
          className="rounded-t-sheet bg-paper px-5 pt-3 dark:bg-paper-dark"
          style={{ paddingBottom: Math.max(insets.bottom, 16), maxHeight: '92%' }}
        >
          <View className="mb-2 items-center">
            <View className="h-1.5 w-10 rounded-pill bg-line dark:bg-line-dark" />
          </View>
          <View className="mb-4 flex-row items-center justify-between">
            <Text variant="title" heading>
              {mode === 'scan' ? 'Scan the QR code' : 'Open an invite'}
            </Text>
            <IconButton icon="close" label="Close" onPress={close} />
          </View>

          {mode === 'paste' ? (
            <View className="gap-3">
              <Text variant="body">
                Paste the link a friend sent you (dumpr.app/r/...) or type the code.
              </Text>
              <TextField
                label="Invite link or code"
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  setError(null);
                }}
                placeholder="dumpr.app/r/k7qm2xpa9d"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={() => open(text)}
                error={error}
              />
              <Button
                label="Open invite"
                variant="primary"
                size="lg"
                disabled={!text.trim()}
                disabledReason="Paste or type a link first"
                onPress={() => open(text)}
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Button label="Paste" icon="copy" fullWidth onPress={() => void paste()} />
                </View>
                <View className="flex-1">
                  <Button label="Scan QR" icon="scan" fullWidth onPress={startScan} />
                </View>
              </View>
            </View>
          ) : null}

          {mode === 'primer' ? (
            <View style={{ minHeight: 560 }}>
              <PermissionPrimer
                kind="camera"
                initialDenied={permission ? !permission.granted && !permission.canAskAgain : false}
                request={async () => toPermissionOutcome(await requestPermission())}
                check={async () => toPermissionOutcome(await getPermission())}
                onGranted={() => setMode('scan')}
                onNotNow={() => setMode('paste')}
                onPickManually={() => setMode('paste')}
                pickManuallyLabel="Paste the link instead"
              />
            </View>
          ) : null}

          {mode === 'scan' ? (
            <View className="gap-3">
              <View className="overflow-hidden rounded-card" style={{ aspectRatio: 1 }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => {
                    if (handled.current) return;
                    if (parseInviteLink(data)) {
                      handled.current = true;
                      open(data);
                    } else {
                      setError("That QR code isn't a Dumpr invite.");
                    }
                  }}
                />
              </View>
              {error ? (
                <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : (
                <Text variant="caption">Point at the QR on your friend's phone.</Text>
              )}
              <Button
                label="Paste a link instead"
                variant="tertiary"
                fullWidth
                onPress={() => setMode('paste')}
              />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
