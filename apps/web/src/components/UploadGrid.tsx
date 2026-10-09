'use client';

import { uploadErrorCopy } from '../lib/errors';
import type { WebUploadItem } from '../lib/upload-contract';
import { normalizeProgress, summarizeUploads, summaryLabel } from '../lib/uploads';

/** Progress ring over a dimmed tile. `value` null = indeterminate. */
export function ProgressRing({ value, label }: { value: number | null; label: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const shown = value === null ? 0.28 : Math.max(0.04, value);
  return (
    <svg
      viewBox="0 0 40 40"
      width="44"
      height="44"
      role="img"
      aria-label={label}
      className={value === null ? 'animate-spin' : '-rotate-90'}
    >
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="#D4FF3F"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * shown} ${c}`}
      />
    </svg>
  );
}

function Tile({
  item,
  onRetry,
  onCancel,
}: {
  item: WebUploadItem;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const s = item.state;
  const working = ['queued', 'preparing', 'initiating', 'uploading', 'completing'].includes(s);
  const pct = Math.round(normalizeProgress(item.progress) * 100);
  const ringValue =
    s === 'uploading' ? normalizeProgress(item.progress) : s === 'completing' ? 1 : null;
  const failed = s === 'failed';
  const blocked = s === 'blocked';
  return (
    <li className="relative aspect-square overflow-hidden rounded-tile bg-tint-lilac dark:bg-tint-lilac-dark">
      {item.previewUrl && (
        <img
          src={item.previewUrl}
          alt={item.name}
          className={`h-full w-full object-cover ${s === 'duplicate' ? 'opacity-50' : ''}`}
        />
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/55">
          <ProgressRing
            value={ringValue}
            label={s === 'uploading' ? `Uploading ${item.name}, ${pct}%` : `Preparing ${item.name}`}
          />
        </div>
      )}
      {s === 'paused' && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/60 p-1 text-center">
          <span className="stamp text-[10px] text-[#F4F3F6]">
            {uploadErrorCopy(item.errorCode ?? 'no_network')}
          </span>
        </div>
      )}
      {(failed || blocked) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/70 p-1 text-center">
          {failed ? (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              className="ink-surface inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pill bg-[#F4F3F6] px-3 text-[13px] font-bold text-[#16141B] active:scale-[0.96]"
              aria-label={`Retry upload of ${item.name}`}
            >
              Retry
            </button>
          ) : (
            <span className="text-[12px] font-semibold leading-tight text-[#F4F3F6]">
              {uploadErrorCopy(item.errorCode)}
            </span>
          )}
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className="ink-surface absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center text-[#F4F3F6]"
            aria-label={`Remove ${item.name}`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {failed && (
            <span className="text-[11px] leading-tight text-[#B5B1BC]">Didn&rsquo;t upload</span>
          )}
        </div>
      )}
      {s === 'duplicate' && (
        <span className="stamp absolute inset-x-0 bottom-0 bg-ink/70 py-1 text-center text-[10px] text-[#F4F3F6]">
          In Roll
        </span>
      )}
      {s === 'done' && (
        <span
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-flash"
          role="img"
          aria-label={`${item.name} added`}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="#16141B"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </li>
  );
}

export function UploadGrid({
  items,
  onRetry,
  onCancel,
}: {
  items: WebUploadItem[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const summary = summarizeUploads(items);
  const active = summary.active > 0;
  const pct = Math.round(summary.progress * 100);
  return (
    <section aria-label="Your uploads" className="mt-5">
      <div
        role="status"
        aria-live="polite"
        className="rounded-[18px] bg-surface p-4 dark:bg-surface-dark"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[15px] font-bold">{summaryLabel(summary)}</span>
          {active && (
            <span className="stamp text-ink3 dark:text-ink3-dark">Keep this tab open</span>
          )}
        </div>
        {active && (
          <div
            className="mt-3 h-2 overflow-hidden rounded-pill bg-line dark:bg-line-dark"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Upload progress"
          >
            <div
              className="h-full rounded-pill bg-ink transition-[width] dark:bg-flash"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <Tile key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
        ))}
      </ul>
    </section>
  );
}
