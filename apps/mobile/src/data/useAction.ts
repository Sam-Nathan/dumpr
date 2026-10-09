import { useCallback, useRef, useState } from 'react';

/**
 * Wrap an async action with a `busy` flag and re-entrancy protection (double taps run it once).
 * Errors propagate to the caller of `run` (screens map them with `friendlyMessage`).
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef(fn);
  latest.current = fn;
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await latest.current(...args);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { run, busy };
}
