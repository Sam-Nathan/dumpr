import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { callFunction } from './functions';
import { profileKey } from './profile';
import { useSession } from './session';
import { useHomeFeedLite } from './useDestinations';
import type {
  AccountExport,
  BlockedPerson,
  ConsentFlags,
  HostedRoll,
  LastHostCrew,
  NotificationPrefs,
  PrivacySettings,
} from './types-cf';
import type { CrewTint } from './types';

export const privacyKey = (uid: string | undefined) => ['privacy-settings', uid] as const;
export const blocksKey = ['blocks'] as const;
export const hostedRollsKey = ['hosted-rolls'] as const;
export const notifPrefsKey = (uid: string | undefined) => ['notification-prefs', uid] as const;

export const DEFAULT_PREFS: NotificationPrefs = {
  invites: true,
  uploads: true,
  chats: true,
  reveals: true,
  games: true,
};

/** F3: who can add me, number visibility and the three face-feature consents (all off by default). */
export function usePrivacySettings() {
  const { user } = useSession();
  return useQuery({
    queryKey: privacyKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<PrivacySettings> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('who_can_add, phone_visible, consent_stickers, consent_discovery, consent_then_now')
        .eq('id', user?.id as string)
        .single();
      if (error) throw toAppError(error);
      return data as PrivacySettings;
    },
  });
}

export function useUpdatePrivacy() {
  const { user } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PrivacySettings>) => {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user?.id as string);
      if (error) throw toAppError(error);
      return patch;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: privacyKey(user?.id) });
      const prev = qc.getQueryData<PrivacySettings>(privacyKey(user?.id));
      if (prev) qc.setQueryData(privacyKey(user?.id), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(privacyKey(user?.id), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: privacyKey(user?.id) });
      void qc.invalidateQueries({ queryKey: profileKey(user?.id) });
    },
  });
}

export type ConsentKey = keyof ConsentFlags;

/** Blocked people (name may be hidden once you no longer share a space). */
export function useBlockedPeople() {
  const { user } = useSession();
  return useQuery({
    queryKey: blocksKey,
    enabled: !!user,
    queryFn: async (): Promise<BlockedPerson[]> => {
      const { data, error } = await supabase
        .from('blocks')
        .select(
          'blocked_id, created_at, profile:profiles!blocked_id(display_name, avatar_key, ring_color)',
        )
        .order('created_at', { ascending: false });
      if (error) throw toAppError(error);
      return (data ?? []) as unknown as BlockedPerson[];
    },
  });
}

export function useUnblock() {
  const { user } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockedId: string) => {
      const { error } = await supabase
        .from('blocks')
        .delete()
        .eq('blocker_id', user?.id as string)
        .eq('blocked_id', blockedId);
      if (error) throw toAppError(error);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: blocksKey }),
  });
}

interface HostedRow {
  id: string;
  name: string;
  crew_id: string;
  created_by: string | null;
  allow_uploads: boolean;
  allow_downloads: boolean;
  guests_allowed: boolean;
  crews:
    | { name: string; tint: CrewTint; deleted_at: string | null }
    | { name: string; tint: CrewTint; deleted_at: string | null }[]
    | null;
}

/** Rolls where the viewer is a host / cohost of the Crew or created the Roll. */
export function useHostedRolls() {
  const { user } = useSession();
  const feed = useHomeFeedLite();
  const adminCrews = new Set(
    (feed.data?.crews ?? [])
      .filter((c) => c.role === 'host' || c.role === 'cohost')
      .map((c) => c.id),
  );
  const q = useQuery({
    queryKey: [...hostedRollsKey, [...adminCrews].sort().join(',')],
    enabled: !!user && !feed.isLoading,
    queryFn: async (): Promise<HostedRoll[]> => {
      const { data, error } = await supabase
        .from('rolls')
        .select(
          'id, name, crew_id, created_by, allow_uploads, allow_downloads, guests_allowed, crews!inner(name, tint, deleted_at)',
        )
        .is('deleted_at', null)
        .is('crews.deleted_at', null)
        .order('last_activity_at', { ascending: false })
        .limit(50);
      if (error) throw toAppError(error);
      return ((data ?? []) as unknown as HostedRow[])
        .filter((r) => adminCrews.has(r.crew_id) || r.created_by === user?.id)
        .flatMap((r) => {
          const c = Array.isArray(r.crews) ? r.crews[0] : r.crews;
          return c
            ? [
                {
                  id: r.id,
                  name: r.name,
                  crew_id: r.crew_id,
                  crew_name: c.name,
                  tint: c.tint,
                  allow_uploads: r.allow_uploads,
                  allow_downloads: r.allow_downloads,
                  guests_allowed: r.guests_allowed,
                },
              ]
            : [];
        });
    },
  });
  return q;
}

/** Per-type notification switches (`notification_prefs`, missing row = everything on). */
export function useNotificationPrefs() {
  const { user } = useSession();
  return useQuery({
    queryKey: notifPrefsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<NotificationPrefs> => {
      const { data, error } = await supabase
        .from('notification_prefs')
        .select('invites, uploads, chats, reveals, games')
        .eq('user_id', user?.id as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      return (data as NotificationPrefs | null) ?? DEFAULT_PREFS;
    },
  });
}

export function useSetNotificationPref() {
  const { user } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      const cur = qc.getQueryData<NotificationPrefs>(notifPrefsKey(user?.id)) ?? DEFAULT_PREFS;
      const { error } = await supabase
        .from('notification_prefs')
        .upsert({ user_id: user?.id as string, ...cur, ...patch }, { onConflict: 'user_id' });
      if (error) throw toAppError(error);
    },
    onMutate: async (patch) => {
      const prev = qc.getQueryData<NotificationPrefs>(notifPrefsKey(user?.id)) ?? DEFAULT_PREFS;
      qc.setQueryData(notifPrefsKey(user?.id), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(notifPrefsKey(user?.id), ctx.prev);
    },
  });
}

// ---------------------------------------------------------------- account function

/** "Export everything I've uploaded": manifest with 24 h download links. */
export function exportMyData(): Promise<AccountExport> {
  return callFunction<AccountExport>('account', { action: 'export' }, { timeoutMs: 60_000 });
}

/** Crews the person must hand over before the account can be deleted (`last_host`). */
export function lastHostCrews(e: unknown): LastHostCrew[] {
  const err = toAppError(e);
  if (err.code !== 'last_host') return [];
  const d = err.details as { crews?: unknown } | undefined;
  const crews = Array.isArray(d?.crews) ? d?.crews : [];
  return crews.filter((c): c is LastHostCrew => !!c && typeof (c as LastHostCrew).id === 'string');
}

export function deleteMyAccount(): Promise<{ deleted: boolean }> {
  return callFunction<{ deleted: boolean }>(
    'account',
    { action: 'delete', confirm: 'DELETE' },
    { timeoutMs: 60_000 },
  );
}

export { AppError };
