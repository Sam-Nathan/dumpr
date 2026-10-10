import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

/**
 * `Date.now()` that ticks every `intervalMs` (countdowns, live stamps). Pass `null` to stop ticking.
 * Ticking pauses while the screen is not focused (a screen covered by another one in the stack must not
 * keep re-rendering every second) and catches up as soon as it is focused again.
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (intervalMs === null || !focused) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, focused]);
  return now;
}
