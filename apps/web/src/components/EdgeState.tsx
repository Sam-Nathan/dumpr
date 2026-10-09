import Link from 'next/link';
import { edgeCopy, type InviteView } from '../lib/invite';
import { askHostUrl } from '../lib/links';

function BrokenLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M10 14a4 4 0 0 0 5.66 0l2.5-2.5a4 4 0 0 0-5.66-5.66L11.4 6.9M14 10a4 4 0 0 0-5.66 0l-2.5 2.5a4 4 0 0 0 5.66 5.66l1.1-1.06"
        stroke="#16141B"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** F6 edge state: illustration chip, headline, one sentence, one primary action, one escape. */
export function EdgeState({
  view,
  retryHref,
}: {
  view: Exclude<InviteView, { type: 'live' }>;
  retryHref: string;
}) {
  const copy = edgeCopy(view);
  const hostName = view.type === 'dead' ? view.hostName : null;
  const title = view.type === 'dead' ? view.title : null;
  return (
    <section
      aria-labelledby="edge-title"
      className="mt-6 rounded-card border border-line bg-surface p-6 dark:border-line-dark dark:bg-surface-dark"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-flash">
        <BrokenLinkIcon />
      </span>
      <h1
        id="edge-title"
        className="mt-5 font-display text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em]"
      >
        {copy.headline}
      </h1>
      <p className="mt-2 text-[15px] leading-[1.45] text-ink2 dark:text-ink2-dark">{copy.body}</p>
      <div className="mt-6 flex flex-col gap-2">
        {copy.retry ? (
          // A real navigation (not a client transition) so the server re-fetches the invite.
          <a href={retryHref} className="btn-flash">
            Try again
          </a>
        ) : (
          copy.ask && (
            <a href={askHostUrl(hostName, title)} className="btn-flash" rel="noopener">
              {copy.ask}
            </a>
          )
        )}
        <Link href="/" className="btn-text">
          Go home
        </Link>
      </div>
    </section>
  );
}
