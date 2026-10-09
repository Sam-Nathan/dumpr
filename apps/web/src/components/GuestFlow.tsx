'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { errorCodeOf, errorCopy, isTerminalCode } from '../lib/errors';
import { cleanName, joinAsGuest, MAX_NAME, readJoined, writeJoined } from '../lib/guest';
import { createClient } from '../lib/supabase/client';
import type { WebUploader, WebUploadItem } from '../lib/upload-contract';
import { hasActive } from '../lib/uploads';
import { createWebUploader } from '../lib/web-uploader';
import { LatestPhotos } from './LatestPhotos';
import { LocalTime } from './LocalTime';
import { UploadGrid } from './UploadGrid';

type Phase = 'form' | 'joining' | 'ready' | 'requested' | 'blocked';
type Outcome = { ok: true; rollId: string } | { ok: false };

interface Props {
  code: string;
  rollId: string;
  sealed: boolean;
  revealAt: string | null;
  allowGuests: boolean;
  requiresApproval: boolean;
}

export function GuestFlow({
  code,
  rollId,
  sealed,
  revealAt,
  allowGuests,
  requiresApproval,
}: Props) {
  const [phase, setPhase] = useState<Phase>(allowGuests ? 'form' : 'blocked');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    allowGuests ? null : errorCopy('guests_not_allowed'),
  );
  const [items, setItems] = useState<WebUploadItem[]>([]);
  const [allowUploads, setAllowUploads] = useState(true);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const joinRef = useRef<Promise<Outcome> | null>(null);
  const uploaderRef = useRef<WebUploader | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const doneSeen = useRef(0);

  // Returning visitor on this device: skip the form when the session and the join are still there.
  useEffect(() => {
    if (!allowGuests) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient().auth.getSession();
      if (cancelled || !data.session) return;
      const stored = readJoined(code);
      const meta = data.session.user.user_metadata?.display_name;
      if (stored) {
        setName(stored.name);
        joinRef.current = Promise.resolve({ ok: true, rollId: stored.rollId ?? rollId });
        setPhase('ready');
      } else if (typeof meta === 'string') {
        setName(meta);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowGuests, code, rollId]);

  // Host settings (uploads / downloads) are readable through RLS once we are a member.
  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from('rolls')
        .select('allow_uploads, allow_downloads')
        .eq('id', rollId)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as { allow_uploads?: boolean; allow_downloads?: boolean };
      if (row.allow_uploads === false) setAllowUploads(false);
      if (row.allow_downloads === false) setAllowDownloads(false);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, rollId]);

  // Leaving the page while photos are still going up would lose them.
  const active = hasActive(items);
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  // Refresh the grid when more uploads finish; learn about host-closed uploads from blocked items.
  useEffect(() => {
    const done = items.filter((i) => i.state === 'done').length;
    if (done > doneSeen.current) {
      doneSeen.current = done;
      const t = window.setTimeout(() => setRefreshKey((k) => k + 1), 800);
      return () => window.clearTimeout(t);
    }
  }, [items]);
  useEffect(() => {
    if (items.some((i) => i.state === 'blocked' && i.errorCode === 'uploads_disabled')) {
      setAllowUploads(false);
    }
  }, [items]);

  useEffect(() => () => unsubRef.current?.(), []);

  const getUploader = useCallback((): WebUploader => {
    if (!uploaderRef.current) {
      const supabase = createClient();
      const uploader = createWebUploader({
        supabaseUrl: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        getAccessToken: async () => {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('not_authenticated');
          return data.session.access_token;
        },
      });
      uploaderRef.current = uploader;
      unsubRef.current = uploader.subscribe(setItems);
    }
    return uploaderRef.current;
  }, []);

  const startJoin = useCallback(
    (displayName: string): Promise<Outcome> => {
      const supabase = createClient();
      return joinAsGuest(supabase, code, displayName)
        .then((res): Outcome => {
          if (res.status === 'requested') {
            setPhase('requested');
            return { ok: false };
          }
          const id = res.rollId ?? rollId;
          writeJoined(code, displayName, id);
          setPhase('ready');
          return { ok: true, rollId: id };
        })
        .catch((err: unknown): Outcome => {
          const c = errorCodeOf(err);
          setError(errorCopy(err));
          setPhase(isTerminalCode(c) ? 'blocked' : 'form');
          return { ok: false };
        });
    },
    [code, rollId],
  );

  const onAddClick = () => {
    if (phase === 'joining') return;
    if (phase !== 'ready') {
      const clean = cleanName(name);
      if (!clean) {
        setNameError('Add your name so people know who the photos are from.');
        nameRef.current?.focus();
        return;
      }
      setNameError(null);
      setError(null);
      setPhase('joining');
      joinRef.current = startJoin(clean);
    }
    // Opened synchronously inside the tap so mobile browsers allow the picker while joining continues.
    inputRef.current?.click();
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const outcome = await joinRef.current;
    if (!outcome || !outcome.ok) return;
    getUploader().add(files, { rollId: outcome.rollId });
  };

  if (phase === 'blocked') {
    return (
      <section
        aria-live="polite"
        className="mt-6 rounded-card border border-line bg-surface p-5 dark:border-line-dark dark:bg-surface-dark"
      >
        <p role="alert" className="text-[15px] font-semibold leading-[1.45]">
          {error ?? errorCopy('guests_not_allowed')}
        </p>
      </section>
    );
  }

  if (phase === 'requested') {
    return (
      <section
        aria-live="polite"
        className="mt-6 rounded-card border border-line bg-surface p-5 dark:border-line-dark dark:bg-surface-dark"
      >
        <h2 className="font-display text-[22px] font-extrabold leading-[1.1]">
          Requested &mdash; we&rsquo;ll tell you
        </h2>
        <p className="mt-2 text-[15px] leading-[1.45] text-ink2 dark:text-ink2-dark">
          The host has to let you in first. Get the app and we&rsquo;ll let you know when they do.
        </p>
      </section>
    );
  }

  const joined = phase === 'ready';
  const joining = phase === 'joining';

  return (
    <section aria-label="Add photos" className="mt-6">
      {!joined && (
        <div>
          <label htmlFor="guest-name" className="block text-[14px] font-semibold">
            Your name{' '}
            <span className="font-medium text-ink2 dark:text-ink2-dark">
              (shown as photo credit)
            </span>
          </label>
          <input
            ref={nameRef}
            id="guest-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            maxLength={MAX_NAME}
            autoComplete="name"
            enterKeyHint="done"
            placeholder="Priya, Ananya's cousin"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'guest-name-error' : undefined}
            disabled={joining}
            className="mt-2 min-h-[52px] w-full rounded-input border border-line bg-surface px-4 text-[16px] font-medium text-ink placeholder:text-ink3 disabled:opacity-60 dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-ink3-dark"
          />
          {nameError && (
            <p
              id="guest-name-error"
              role="alert"
              className="mt-2 text-[13px] text-danger dark:text-danger-dark"
            >
              {nameError}
            </p>
          )}
        </div>
      )}
      {joined && name && (
        <p className="text-[14px] text-ink2 dark:text-ink2-dark">
          Adding photos as <span className="font-bold text-ink dark:text-ink-dark">{name}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[14px] font-medium text-danger dark:text-danger-dark">
          {error}
        </p>
      )}

      {joined && !allowUploads ? (
        <p
          role="status"
          className="mt-4 rounded-card border border-line bg-surface p-4 text-[15px] leading-[1.45] dark:border-line-dark dark:bg-surface-dark"
        >
          {errorCopy('uploads_disabled')}
        </p>
      ) : (
        <div className="mt-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFiles}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={onAddClick}
            disabled={joining}
            className="btn-flash min-h-[60px] w-full text-[18px]"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
            {joining ? 'Joining…' : 'Add photos'}
          </button>
          <p className="mt-2 text-center text-[13px] text-ink2 dark:text-ink2-dark">
            {requiresApproval
              ? 'The host approves new people before photos appear.'
              : 'Full quality. No app, no sign-up. Keep this tab open while photos upload.'}
          </p>
        </div>
      )}

      <UploadGrid
        items={items}
        onRetry={(id) => uploaderRef.current?.retry(id)}
        onCancel={(id) => uploaderRef.current?.cancel(id)}
      />

      {joined &&
        (sealed ? (
          <p className="mt-8 rounded-card border border-dashed border-line p-4 text-[15px] leading-[1.45] dark:border-line-dark">
            Photos unlock at {revealAt ? <LocalTime iso={revealAt} /> : 'the reveal time'}. Anything
            you add stays sealed until then.
          </p>
        ) : (
          <LatestPhotos rollId={rollId} allowDownloads={allowDownloads} refreshKey={refreshKey} />
        ))}
    </section>
  );
}
