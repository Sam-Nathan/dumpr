import { Fragment, useCallback, useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { Button } from './Button';
import { EdgeState } from './EdgeState';
import { edge } from './edgePresets';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { FLASH, INK, useColors } from './theme';

/** What the OS prompt resolved to. 'blocked' = denied and the OS will not ask again. */
export type PermissionOutcome = 'granted' | 'limited' | 'denied' | 'blocked';

export type PrimerKind = 'photos' | 'camera' | 'contacts' | 'notifications';

/** Map an expo permission response to a PermissionOutcome. */
export function toPermissionOutcome(r: {
  granted: boolean;
  canAskAgain?: boolean;
  accessPrivileges?: 'all' | 'limited' | 'none';
}): PermissionOutcome {
  if (r.granted) return r.accessPrivileges === 'limited' ? 'limited' : 'granted';
  return r.canAskAgain === false ? 'blocked' : 'denied';
}

type Part = string | { b: string };

interface PrimerCopy {
  title: string;
  subtitle: string;
  bullets: { icon: IconName; parts: Part[] }[];
  allow: string;
  illustrationLabel: string;
  illustrationIcon: IconName;
}

export function primerCopy(kind: PrimerKind, ctx?: { rollName?: string; dates?: string }): PrimerCopy {
  switch (kind) {
    case 'photos':
      return {
        title: ctx?.rollName ? `Let Dumpr find your ${ctx.rollName} photos` : 'Let Dumpr find your photos',
        subtitle: "Your phone will ask next. Here's exactly what that means.",
        bullets: [
          {
            icon: 'clock',
            parts: [
              'We only read dates and places to suggest photos from ',
              { b: ctx?.dates ? `this Roll's dates (${ctx.dates})` : "this Roll's dates" },
              '.',
            ],
          },
          { icon: 'upload', parts: ['Nothing uploads until ', { b: 'you tap Add' }, '. You review every photo first.'] },
          {
            icon: 'lock',
            parts: ['Prefer tighter control? Choose ', { b: 'Select photos' }, ' — everything still works.'],
          },
        ],
        allow: 'Allow access',
        illustrationLabel: ctx?.dates ? `4 FROM ${ctx.dates.toUpperCase()}` : '4 FROM THIS WEEKEND',
        illustrationIcon: 'image',
      };
    case 'camera':
      return {
        title: 'Let Dumpr use your camera',
        subtitle: "Your phone will ask next. Here's exactly what that means.",
        bullets: [
          { icon: 'camera', parts: ['The camera opens ', { b: 'only when you open it' }, '. Nothing is captured in the background.'] },
          { icon: 'upload', parts: ['A shot goes to your Roll ', { b: 'when you tap the shutter' }, ', with a 5 second Undo.'] },
          { icon: 'image', parts: ['Rather not? ', { b: 'Add from your gallery' }, ' instead — everything still works.'] },
        ],
        allow: 'Allow camera',
        illustrationLabel: 'YOUR SHOT #1',
        illustrationIcon: 'camera',
      };
    case 'contacts':
      return {
        title: 'Find friends already on Dumpr',
        subtitle: "Your phone will ask next. Here's exactly what that means.",
        bullets: [
          { icon: 'lock', parts: ['Numbers are matched privately and ', { b: 'never stored' }, '.'] },
          { icon: 'chat', parts: ['We ', { b: 'never message anyone' }, ' for you.'] },
          { icon: 'link', parts: ['Skip it any time — ', { b: 'links and QR codes' }, ' always work.'] },
        ],
        allow: 'Allow contacts',
        illustrationLabel: 'FRIENDS ON DUMPR',
        illustrationIcon: 'users',
      };
    case 'notifications':
      return {
        title: 'Hear when your people add photos',
        subtitle: "Your phone will ask next. Here's exactly what that means.",
        bullets: [
          { icon: 'bell', parts: [{ b: 'Invites, mentions and reveals' }, ' arrive straight away.'] },
          { icon: 'clock', parts: ['Photo uploads are ', { b: 'batched hourly' }, ', never one ping per photo.'] },
          { icon: 'bellOff', parts: ['Turn any type off later in ', { b: 'Privacy & safety' }, '.'] },
        ],
        allow: 'Allow notifications',
        illustrationLabel: '1 NEW INVITE',
        illustrationIcon: 'bell',
      };
  }
}

const TILE_COLORS = ['#8AD3FF', '#FFB48A', '#3A2418', '#5A6270', '#8AD3FF', '#FFB48A'];

/** Illustration placeholder: a tilted dark card with a 2x3 tile grid (A6 mockup) and a mono label. */
export function PrimerIllustration({ label, icon }: { label: string; icon: IconName }) {
  return (
    <View
      className="items-center justify-center rounded-[28px] p-4"
      style={{ backgroundColor: INK, transform: [{ rotate: '-4deg' }], width: 260, alignSelf: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View className="w-full flex-row flex-wrap justify-between gap-y-2">
        {TILE_COLORS.map((c, i) => (
          <View
            key={i}
            className="h-[64px] w-[72px] items-center justify-center rounded-[10px]"
            style={{ backgroundColor: c }}
          >
            {i === 1 || i === 4 ? <Icon name={icon} size={22} color={INK} /> : null}
          </View>
        ))}
      </View>
      <Text variant="stamp" className="mt-3 text-[12px]" style={{ color: FLASH }}>
        {label}
      </Text>
    </View>
  );
}

export interface PermissionPrimerProps {
  kind: PrimerKind;
  /** Personalises the copy ("Let Dumpr find your Goa '26 photos", dates "12–15 Mar"). */
  context?: { rollName?: string; dates?: string };
  /** Fires the OS prompt and reports the outcome. Only called after the person taps Allow. */
  request: () => Promise<PermissionOutcome>;
  /** Re-reads the current permission (used when coming back from Settings). Optional. */
  check?: () => Promise<PermissionOutcome>;
  /** granted / limited: carry on with the task. */
  onGranted: (outcome: 'granted' | 'limited') => void;
  /** "Not now": leave the primer without asking. */
  onNotNow: () => void;
  /** Manual fallback (system picker, system camera). Hidden when omitted. */
  onPickManually?: () => void;
  /** Start in the denied state (already refused earlier). */
  initialDenied?: boolean;
  pickManuallyLabel?: string;
}

/**
 * A6 permission primer: shown right before the OS prompt, so the prompt is never a surprise. Three
 * plain bullets (what we read / what we never do), then Allow access / Pick manually / Not now.
 * Denied becomes an inline F6 card with Open Settings; the manual fallback always remains.
 */
export function PermissionPrimer({
  kind,
  context,
  request,
  check,
  onGranted,
  onNotNow,
  onPickManually,
  initialDenied = false,
  pickManuallyLabel = 'Pick photos manually',
}: PermissionPrimerProps) {
  const colors = useColors();
  const copy = primerCopy(kind, context);
  const [denied, setDenied] = useState(initialDenied);
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    (o: PermissionOutcome) => {
      if (o === 'granted' || o === 'limited') onGranted(o);
      else setDenied(true);
    },
    [onGranted],
  );

  const allow = async () => {
    setBusy(true);
    try {
      handle(await request());
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  // Back from Settings with access granted: carry on without another tap.
  useEffect(() => {
    if (!denied || !check) return undefined;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check().then(handle).catch(() => undefined);
    });
    return () => sub.remove();
  }, [denied, check, handle]);

  const deniedContent = edge.permissionDenied(kind);

  return (
    <View className="flex-1 justify-between">
      <View>
        <PrimerIllustration label={copy.illustrationLabel} icon={copy.illustrationIcon} />
        <Text variant="title" heading className="mt-8">
          {copy.title}
        </Text>
        <Text variant="body" className="mt-2">
          {copy.subtitle}
        </Text>
        <View className="mt-6 gap-4">
          {copy.bullets.map((b, i) => (
            <View key={i} className="flex-row items-start gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-input bg-ink/[0.06] dark:bg-ink-dark/10">
                <Icon name={b.icon} size={20} color={colors.ink} />
              </View>
              <Text variant="body" tone="secondary" className="flex-1 pt-0.5">
                {b.parts.map((p, j) =>
                  typeof p === 'string' ? (
                    <Fragment key={j}>{p}</Fragment>
                  ) : (
                    <Text key={j} variant="body" tone="default" className="font-body-bold">
                      {p.b}
                    </Text>
                  ),
                )}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View className="mt-8 gap-2">
        {denied ? (
          <EdgeState
            icon={deniedContent.icon}
            tone={deniedContent.tone}
            title={deniedContent.title}
            body={deniedContent.body}
            primary={{ label: 'Open Settings', onPress: () => void Linking.openSettings() }}
            secondary={onPickManually ? { label: deniedContent.secondaryLabel ?? 'Pick manually', onPress: onPickManually } : undefined}
          />
        ) : (
          <>
            <Button label={copy.allow} variant="primary" size="lg" loading={busy} onPress={() => void allow()} />
            {onPickManually ? (
              <Button label={pickManuallyLabel} variant="secondary" size="lg" onPress={onPickManually} />
            ) : null}
          </>
        )}
        <Button label="Not now" variant="tertiary" size="md" fullWidth onPress={onNotNow} />
      </View>
    </View>
  );
}
