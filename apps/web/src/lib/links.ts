import { APP_STORE_URL, PLAY_STORE_URL } from '../config';

export function deepLinkFor(kind: 'crew' | 'roll', code: string): string {
  return `dumpr://${kind === 'crew' ? 'c' : 'r'}/${encodeURIComponent(code)}`;
}

export type Platform = 'android' | 'ios' | 'other';

export function platformFromUserAgent(ua: string): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

/** Store to fall back to when the app is not installed; null on desktop. */
export function storeUrlFor(platform: Platform): string | null {
  if (platform === 'android') return PLAY_STORE_URL;
  if (platform === 'ios') return APP_STORE_URL;
  return null;
}

/** WhatsApp compose link used by the "Ask <host> for a new one" action. */
export function askHostUrl(hostName: string | null, title: string | null): string {
  const who = hostName ? `Hi ${hostName}, ` : 'Hi, ';
  const what = title ? ` to ${title}` : '';
  const text = `${who}could you send me a new Dumpr invite link${what}? The one I have isn’t working.`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
