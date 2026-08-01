/**
 * The live zone store: SSE events in, a sorted zone list out.
 *
 * Kept as a plain class rather than a reducer in a component so the event handling is
 * testable without React, and so the subscribe/notify cost of a once-a-second
 * `zone.progress` per playing zone is paid in one place.
 *
 * The contract does the hard part. Because `zone.changed` always carries the complete
 * zone and every stream opens with a full snapshot, this store never merges partial
 * state: it replaces a zone wholesale, or replaces the entire map on `server.ready`.
 * There is no reconciliation, no "which field won" and no staleness to age out.
 *
 * Events are stored **verbatim** — not normalised on the way in. `powerState`, `format` and
 * `track.colors` are all required fields the server's one zone projection always emits, so
 * there is no shape to reconcile; a translation layer here would only be a second, quieter
 * definition of the wire format, and one that goes stale silently. If the wire shape ever does
 * change, `api/types.ts` is where that gets said, and the compiler names every consumer.
 */
import type { ApiEvent, ApiZoneState } from '@/api/types';

export type ZoneStoreListener = (zones: ApiZoneState[]) => void;

/** Which of a zone's collections the server says is stale. */
export type CollectionKind = 'queue' | 'favorites' | 'recents';

export type CollectionListener = (zoneId: number, kind: CollectionKind) => void;

/** Maps the event name onto the collection it invalidates. */
const COLLECTION_EVENTS: Record<string, CollectionKind> = {
  'queue.changed': 'queue',
  'favorites.changed': 'favorites',
  'recents.changed': 'recents',
};

export class ZoneStore {
  private zones = new Map<number, ApiZoneState>();
  private ordered: ApiZoneState[] = [];
  private readonly listeners = new Set<ZoneStoreListener>();
  private readonly collectionListeners = new Set<CollectionListener>();

  /** The current zones, ordered by id so the UI never reshuffles on an update. */
  get snapshot(): ApiZoneState[] {
    return this.ordered;
  }

  subscribe(listener: ZoneStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notified when a zone's queue, favourites or recents changed.
   *
   * Kept separate from the zone listeners because these carry no data worth storing — the
   * events say "yours is stale", not what the collection now is, since a paged collection
   * should not be pushed. Whoever is showing one re-reads; nobody else does anything.
   */
  subscribeCollections(listener: CollectionListener): () => void {
    this.collectionListeners.add(listener);
    return () => {
      this.collectionListeners.delete(listener);
    };
  }

  /**
   * Applies one event.
   *
   * An unrecognised `type` is ignored on purpose: the contract calls new event types
   * additive, so failing on one would make this client break on a server upgrade.
   */
  apply(event: ApiEvent): void {
    switch (event.type) {
      case 'server.ready': {
        // A fresh snapshot is the whole truth — including zones that disappeared while
        // we were disconnected, which is why this replaces the map instead of merging.
        const { zones } = event as { zones: ApiZoneState[] };
        this.zones = new Map(zones.map((zone) => [zone.id, zone]));
        this.publish();
        return;
      }
      case 'zone.changed': {
        const { zone } = event as { zone: ApiZoneState };
        this.zones.set(zone.id, zone);
        this.publish();
        return;
      }
      case 'zone.progress': {
        const { id, position } = event as { id: number; position: number };
        const current = this.zones.get(id);
        if (!current || current.position === position) {
          return;
        }
        // The one event that is not a whole zone. Patched onto the last known state,
        // which is safe because anything *else* that changed would have arrived as a
        // full zone.changed instead.
        this.zones.set(id, { ...current, position });
        this.publish();
        return;
      }
      default: {
        // queue/favorites/recents `.changed` — an invalidation, not state. Anything else is
        // an event type this build predates, and is ignored: new types are additive.
        const kind = COLLECTION_EVENTS[event.type];
        if (kind) {
          const { id } = event as { id: number };
          for (const listener of this.collectionListeners) {
            listener(id, kind);
          }
        }
        return;
      }
    }
  }

  private publish(): void {
    this.ordered = [...this.zones.values()].sort((a, b) => a.id - b.id);
    for (const listener of this.listeners) {
      listener(this.ordered);
    }
  }
}
