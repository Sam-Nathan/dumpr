import { View } from 'react-native';
import { formatStamp } from '../lib/format';
import { Text } from './Text';

export interface StampProps {
  /** Date to stamp (renders "14 03 '26 · 07:42:10" in local time). */
  date?: Date | string | number | null;
  /** Pre-formatted text instead of a date (e.g. a countdown "07:42:10"). */
  text?: string;
  seconds?: boolean;
  time?: boolean;
  /** 'chip' puts the orange stamp on an ink pill (readable on photos). */
  variant?: 'plain' | 'chip';
  /** 11-15 per the design. Default 12. */
  size?: 11 | 12 | 13 | 14 | 15;
  className?: string;
}

const SIZE: Record<number, string> = {
  11: 'text-[11px]',
  12: 'text-[12px]',
  13: 'text-[13px]',
  14: 'text-[14px]',
  15: 'text-[15px]',
};

/** Mono, uppercase, shutter-orange date stamp: the "film camera" detail. */
export function Stamp({
  date,
  text,
  seconds,
  time,
  variant = 'plain',
  size = 12,
  className,
}: StampProps) {
  const value = text ?? formatStamp(date, { seconds, time });
  if (!value) return null;
  const label = (
    <Text
      variant="stamp"
      tone="shutter"
      className={`${SIZE[size]} ${className ?? ''}`}
      accessibilityLabel={value}
    >
      {value}
    </Text>
  );
  if (variant === 'plain') return label;
  return <View className="self-start rounded-pill bg-ink px-2.5 py-1">{label}</View>;
}
