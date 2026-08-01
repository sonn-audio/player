/**
 * A zone's queue and recents, for the art face.
 *
 * Thin wrappers over `useZoneCollection`, which is the shared primitive both faces use: it reads a
 * page and re-reads it when the server says that collection went stale (`queue.changed`,
 * `recents.changed`). Those events are deliberately contentless — a paged queue can hold thousands
 * of entries, so the stream says "yours is stale" and leaves the re-read to whoever is showing one.
 *
 * One page each. This face shows a rail and a sheet, not a database browser: fifty entries is more
 * than anyone scrolls in a sheet, and "load more" is a technical-player affordance.
 *
 * Favourites are not here — the heart is the same state in both faces, so it lives in
 * `state/useZoneFavorite`.
 */
import { useApi } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import type { ApiQueue, ApiRecentItem } from '@/api/types';

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

export function useRecents(zoneId: number | null): ApiRecentItem[] {
  const api = useApi();
  const { data } = useZoneCollection<ApiRecentItem[]>(
    async (id) => (await api.getRecents(id, 0, PAGE)).items,
    zoneId,
    'recents',
  );
  return data ?? [];
}
