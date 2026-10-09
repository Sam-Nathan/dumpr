import { useState } from 'react';
import { View } from 'react-native';
import { REACTIONS } from '@/data/types';
import {
  Avatar,
  Button,
  Chip,
  confirmDialog,
  Facepile,
  IconButton,
  OtpBoxes,
  PhotoTile,
  ReactionChip,
  Screen,
  Skeleton,
  Stamp,
  Text,
  TextField,
  toast,
} from '@/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text variant="stamp" tone="tertiary" className="mb-2">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** UI kit catalogue (dev only). Visual reference for tracks B and C+F. */
export default function KitDemo() {
  const [otp, setOtp] = useState('');
  const [shake, setShake] = useState(0);
  const [selected, setSelected] = useState('Haldi');
  return (
    <Screen scroll header={{ back: true, title: 'UI kit' }}>
      <Section title="TEXT">
        <Text variant="display">Crews</Text>
        <Text variant="title">Invite to Goa Gang</Text>
        <Text variant="heading">Add 38 to Goa &rsquo;26</Text>
        <Text variant="body">Your 38 photos are sealed until 9:00 AM.</Text>
        <Text variant="caption">12–15 Mar · 142 photos</Text>
        <Stamp date={new Date()} />
        <View className="mt-2">
          <Stamp text="07:42:10" variant="chip" size={15} />
        </View>
      </Section>

      <Section title="BUTTONS">
        <View className="gap-2">
          <Button label="Join Roll" variant="primary" size="lg" onPress={() => toast.show({ message: "Posted 3 to Goa '26", action: { label: 'Undo', onPress: () => undefined } })} />
          <View className="flex-row flex-wrap items-center gap-2">
            <Button label="New" icon="plus" variant="strong" />
            <Button label="Download all" icon="download" variant="secondary" />
            <Button label="Not now" variant="tertiary" />
            <Button
              label="Delete"
              variant="destructive"
              onPress={() =>
                void confirmDialog({
                  title: 'Delete Goa Gang for everyone?',
                  body: "6 members get 30 days to download their copies. This can't be undone.",
                  confirmLabel: 'Delete',
                })
              }
            />
          </View>
          <Button label="Download" variant="secondary" disabled disabledReason="Host turned downloads off" />
          <Button label="Saving" variant="strong" loading />
          <View className="flex-row gap-2">
            <IconButton icon="share" label="Share" />
            <IconButton icon="plus" label="Add" variant="ink" />
            <IconButton icon="camera" label="Camera" variant="flash" />
          </View>
        </View>
      </Section>

      <Section title="CHIPS & REACTIONS">
        <View className="flex-row flex-wrap gap-2">
          {['All', 'Haldi', 'Mehendi', 'Sangeet'].map((c) => (
            <Chip key={c} label={c} count={c === 'Sangeet' ? 312 : undefined} selected={selected === c} onPress={() => setSelected(c)} />
          ))}
          <Chip label="#maggi-at-3am" tone="tint" mono />
        </View>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {REACTIONS.map((r, i) => (
            <ReactionChip key={r} kind={r} count={[9, 6, 2, 0, 1][i]} selected={i === 4} onPress={() => undefined} />
          ))}
        </View>
      </Section>

      <Section title="AVATARS">
        <View className="flex-row items-center gap-3">
          <Avatar name="Meera Iyer" size={64} ring="lime" />
          <Avatar name="Kabir Shah" size={40} ring="lilac" />
          <Avatar name="Diya" size={32} />
          <Facepile people={[{ name: 'Diya' }, { name: 'Aarav R' }, { name: 'Kabir Shah' }]} total={6} />
        </View>
      </Section>

      <Section title="PHOTO TILES">
        <View className="flex-row flex-wrap gap-1">
          {(['default', 'selected', 'uploading', 'failed', 'duplicate', 'sealed'] as const).map((s) => (
            <View key={s} style={{ width: '32%' }}>
              <PhotoTile state={s} progress={0.6} blurhash="LKO2?U%2Tw=w]~RBVZRi};RPxuwH" label={s} onRetry={() => toast.show({ message: 'Retrying' })} />
              <Text variant="caption" className="mb-2 mt-1 text-center">
                {s}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="FIELDS">
        <TextField label="Username" value="meera.clicks" onChangeText={() => undefined} />
        <View className="mt-3">
          <OtpBoxes value={otp} onChange={setOtp} onComplete={() => setShake((n) => n + 1)} error={shake > 0 && otp.length < 6} shakeKey={shake} autoFocus={false} />
        </View>
      </Section>

      <Section title="SKELETON">
        <View className="gap-2">
          <Skeleton height={120} radius={24} className="bg-tint-lilac dark:bg-tint-lilac-dark" />
          <Skeleton width="60%" />
        </View>
      </Section>
    </Screen>
  );
}
