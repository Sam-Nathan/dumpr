import { OpenInAppButton } from './OpenInAppButton';

/** Sticky bottom banner: "Get the app to keep the full Roll". Not lime: the page's one lime button is elsewhere. */
export function StickyAppBanner({
  kind,
  code,
  storeHref,
  heading,
}: {
  kind: 'crew' | 'roll';
  code: string;
  storeHref: string;
  heading: string;
}) {
  return (
    <aside
      aria-label="Get the app"
      className="ink-surface fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"
    >
      <div className="mx-auto flex max-w-lg flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[24px] bg-ink px-4 py-3 text-[#F4F3F6] shadow-[0_8px_30px_rgba(0,0,0,0.35)] dark:border dark:border-line-dark">
        <p className="min-w-[10rem] flex-1 text-[14px] font-semibold leading-[1.3]">{heading}</p>
        <div className="flex items-center gap-1">
          <OpenInAppButton
            kind={kind}
            code={code}
            label="Open"
            className="btn-text !min-h-[44px] !text-[#F4F3F6]"
          />
          <a
            href={storeHref}
            className="btn !min-h-[44px] bg-[#F4F3F6] px-5 text-[15px] text-[#16141B] hover:opacity-90"
            rel="noopener"
          >
            Get Dumpr
          </a>
        </div>
      </div>
    </aside>
  );
}
