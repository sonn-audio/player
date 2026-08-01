/**
 * A zone's favourites — and, with no content API yet, the main way to start music.
 *
 * A favourite's `id` is its handle for playing, renaming, reordering and removing. The
 * Loxone clients also carry a `slot` and a `plus` flag, which describe their own button
 * grid rather than the favourite, so neither exists here — reordering is simply the order
 * you send.
 *
 * "Save what is playing" posts `source.id` back, which is the round trip the contract is
 * built on: an opaque id read from a zone, handed straight back as a `uri`.
 */
import { useApi, useServer } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import { ItemCover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import type { ApiFavorites, ApiZoneState } from '@/api/types';

export function FavoritesPanel({ zone }: { zone: ApiZoneState }) {
  const api = useApi();
  const { api: client } = useServer();

  const favorites = useZoneCollection<ApiFavorites>(
    (zoneId) => client.getFavorites(zoneId),
    zone.id,
    'favorites',
  );

  /** `favorites.changed` re-reads the list; only a failed write needs a forced refresh. */
  const act = (run: Promise<unknown>) => {
    void run.catch(() => favorites.refresh());
  };

  const items = favorites.data?.items ?? [];
  // Only offer to save what is actually re-playable: a source with no id cannot be
  // handed back to `play`, so a favourite made from it would be a dead entry.
  const savable = zone.source?.id;

  const rename = (id: number, current: string) => {
    const name = window.prompt('Rename favourite', current);
    if (name && name !== current) {
      act(api.renameFavorite(zone.id, id, name));
    }
  };

  /** Reordering is the whole list, so a move is expressed as the new order. */
  const move = (id: number, direction: -1 | 1) => {
    const order = items.map((item) => item.id);
    const from = order.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) {
      return;
    }
    [order[from], order[to]] = [order[to]!, order[from]!];
    act(api.reorderFavorites(zone.id, order));
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>
          Favourites {items.length > 0 && <span className="count">{items.length}</span>}
        </h2>
        {savable && (
          <button
            type="button"
            className="text-button"
            onClick={() => act(api.addFavorite(zone.id, savable))}
            title="Save what is playing as a favourite"
          >
            <Icon name="star" /> Save current
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="hint">
          {favorites.loading ? 'Loading…' : 'No favourites yet for this zone.'}
        </p>
      ) : (
        <ul className="item-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="item-row"
                onClick={() => act(api.playFavorite(zone.id, item.id))}
                title="Play"
              >
                <ItemCover url={item.coverUrl} className="tiny" />
                <span className="item-text">
                  <span className="item-title">{item.name}</span>
                </span>
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(item.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(item.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Rename"
                  onClick={() => rename(item.id, item.name)}
                >
                  <Icon name="sliders" />
                </button>
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Remove"
                  onClick={() => act(api.removeFavorite(zone.id, item.id))}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
