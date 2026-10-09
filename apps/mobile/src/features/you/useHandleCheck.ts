import { useEffect, useRef, useState } from 'react';
import { rpc } from '@/data/rpc';
import type { CheckHandleResult } from '@/data/types';
import { isValidHandle } from '@/lib/handle';

export type HandleStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; suggestions: string[] }
  | { kind: 'invalid' }
  | { kind: 'error' };

/** Live handle availability through `check_handle` (300 ms debounce, stale answers ignored). */
export function useHandleCheck(handle: string, current: string | null | undefined): HandleStatus {
  const [status, setStatus] = useState<HandleStatus>({ kind: 'idle' });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!handle) return setStatus({ kind: 'idle' });
    if (!isValidHandle(handle)) return setStatus({ kind: 'invalid' });
    if (current && handle === current.toLowerCase()) return setStatus({ kind: 'available' });
    setStatus({ kind: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await rpc<CheckHandleResult>('check_handle', { p_handle: handle });
        if (id !== seq.current) return;
        setStatus(
          r.available
            ? { kind: 'available' }
            : { kind: 'taken', suggestions: (r.suggestions ?? []).slice(0, 3) },
        );
      } catch {
        if (id === seq.current) setStatus({ kind: 'error' });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [handle, current]);
  return status;
}
