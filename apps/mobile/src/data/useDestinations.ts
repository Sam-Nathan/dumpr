import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  pickDefaultDestination,
  toDestinationRoll,
  type RollRow,
} from '../features/camera/destination';
import { toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { rpc } from './rpc';
import { useSession } from './session';
import type { DestinationCrew, DestinationRoll, HomeFeedLite, RollHeaderLite } from './types-cf';

/** Same key as B1: `home_feed()` is one call; this track reads live rolls + crew roles from it. */
export const homeFeedKey = ['home-feed'] as const;
export const destinationsKey = ['destinations'] as const;
export const rollHeaderKey = (rollId: string) => ['roll-header', rollId] as const;

export function useHomeFeedLite() {
  const { user } = useSession();
  return useQuery({
    queryKey: homeFeedKey,
    enabled: !!user,
    queryFn: () => rpc<HomeFeedLite>('home_feed'),
  });
}

/** `roll_header(rollId)` (B3 uses the same key). */
export function useRollHeaderLite(rollId: string | null | undefined) {
  return useQuery({
    queryKey: rollHeaderKey(rollId ?? ''),
    enabled: !!rollId,
    queryFn: () => rpc<RollHeaderLite>('roll_header', { p_roll_id: rollId }),
  });
}

const ROLL_SELECT =
  'id, name, crew_id, starts_on, ends_on, reveal_at, locked_until, allow_uploads, created_by, last_activity_at, cover_photo_id, crews!inner(id, name, tint, deleted_at)';

/**
 * Rolls the viewer can post to / import into, most recently active first, plus their crews. Built
 * from the `rolls` table (RLS decides what is visible) and the home feed (live rolls, crew roles).
 */
export function useDestinations() {
  const { user } = useSession();
  const feed = useHomeFeedLite();
  const rolls = useQuery({
    queryKey: destinationsKey,
    enabled: !!user,
    queryFn: async (): Promise<RollRow[]> => {
      const { data, error } = await supabase
        .from('rolls')
        .select(ROLL_SELECT)
        .is('deleted_at', null)
        .is('crews.deleted_at', null)
        .order('last_activity_at', { ascending: false })
        .limit(40);
      if (error) throw toAppError(error);
      return (data ?? []) as unknown as RollRow[];
    },
  });

  const list = useMemo<DestinationRoll[]>(() => {
    const liveIds = new Set((feed.data?.live_rolls ?? []).map((r) => r.id));
    const adminCrewIds = new Set(
      (feed.data?.crews ?? [])
        .filter((c) => c.role === 'host' || c.role === 'cohost')
        .map((c) => c.id),
    );
    return (rolls.data ?? []).flatMap((row) => {
      const d = toDestinationRoll(row, { liveIds, adminCrewIds, meId: user?.id ?? null });
      return d ? [d] : [];
    });
  }, [rolls.data, feed.data, user?.id]);

  const crews = useMemo<DestinationCrew[]>(
    () => (feed.data?.crews ?? []).map((c) => ({ id: c.id, name: c.name, tint: c.tint })),
    [feed.data],
  );

  return {
    rolls: list,
    crews,
    isLoading: rolls.isLoading,
    isError: rolls.isError,
    error: rolls.error,
    refetch: () => {
      void rolls.refetch();
      void feed.refetch();
    },
  };
}

// ---------------------------------------------------------------- choice handed back by C2

export type DestinationPurpose = 'camera' | 'import';

interface DestinationStore {
  /** Last roll photos were posted to (persisted). */
  lastRollId: string | null;
  /** The choice the sheet made, for the screen that opened it. */
  chosen: { purpose: DestinationPurpose; rollId: string; nonce: number } | null;
  setLast: (id: string) => void;
  choose: (purpose: DestinationPurpose, rollId: string) => void;
}

const LAST_KEY = 'dumpr.lastRollId';
let hydrated = false;

export const useDestinationStore = create<DestinationStore>((set, get) => ({
  lastRollId: null,
  chosen: null,
  setLast: (id) => {
    set({ lastRollId: id });
    void AsyncStorage.setItem(LAST_KEY, id).catch(() => undefined);
  },
  choose: (purpose, rollId) =>
    set({ chosen: { purpose, rollId, nonce: (get().chosen?.nonce ?? 0) + 1 } }),
}));

/** Loads the persisted last roll once. */
function hydrateLast() {
  if (hydrated) return;
  hydrated = true;
  AsyncStorage.getItem(LAST_KEY)
    .then((v) => {
      if (v && !useDestinationStore.getState().lastRollId)
        useDestinationStore.setState({ lastRollId: v });
    })
    .catch(() => undefined);
}

function headerToDestination(h: RollHeaderLite): DestinationRoll {
  return {
    id: h.roll.id,
    name: h.roll.name,
    crewId: h.roll.crew_id,
    crewName: h.crew.name,
    tint: h.crew.tint,
    live: false,
    uploadsClosed: !h.my.can_upload,
    sealed: h.sealed,
    startsOn: h.roll.starts_on,
    endsOn: h.roll.ends_on,
    lastActivityAt: null,
    coverPhotoId: null,
  };
}

/**
 * The destination for the camera / import: the roll in the URL, else the live roll, else the last
 * one used, else the most recent. `setRollId` follows a choice made in the C2 sheet.
 */
export function useDestinationRoll(purpose: DestinationPurpose, preferredId?: string | null) {
  const { rolls, isLoading, isError, refetch } = useDestinations();
  const lastRollId = useDestinationStore((s) => s.lastRollId);
  const chosen = useDestinationStore((s) => s.chosen);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const seenNonce = useRef(chosen?.nonce ?? 0);

  useEffect(() => hydrateLast(), []);
  useEffect(() => {
    if (chosen && chosen.nonce !== seenNonce.current && chosen.purpose === purpose) {
      seenNonce.current = chosen.nonce;
      setOverrideId(chosen.rollId);
    }
  }, [chosen, purpose]);

  const wantedId = overrideId ?? preferredId ?? null;
  const inList = wantedId ? rolls.find((r) => r.id === wantedId) : undefined;
  // A roll that is not among the 40 most recent: ask for its header.
  const header = useQuery({
    queryKey: rollHeaderKey(wantedId ?? ''),
    enabled: !!wantedId && !inList && !isLoading,
    queryFn: () => rpc<RollHeaderLite>('roll_header', { p_roll_id: wantedId }),
  });

  const roll = useMemo<DestinationRoll | null>(() => {
    if (inList) return inList;
    if (wantedId && header.data) return headerToDestination(header.data);
    if (wantedId && (header.isLoading || header.isFetching)) return null;
    return pickDefaultDestination(rolls, { lastUsedId: lastRollId });
  }, [inList, wantedId, header.data, header.isLoading, header.isFetching, rolls, lastRollId]);

  const setRollId = useCallback((id: string) => setOverrideId(id), []);
  return {
    roll,
    setRollId,
    isLoading: isLoading || (!!wantedId && !inList && header.isLoading),
    isError,
    refetch,
    rolls,
  };
}
