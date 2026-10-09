'use client';

import type { MouseEvent } from 'react';
import { deepLinkFor, platformFromUserAgent, storeUrlFor } from '../lib/links';

interface Props {
  kind: 'crew' | 'roll';
  code: string;
  label?: string;
  className?: string;
}

/**
 * Tries the app via its URL scheme; if the page is still visible shortly after (app not installed)
 * it falls back to the right store. Without JS the plain link still attempts the scheme.
 */
export function OpenInAppButton({
  kind,
  code,
  label = 'Open in app',
  className = 'btn-outline',
}: Props) {
  const href = deepLinkFor(kind, code);
  const onClick = (_e: MouseEvent<HTMLAnchorElement>) => {
    const store = storeUrlFor(platformFromUserAgent(navigator.userAgent));
    if (!store) return;
    const timer = window.setTimeout(() => {
      if (!document.hidden) window.location.href = store;
    }, 1600);
    const cancel = () => {
      if (document.hidden) window.clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', cancel, { once: true });
    window.addEventListener('pagehide', () => window.clearTimeout(timer), { once: true });
  };
  return (
    <a href={href} onClick={onClick} className={className}>
      {label}
    </a>
  );
}
