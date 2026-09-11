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

/**
 * The room's running order, and where in it the room has got to.
 *
 * Re-read when the server says the queue changed *and* when the record changes, which are not the
 * same event and only one of them was being listened to. Pressing next moves nothing in the queue —
 * the same entries stand in the same order — so no `queue.changed` is emitted and none should be.
 * What moves is `currentIndex`, and everything this face draws from a queue is drawn from *after*
 * that index: the shelf on the stage, the count beside `up next`, the head of the queue sheet. With
 * only the invalidation to go on they all stayed pinned to whichever track was playing when the
 * queue was last fetched, so a stage could show `Shiver` as the next record while Shiver played.
 *
 * So the caller hands over what is on the wire — the provider's own handle for the audio, which is a
 * different string for every track — and the page is re-read when that changes. One request per
 * track change, which is the same cost as the event that is not coming.
 */
export function useQueue(
  zoneId: number | null,
  /** The playing record's own id: `zone.source.id`, which changes on next, previous and a new queue. */
  playing?: string | undefined,
): { queue: ApiQueue; refresh: () => void } {
  const api = useApi();
  const { data, refresh } = useZoneCollection<ApiQueue>(
    (id) => api.getQueue(id, 0, PAGE),
    zoneId,
    'queue',
    [playing],
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
