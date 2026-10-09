import { formatDateRange, formatPhotoCount, formatPeopleCount } from './format';
import { inviteTitle, type InvitePreview } from './invite';

export interface InviteMeta {
  title: string;
  description: string;
}

export const FALLBACK_META: InviteMeta = {
  title: 'Dumpr',
  description: "Everyone's photos. One place. No chasing.",
};

/** og:title "<Roll name> · <count> photos on Dumpr" (Crews: "<Crew name> · <n> people on Dumpr"). */
export function inviteMeta(p: InvitePreview): InviteMeta {
  const name = inviteTitle(p);
  if (p.kind === 'roll' && p.roll) {
    const dates = formatDateRange(p.roll.startsOn, p.roll.endsOn);
    const host = p.host?.displayName;
    const parts = [
      host
        ? `${host} invited you to add photos to ${name}.`
        : `You're invited to add photos to ${name}.`,
      dates ? `${dates}.` : '',
      'No app needed.',
    ].filter(Boolean);
    return {
      title: `${name} · ${formatPhotoCount(p.roll.photoCount)} on Dumpr`,
      description: parts.join(' '),
    };
  }
  const host = p.host?.displayName;
  return {
    title: `${name} · ${formatPeopleCount(p.memberCount)} on Dumpr`,
    description: host
      ? `${host} invited you to join ${name} on Dumpr. Everyone's photos. One place.`
      : `You're invited to join ${name} on Dumpr. Everyone's photos. One place.`,
  };
}
