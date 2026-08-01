/**
 * What this zone played before.
 *
 * Read-only apart from clearing, which matches the API: history has no handle to rename or
 * reorder, and `source` is what you hand back to `play`.
 *
 * There is no verification timer here any more. `play` still answers `204` before anything has
 * been resolved — it cannot do otherwise, resolution is asynchronous — but a failure now
 * arrives as `zone.error` on a `zone.changed`, with a reason worth reading (`Sign-in required`,
 * `Output unavailable`). So the pattern is the one the contract always intended: send the
 * command, watch the stream. `NowPlayingView` renders that error, which is why this panel
 * carries none of its own.
 */
import { useApi, useServer } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import { ItemCover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useAddFavorite } from '@/state/useAddFavorite';
import { subtitleOf } from '@/lib/format';
import type { ApiRecents, ApiZoneState } from '@/api/types';

export function RecentsPanel({ zone }: { zone: ApiZoneState }) {
  const api = useApi();
  const { api: client } = useServer();

  const recents = useZoneCollection<ApiRecents>(
    (zoneId) => client.getRecents(zoneId, 0, 25),
    zone.id,
    'recents',
    // Same reason as the queue: no events reach a local destination.
    [zone.track?.title],
  );

  const favorites = useAddFavorite();
  const items = recents.data?.items ?? [];

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Recently played</h2>
        {items.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => void api.clearRecents(zone.id)}
          >
            Clear
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="hint">{recents.loading ? 'Loading…' : 'Nothing played in this zone yet.'}</p>
      ) : (
        <ul className="item-list">
          {items.map((item) => (
            <li key={`${item.source}:${item.title}`}>
              <button
                type="button"
                className="item-row"
                onClick={() => void api.play(zone.id, item.source)}
                title="Play again"
              >
                <ItemCover url={item.coverUrl} className="tiny" />
                <span className="item-text">
                  <span className="item-title">{item.title}</span>
                  <span className="item-sub">{subtitleOf(item)}</span>
                </span>
                {item.service && <span className="item-meta">{item.service}</span>}
              </button>
              {/* Recents are the other place a favourite naturally starts: you heard it, you
                  want it back. `source` is the same opaque id `play` takes. */}
              <FavoriteButton
                zone={zone}
                uri={item.source}
                name={item.title}
                pending={favorites.pending === item.source}
                saved={favorites.saved === item.source}
                onAdd={favorites.add}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
