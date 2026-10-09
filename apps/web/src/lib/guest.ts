import type { createClient } from './supabase/client';

type Supabase = ReturnType<typeof createClient>;

export type JoinStatus = 'joined' | 'requested' | 'already_member';
export interface JoinResult {
  status: JoinStatus;
  crewId: string | null;
  rollId: string | null;
}

export const MAX_NAME = 40;

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/**
 * Guest join: reuse an existing session, otherwise sign in anonymously with the display name, then
 * call `join_via_invite`. Throws the underlying Supabase error (map it with `errorCopy`).
 */
export async function joinAsGuest(
  supabase: Supabase,
  code: string,
  displayName: string,
): Promise<JoinResult> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) {
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
  } else if (
    sess.session.user.is_anonymous &&
    sess.session.user.user_metadata?.display_name !== displayName
  ) {
    // Name changed since the last visit on this device; the profile trigger follows user metadata.
    await supabase.auth.updateUser({ data: { display_name: displayName } });
  }
  const { data, error } = await supabase.rpc('join_via_invite', { p_code: code });
  if (error) throw error;
  const row = (data ?? {}) as { status?: string; crew_id?: string; roll_id?: string };
  const status: JoinStatus =
    row.status === 'requested'
      ? 'requested'
      : row.status === 'already_member'
        ? 'already_member'
        : 'joined';
  return { status, crewId: row.crew_id ?? null, rollId: row.roll_id ?? null };
}

const key = (code: string) => `dumpr:joined:${code}`;

/** Per-device convenience only: remembers that this browser already joined, and the name used. */
export function readJoined(code: string): { name: string; rollId: string | null } | null {
  try {
    const raw = window.localStorage.getItem(key(code));
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: unknown; rollId?: unknown };
    return typeof v.name === 'string'
      ? { name: v.name, rollId: typeof v.rollId === 'string' ? v.rollId : null }
      : null;
  } catch {
    return null;
  }
}

export function writeJoined(code: string, name: string, rollId: string | null): void {
  try {
    window.localStorage.setItem(key(code), JSON.stringify({ name, rollId }));
  } catch {
    // storage unavailable: the flow still works, it just asks again next visit
  }
}
