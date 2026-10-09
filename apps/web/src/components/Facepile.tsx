import { initials } from '../lib/format';
import type { InvitePerson } from '../lib/invite';
import { tintBg } from './tints';

const LIME = 'bg-flash';
const RING: Record<string, string> = {
  lime: LIME,
  lilac: tintBg('lilac'),
  sky: tintBg('sky'),
  peach: tintBg('peach'),
};

export function Avatar({
  person,
  size = 32,
  className = '',
}: {
  person: { displayName: string; avatarUrl: string | null; ringColor?: string | null };
  size?: number;
  className?: string;
}) {
  const bg = RING[person.ringColor ?? ''] ?? LIME;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-body font-bold text-[#16141B] ring-2 ring-paper dark:ring-paper-dark ${bg} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(person.displayName)
      )}
    </span>
  );
}

export function Facepile({ people, total }: { people: InvitePerson[]; total: number }) {
  if (people.length === 0) return null;
  const extra = Math.max(0, total - people.length);
  const names = people.map((p) => p.displayName).filter(Boolean);
  return (
    <div
      className="flex items-center"
      role="img"
      aria-label={`Members: ${names.join(', ')}${extra ? ` and ${extra} more` : ''}`}
    >
      <div className="flex -space-x-2">
        {people.map((p, i) => (
          <Avatar key={`${p.displayName}-${i}`} person={p} />
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-[13px] font-semibold text-ink2 dark:text-ink2-dark">
          +{extra}
        </span>
      )}
    </div>
  );
}
