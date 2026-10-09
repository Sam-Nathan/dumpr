'use client';

import { useEffect, useState } from 'react';
import { formatUnlockTime } from '../lib/format';

/** Formats in the viewer's own time zone after mount (the server does not know it). */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');
  useEffect(() => setText(formatUnlockTime(iso)), [iso]);
  return <time dateTime={iso}>{text || 'the reveal time'}</time>;
}
