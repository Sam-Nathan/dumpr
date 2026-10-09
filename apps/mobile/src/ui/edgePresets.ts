import { errorCopy, toAppError } from '../lib/errors';
import type { EdgeContent } from './EdgeState';

/**
 * Copy for every F6 dead end used by routes. Call, then spread into <EdgeState {...} /> and attach
 * handlers. `who` is the person responsible when a person did it ("Diya took it down").
 */
export const edge = {
  inviteExpired: (host?: string | null): EdgeContent => ({
    icon: 'clock',
    tone: 'peach',
    title: 'This invite link has expired',
    body: 'Links last 7 days unless the host changes it.',
    primaryLabel: host ? `Ask ${host} for a new one` : 'Ask the host for a new one',
    secondaryLabel: 'Go home',
  }),
  inviteRevoked: (host?: string | null): EdgeContent => ({
    icon: 'link',
    tone: 'peach',
    title: 'This invite link was turned off',
    body: 'The host switched it off, so it will not work for anyone now.',
    primaryLabel: host ? `Ask ${host} for a new one` : 'Ask the host for a new one',
    secondaryLabel: 'Go home',
  }),
  inviteFull: (host?: string | null): EdgeContent => ({
    icon: 'users',
    tone: 'peach',
    title: 'This link is full',
    body: 'It reached the number of people the host allowed.',
    primaryLabel: host ? `Ask ${host} for a new one` : 'Ask the host for a new one',
    secondaryLabel: 'Go home',
  }),
  inviteNotFound: (): EdgeContent => ({
    icon: 'search',
    tone: 'peach',
    title: "We can't find that link",
    body: 'It may have been copied incompletely. Ask for it to be sent again.',
    primaryLabel: 'Try another link',
    secondaryLabel: 'Go home',
  }),
  inviteDeclined: (name: string): EdgeContent => ({
    icon: 'close',
    tone: 'neutral',
    title: `You declined ${name}`,
    body: 'Changed your mind? The link works until it expires.',
    primaryLabel: 'Open invite again',
    secondaryLabel: 'Go home',
  }),
  requested: (name: string): EdgeContent => ({
    icon: 'clock',
    tone: 'sky',
    title: 'Requested — we’ll tell you',
    body: `A host of ${name} will look at your request. You will get a notification when they decide.`,
    primaryLabel: 'Go home',
  }),
  permissionDenied: (what: 'photos' | 'camera' | 'contacts' | 'notifications'): EdgeContent => {
    const copy = {
      photos: {
        title: "Dumpr can't see your photos",
        body: 'You can still pick photos one by one, or allow access in Settings.',
        secondary: 'Pick manually',
      },
      camera: {
        title: "Dumpr can't use the camera",
        body: 'You can still add photos from your gallery, or allow the camera in Settings.',
        secondary: 'Add from gallery',
      },
      contacts: {
        title: "Dumpr can't see your contacts",
        body: 'Links and QR codes always work. Allow contacts in Settings if you want suggestions.',
        secondary: 'Not now',
      },
      notifications: {
        title: 'Notifications are off',
        body: 'You will still see everything in your Inbox. Turn them on in Settings to hear about invites.',
        secondary: 'Not now',
      },
    }[what];
    return {
      icon: 'blocked',
      tone: 'lilac',
      title: copy.title,
      body: copy.body,
      primaryLabel: 'Open Settings',
      secondaryLabel: copy.secondary,
    };
  },
  uploadsFailed: (count: number): EdgeContent => ({
    icon: 'refresh',
    tone: 'pink',
    title: `${count} ${count === 1 ? 'photo' : 'photos'} didn't upload`,
    body: "Your connection dropped. They're saved on this phone and retry automatically.",
    primaryLabel: 'Retry now',
  }),
  photoRemoved: (who?: string | null): EdgeContent => ({
    icon: 'trash',
    tone: 'sky',
    title: 'This photo was removed',
    body: who
      ? `${who} took it down. Your reactions and replies went with it.`
      : 'It was taken down. Your reactions and replies went with it.',
    primaryLabel: 'Back to the Roll',
  }),
  crewDeleted: (crew: string, who?: string | null): EdgeContent => ({
    icon: 'download',
    tone: 'ink',
    title: who ? `${crew} was deleted by ${who}` : `${crew} was deleted`,
    body: 'You have 30 days to download the photos you can see.',
    primaryLabel: 'Download my copies',
    secondaryLabel: 'Go home',
  }),
  removedFromCrew: (crew: string, who?: string | null): EdgeContent => ({
    icon: 'users',
    tone: 'neutral',
    title: "You're no longer in this Crew",
    body: who ? `${who} removed you from ${crew}.` : `You were removed from ${crew}.`,
    primaryLabel: 'Go home',
  }),
  offline: (): EdgeContent => ({
    icon: 'alert',
    tone: 'sky',
    title: "Can't reach Dumpr",
    body: 'Check your connection. Anything you added is saved and will sync.',
    primaryLabel: 'Try again',
  }),
  /** Generic: from any thrown error (AppError code -> friendly copy). */
  fromError: (e: unknown): EdgeContent => {
    const err = toAppError(e);
    const copy = errorCopy(err.code);
    return {
      icon: err.code === 'network' || err.code === 'timeout' ? 'alert' : 'info',
      tone: 'sky',
      title: copy.title,
      body: copy.message,
      primaryLabel: 'Try again',
      secondaryLabel: 'Go home',
    };
  },
};
