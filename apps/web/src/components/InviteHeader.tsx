import { formatDateRange, formatPeopleCount, formatPhotoCount } from '../lib/format';
import { inviteTitle, type InvitePreview } from '../lib/invite';
import { Avatar, Facepile } from './Facepile';
import { LocalTime } from './LocalTime';
import { LogoTile } from './Logo';
import { tintBg } from './tints';

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="3" fill="#D4FF3F" />
      <path
        d="M8 10.5V8a4 4 0 0 1 8 0v2.5"
        stroke="#D4FF3F"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Cover({ preview }: { preview: InvitePreview }) {
  const sealed = preview.roll?.sealed === true;
  const name = inviteTitle(preview);
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px] bg-ink">
      {preview.coverUrl ? (
        // The cover is a short-lived signed URL, so a plain <img> (no optimiser) is right.
        <img
          src={preview.coverUrl}
          alt={sealed ? '' : `Cover photo of ${name}`}
          className={`h-full w-full object-cover ${sealed ? 'scale-125 blur-2xl' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {sealed ? <LockIcon /> : <LogoTile size={72} />}
        </div>
      )}
      {sealed && preview.coverUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/40">
          <LockIcon />
        </div>
      )}
    </div>
  );
}

/** A4/A5 header: cover, name, dates, host, facepile, count and the "who can see" note. */
export function InviteHeader({ preview }: { preview: InvitePreview }) {
  const isRoll = preview.kind === 'roll' && preview.roll;
  const title = inviteTitle(preview);
  const roll = preview.roll;
  const sealed = roll?.sealed === true;
  const dates = roll ? formatDateRange(roll.startsOn, roll.endsOn) : '';
  const label = isRoll && preview.crew ? `${preview.crew.name} · Roll` : 'Crew';

  const facts: string[] = [];
  if (dates) facts.push(dates);
  if (isRoll && roll) {
    if (!sealed) facts.push(formatPhotoCount(roll.photoCount));
  } else if (preview.memberCount > 0) {
    facts.push(formatPeopleCount(preview.memberCount));
  }

  const people = preview.memberCount > 0 ? formatPeopleCount(preview.memberCount) : 'the people';
  const what = isRoll ? 'Roll' : 'Crew';

  return (
    <section
      aria-labelledby="invite-title"
      className={`rounded-card p-4 ${tintBg(preview.crew?.tint)}`}
    >
      <Cover preview={preview} />
      <div className="px-1 pb-1 pt-4">
        <p className="stamp text-ink2 dark:text-ink2-dark">{label}</p>
        <h1
          id="invite-title"
          className="mt-1 break-words font-display text-[34px] font-extrabold leading-[1] tracking-[-0.02em]"
        >
          {title}
        </h1>
        {facts.length > 0 && (
          <p className="mt-2 text-[13px] font-medium leading-[1.4] text-ink2 dark:text-ink2-dark">
            {facts.join(' · ')}
          </p>
        )}
        {isRoll && roll && !sealed && roll.photoCount === 0 && (
          <p className="mt-1 text-[15px] font-medium">Be the first to add one</p>
        )}
        {sealed && (
          <p className="mt-2 text-[15px] font-semibold">
            Photos unlock at{' '}
            {roll?.revealAt ? <LocalTime iso={roll.revealAt} /> : 'the reveal time'}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {preview.host && (
            <div className="flex items-center gap-2">
              <Avatar person={{ ...preview.host, ringColor: 'lime' }} size={36} />
              <span className="text-[15px] font-semibold">
                {preview.host.displayName} invited you
              </span>
            </div>
          )}
          <Facepile people={preview.facepile} total={preview.memberCount} />
        </div>

        <p className="mt-4 text-[13px] leading-[1.4] text-ink2 dark:text-ink2-dark">
          Private &mdash; only {people} in this {what} see it.
          {isRoll && preview.allowGuests && ' Add photos as a guest: no app, no sign-up.'}
        </p>
      </div>
    </section>
  );
}
