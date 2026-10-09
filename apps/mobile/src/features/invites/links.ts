/** Pure helpers for sharing invite links (B6). */
import { inviteUrl } from '../../lib/deeplinks';

export const EXPIRY_OPTIONS = [1, 7, 30] as const;
export type ExpiryDays = (typeof EXPIRY_OPTIONS)[number];

/** `https://dumpr.app/r/<code>` for a Roll invite, `/c/<code>` for a whole-Crew invite. */
export function buildInviteLink(code: string, rollId: string | null | undefined): string {
  return inviteUrl(code, rollId ? 'roll' : 'crew');
}

/** Link as shown in the pill: no scheme. */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** The text that goes into WhatsApp / SMS. */
export function shareMessage(name: string, url: string, kind: 'crew' | 'roll'): string {
  return kind === 'roll'
    ? `Add your photos to ${name} on Dumpr: ${url}`
    : `Join ${name} on Dumpr: ${url}`;
}

export function whatsappUrl(text: string): string {
  return `whatsapp://send?text=${encodeURIComponent(text)}`;
}

export function smsUrl(text: string, platform: 'ios' | 'android' | string = 'android'): string {
  return `${platform === 'ios' ? 'sms:&' : 'sms:?'}body=${encodeURIComponent(text)}`;
}

export function expiryLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** "Expires in 7 days · host approves new members". */
export function linkSettingsSummary(s: {
  ttlDays: number;
  requiresApproval: boolean;
  allowGuests?: boolean;
  showGuests?: boolean;
}): string {
  const parts = [`Expires in ${expiryLabel(s.ttlDays)}`];
  if (s.requiresApproval) parts.push('host approves new members');
  if (s.showGuests) parts.push(s.allowGuests ? 'guests allowed' : 'members only');
  return parts.join(' · ');
}
