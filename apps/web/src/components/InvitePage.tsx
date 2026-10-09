import { headers } from 'next/headers';
import { getInvite } from '../lib/invite-server';
import { inviteView } from '../lib/invite';
import { platformFromUserAgent, storeUrlFor } from '../lib/links';
import { EdgeState } from './EdgeState';
import { Footer } from './Footer';
import { GuestFlow } from './GuestFlow';
import { InviteHeader } from './InviteHeader';
import { Wordmark } from './Logo';
import { OpenInAppButton } from './OpenInAppButton';
import { StickyAppBanner } from './StickyAppBanner';

/** Shared by /r/[code] and /c/[code]: the page follows the invite's real kind, not the URL prefix. */
export async function InvitePage({ code, path }: { code: string; path: string }) {
  const view = inviteView(await getInvite(code));
  const ua = (await headers()).get('user-agent') ?? '';
  const storeHref = storeUrlFor(platformFromUserAgent(ua)) ?? '/';

  if (view.type !== 'live') {
    return (
      <>
        <main className="mx-auto max-w-lg px-5 pb-6 pt-4">
          <Wordmark href="/" />
          <EdgeState view={view} retryHref={path} />
        </main>
        <Footer />
      </>
    );
  }

  const { preview } = view;
  const kind = preview.kind;
  const isRoll = kind === 'roll' && preview.roll;

  return (
    <>
      <div className="mx-auto max-w-lg px-5 pb-40 pt-4">
        <header className="mb-3 flex items-center justify-between gap-3">
          <Wordmark href="/" />
          <OpenInAppButton
            kind={kind}
            code={code}
            className="btn-outline !min-h-[44px] !px-4 !text-[14px]"
          />
        </header>
        <main>
          <InviteHeader preview={preview} />
          {isRoll && preview.roll ? (
            <GuestFlow
              code={code}
              rollId={preview.roll.id}
              sealed={preview.roll.sealed}
              revealAt={preview.roll.revealAt}
              allowGuests={preview.allowGuests}
              requiresApproval={preview.requiresApproval}
            />
          ) : (
            <section aria-label="Join this Crew" className="mt-6">
              <a
                href={storeHref}
                className="btn-flash min-h-[60px] w-full text-[18px]"
                rel="noopener"
              >
                Get the app to join
              </a>
              <p className="mt-2 text-center text-[13px] text-ink2 dark:text-ink2-dark">
                Crews live in the app. Guests can add photos to a single Roll from its link.
              </p>
            </section>
          )}
        </main>
        <Footer />
      </div>
      <StickyAppBanner
        kind={kind}
        code={code}
        storeHref={storeHref}
        heading={isRoll ? 'Get the app to keep the full Roll' : 'Get the app to join the Crew'}
      />
    </>
  );
}
