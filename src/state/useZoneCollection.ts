/**
 * Reads a zone's queue / favourites / recents, and keeps them fresh.
 *
 * These are paged, so the server does not push their contents — it pushes an invalidation
 * (`queue.changed`, `favorites.changed`, `recents.changed`) carrying the zone id and a size,
 * and a client showing that collection re-reads the page it is on. That is the right split: a
 * queue can hold thousands of entries, and pushing all of them to say one moved would cost
 * more than the read it saves.
 *
 * The invalidation is what drives refreshes, so this covers **another** client's edits as well
 * as our own — a second tab, a wall panel, the Loxone app. Earlier this hook watched fields on
 * the zone as a proxy, because queue mutations emitted nothing at all; that guesswork is gone.
 *
 * **One zone gets no events at all:** this browser as a local destination is excluded from the
 * event stream by design, so no `queue.changed` ever arrives for it and its queue would stay
 * blank while a track played. `watch` exists for that case — the caller passes something that
 * moves when playback does, and the collection re-reads on it.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { useServer } from '@/state/ServerContext';
import type { CollectionKind } from '@/state/zoneStore';

export type Collection<T> = {
  data: T | null;
  loading: boolean;
  /** The API's error code, or null. `zone-not-found` is expected while zones settle. */
  error: string | null;
  /** Force a re-read. Rarely needed now that the server says when to. */
  refresh: () => void;
};

/**
 * @param load    Fetches the collection for a zone.
 * @param zoneId  Which zone; null suspends fetching entirely.
 * @param kind    Which invalidation event should trigger a re-read.
 * @param watch   Extra values that also force a re-read. Needed for a zone that receives no
 *                events at all — see the note on local destinations below.
 */
export function useZoneCollection<T>(
  load: (zoneId: number) => Promise<T>,
  zoneId: number | null,
  kind: CollectionKind,
  watch: ReadonlyArray<unknown> = [],
): Collection<T> {
  const { store } = useServer();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  // Re-read when the server says this zone's collection changed. Registered separately from
  // the fetch below so a burst of events does not cancel an in-flight request.
  useEffect(() => {
    if (zoneId === null) {
      return;
    }
    return store.subscribeCollections((changedZone, changedKind) => {
      if (changedZone === zoneId && changedKind === kind) {
        refresh();
      }
    });
  }, [store, zoneId, kind, refresh]);

  useEffect(() => {
    if (zoneId === null) {
      setData(null);
      return;
    }
    // Guards against a slow response for the previous zone landing after the user has
    // already switched — which would show the wrong room's queue.
    let current = true;
    setLoading(true);
    load(zoneId)
      .then((result) => {
        if (!current) {
          return;
        }
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!current) {
          return;
        }
        setError(err instanceof ApiError ? err.code : 'network-error');
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
    // `load` is a fresh closure each render, so depending on it would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, nonce, ...watch]);

  return { data, loading, error, refresh };
}
