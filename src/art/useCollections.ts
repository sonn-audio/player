/**
 * A zone's queue and recents, for the art face.
 *
 * Thin wrappers over `useZoneCollection`, which is the shared primitive both faces use: it reads a
 * page and re-reads it when the server says that collection went stale (`queue.changed`,
 * `recents.changed`). Those events are deliberately contentless — a paged queue can hold thousands
 * of entries, so the stream says "yours is stale" and leaves the re-read to whoever is showing one.
 *
 * One page each. This face shows a rail and a sheet, not a database browser: fifty entries is more
 * than anyone scrolls in a sheet, and paging past that is a technical-player affordance.
 *
 * Whether a *given track* is a favourite is not here — the heart is the same state in both faces,
 * so that lives in `state/useZoneFavorite`. The room's saved list is a collection like the other
 * two and reads exactly like them.
 */
import { useApi } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import type { ApiFavorite, ApiQueue, ApiRecentItem } from '@/api/types';

const PAGE = 50;

const EMPTY_QUEUE: ApiQueue = { zoneId: 0, items: [], start: 0, total: 0, currentIndex: null };

export function useQueue(zoneId: number | null): { queue: ApiQueue; refresh: () => void } {
  const api = useApi();
  const { data, refresh } = useZoneCollection<ApiQueue>(
    (id) => api.getQueue(id, 0, PAGE),
    zoneId,
    'queue',
  );
  return { queue: data ?? EMPTY_QUEUE, refresh };
}

/** The room's saved list — home's second shelf, and the only one that is a deliberate choice. */
export function useFavorites(zoneId: number | null): ApiFavorite[] {
  const api = useApi();
  const { data } = useZoneCollection<ApiFavorite[]>(
    async (id) => (await api.getFavorites(id, 0, PAGE)).items,
    zoneId,
    'favorites',
  );
  return data ?? [];
}

export function useRecents(zoneId: number | null): ApiRecentItem[] {
  const api = useApi();
  const { data } = useZoneCollection<ApiRecentItem[]>(
    async (id) => (await api.getRecents(id, 0, PAGE)).items,
    zoneId,
    'recents',
  );
  return data ?? [];
}
