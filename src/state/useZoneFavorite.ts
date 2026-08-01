/**
 * Whether what a room is playing is one of its favourites — and the toggle for it.
 *
 * Distinct from `useAddFavorite`, which is the fire-and-forget "save this row" used all over the
 * browser and the queue. This one is *stateful*: the heart in the now-playing block has to know
 * whether it is already filled, which means reading the room's favourites and looking for the source
 * that is playing.
 *
 * The membership test is on `source.id` — the opaque id the API hands out and takes back — never on
 * the display name: two stations can share a name, and a favourite renamed by hand would stop
 * matching its own track. `source.id` is absent on sources that cannot be restarted by id (a
 * line-in), which is exactly when the heart should not be offered at all, so this reports
 * `available: false` and the caller renders nothing.
 *
 * Both faces use this, which is the point: the technical player's heart and the art player's heart
 * are the same state, so they cannot disagree about whether something is saved.
 */
import { useCallback } from 'react';
import { useApi } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import type { ApiFavorite, ApiFavorites, ApiZoneState } from '@/api/types';

/** One page is plenty: a room's favourites are a shortlist, not a library. */
const PAGE = 50;

export type ZoneFavorite = {
  /** Whether a heart makes sense at all for this source. */
  available: boolean;
  /** The matching favourite, or null when this is not saved. */
  saved: ApiFavorite | null;
  /** Every favourite of the room, for callers that list them. */
  items: ApiFavorite[];
  /** Adds or removes, whichever applies. */
  toggle: () => void;
};

export function useZoneFavorite(zone: ApiZoneState | null): ZoneFavorite {
  const api = useApi();
  const zoneId = zone?.id ?? null;
  const sourceId = zone?.source?.id;

  const { data, refresh } = useZoneCollection<ApiFavorites>(
    (id) => api.getFavorites(id, 0, PAGE),
    zoneId,
    'favorites',
  );

  const items = data?.items ?? [];
  const saved = sourceId ? (items.find((favorite) => favorite.source === sourceId) ?? null) : null;

  const toggle = useCallback(() => {
    if (zoneId === null || !sourceId) {
      return;
    }
    const name = zone?.track?.title || zone?.source?.name || 'Favourite';
    const promise = saved
      ? api.removeFavorite(zoneId, saved.id)
      : api.addFavorite(zoneId, sourceId, name);
    /*
     * Refresh on the response as well as on the event.
     *
     * `favorites.changed` arrives and re-reads this anyway — that is what keeps a second tab
     * correct — but refreshing here too is what makes the heart fill on *this* click rather than
     * on the round trip after it. Refreshing on failure as well, because the list is then the only
     * authority on what actually happened.
     */
    void promise.then(refresh).catch(refresh);
  }, [api, zoneId, sourceId, saved, refresh, zone?.track?.title, zone?.source?.name]);

  return { available: Boolean(zoneId !== null && sourceId), saved, items, toggle };
}
