/**
 * Browsing and search.
 *
 * The two things this view has to get right, both read off the item rather than guessed:
 *
 *  - **`browsable` and `playable` are independent.** An album is both. So a row opens on tap
 *    when it can be opened, and carries a separate play affordance when it can be played —
 *    rather than one behaviour inferred from `kind`.
 *  - **`total` may be `null`,** meaning the provider cannot count. "Load more" is therefore
 *    offered whenever a page came back full, not when a running count says there is more.
 *
 * Breadcrumbs are kept as a client-side stack. The server names the container it listed, but a
 * listing does not carry its ancestors — and for the folder case it cannot even name itself
 * (providers hardcode the literal "Album"), so the trail this view walked in on is the better
 * source for the path. Falling back to the container's own name when we arrived cold.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import type { ContentItem, ContentListing, ContentService } from '@/api/content';
import { ItemCover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { FavoriteButton } from '@/components/FavoriteButton';
import { FavoritesPanel } from '@/components/FavoritesPanel';
import { RecentsPanel } from '@/components/RecentsPanel';
import { ServiceBadge } from '@/components/ServiceBadge';
import { useAddFavorite, type AddFavoriteState } from '@/state/useAddFavorite';
import { formatTime } from '@/lib/format';
import type { ApiPlaylist, ApiZoneState } from '@/api/types';

/** One page. The server caps it; this is a screenful of a grid. */
const PAGE_SIZE = 60;

/** The order search buckets are shown in — most specific first. */
const KIND_ORDER = ['track', 'album', 'artist', 'playlist', 'radio', 'show', 'episode'];

const KIND_LABELS: Record<string, string> = {
  track: 'Tracks',
  album: 'Albums',
  artist: 'Artists',
  playlist: 'Playlists',
  radio: 'Stations',
  show: 'Shows',
  episode: 'Episodes',
};

type Crumb = { id: string; name: string };

/**
 * Where the browser should open, when the left rail said so.
 *
 * `initialId` seeds the breadcrumb trail rather than replacing it, so "Albums" in the nav and
 * "Albums" reached by clicking through the library land in the same place with the same Back
 * behaviour — the rail is a shortcut into the tree, not a separate mode.
 */
export type ContentViewProps = {
  zone: ApiZoneState | null;
  /** A browse id to open instead of the root. */
  initialId?: string;
  /** Its display name, so the crumb reads correctly before the listing has loaded. */
  initialLabel?: string;
  /** Show a zone-scoped collection instead of the catalogue. */
  collection?: 'favorites' | 'recents';
  /**
   * Bumped every time the rail's search button is pressed; focuses the field.
   *
   * A counter rather than a boolean because focusing is an action, and pressing search twice should
   * work twice — a flag that is already `true` produces no change for an effect to react to.
   */
  searchNonce?: number;
};

export function ContentView({ zone, ...rest }: ContentViewProps) {
  const { content } = useServer();

  if (!content.available) {
    return (
      <div className="content-empty">
        <Icon name="search" className="content-empty-icon" />
        <h2>Browsing is not available</h2>
        <p>
          {content instanceof Object && 'reason' in content
            ? String((content as { reason: string }).reason)
            : 'This server does not expose a content API.'}
        </p>
      </div>
    );
  }
  /*
   * A zone-scoped collection, shown in the content column.
   *
   * Reuses the panels the now-playing view uses rather than re-listing favourites here: they
   * already own the invalidation handling (`favorites.changed` / `recents.changed`) and the
   * rename/reorder actions, and a second implementation would be a second thing to keep true.
   */
  if (rest.collection) {
    if (!zone) {
      return (
        <div className="content-empty">
          <Icon name="star" className="content-empty-icon" />
          <h2>No room selected</h2>
          <p>Favourites and recents belong to a room. Pick one to see them.</p>
        </div>
      );
    }
    return (
      <div className="content">
        {rest.collection === 'favorites' ? (
          <FavoritesPanel zone={zone} />
        ) : (
          <RecentsPanel zone={zone} />
        )}
      </div>
    );
  }

  return <ContentBrowser zone={zone} {...rest} />;
}

// `collection` is resolved by the wrapper above, so it never reaches here.
function ContentBrowser({
  zone,
  initialId,
  initialLabel,
  searchNonce = 0,
}: Omit<ContentViewProps, 'collection'>) {
  const api = useApi();
  const { content } = useServer();

  const [trail, setTrail] = useState<Crumb[]>(
    initialId ? [{ id: initialId, name: initialLabel ?? '…' }] : [],
  );
  const [listing, setListing] = useState<ContentListing | null>(null);
  const [extra, setExtra] = useState<ContentItem[]>([]);
  const [services, setServices] = useState<ContentService[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record<string, ContentItem[]> | null>(null);
  const [failedServices, setFailedServices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [playlistRefresh, setPlaylistRefresh] = useState(0);
  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const favorites = useAddFavorite();
  // Browse and pagination requests can finish after the user has moved to another folder.
  // Results from that old route must never be appended to the current listing.
  const browseGeneration = useRef(0);

  /*
   * The search field, focused when the rail's search button was the way in.
   *
   * Keyed on the counter rather than run once on mount: pressing search again while already browsing
   * should put the cursor back in the field, which is the whole point of that button. Skipped at 0
   * so arriving by any other route does not steal focus.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchNonce > 0) {
      searchRef.current?.focus();
    }
  }, [searchNonce]);

  const here = trail.length > 0 ? trail[trail.length - 1]! : null;

  /*
   * Follow the rail when it points somewhere new.
   *
   * The initial state above only covers arriving from another view; this covers clicking a second
   * nav entry while already browsing, where the component stays mounted and `useState` would keep
   * the old trail. Resetting to a one-crumb trail rather than pushing is deliberate — the rail is
   * a jump, so Back from there should leave the tree rather than retrace a route the user never
   * walked.
   */
  useEffect(() => {
    if (!initialId) {
      return;
    }
    setTrail((prev) =>
      prev.length === 1 && prev[0]!.id === initialId
        ? prev
        : [{ id: initialId, name: initialLabel ?? '…' }],
    );
    // A jump is a new context: a stale search overlay would hide the destination.
    setResults(null);
    setQuery('');
  }, [initialId, initialLabel]);

  // `item.service` is an id (`applemusic`); `GET /services` is the only place its display name
  // ("Apple Music") lives, so it is looked up rather than prettified from the id.
  const serviceNames = useMemo(
    () => Object.fromEntries(services.map((s) => [s.id, s.name])),
    [services],
  );

  useEffect(() => {
    void content.services().then(setServices);
  }, [content]);

  useEffect(() => {
    let current = true;
    api.getPlaylists(0, 200).then((page) => {
      if (current) setPlaylists(page.items);
    }).catch(() => {
      if (current) setPlaylists([]);
    });
    return () => { current = false; };
  }, [api, playlistRefresh]);

  // Load the current container (or the root when the trail is empty).
  useEffect(() => {
    let current = true;
    browseGeneration.current += 1;
    setBusy(true);
    setListing(null);
    setExtra([]);
    content
      .browse(here?.id, 0, PAGE_SIZE)
      .then((page) => {
        if (current) {
          setListing(page);
        }
      })
      .finally(() => {
        if (current) {
          setBusy(false);
        }
      });
    return () => {
      current = false;
    };
  }, [content, here?.id, playlistRefresh]);

  const createPlaylist = async () => {
    const name = window.prompt('Playlist name');
    if (!name?.trim()) return;
    await api.createPlaylist(name.trim());
    setPlaylistRefresh((value) => value + 1);
  };

  const renamePlaylist = async (item: ContentItem) => {
    const name = window.prompt('New playlist name', item.name);
    if (!name?.trim()) return;
    await api.renamePlaylist(item.id, name.trim());
    setPlaylistRefresh((value) => value + 1);
  };

  const deletePlaylist = async (item: ContentItem) => {
    if (!window.confirm(`Delete playlist “${item.name}”?`)) return;
    await api.deletePlaylist(item.id);
    setPlaylistRefresh((value) => value + 1);
  };

  const addToPlaylist = async (playlistId: string, itemId: string) => {
    await api.addToPlaylist(playlistId, itemId);
    setPlaylistRefresh((value) => value + 1);
  };

  const playlistId = listing?.container?.kind === 'playlist' ? here?.id : undefined;
  const removePlaylistItem = async (position: number) => {
    if (!playlistId) return;
    await api.removeFromPlaylist(playlistId, position);
    setPlaylistRefresh((value) => value + 1);
  };

  const movePlaylistItem = async (from: number, to: number) => {
    if (!playlistId) return;
    await api.movePlaylistItem(playlistId, from, to);
    setPlaylistRefresh((value) => value + 1);
  };

  const runSearch = useCallback(
    (term: string) => {
      setQuery(term);
      if (!term.trim()) {
        setResults(null);
        setFailedServices([]);
        return;
      }
      void content.search(term, { limit: 12 }).then((found) => {
        setResults(found.items as Record<string, ContentItem[]>);
        setFailedServices(found.services.filter((s) => s.failed).map((s) => s.service));
      });
    },
    [content],
  );

  const open = (item: ContentItem) => {
    setResults(null);
    setQuery('');
    setTrail((prev) => [...prev, { id: item.id, name: item.name }]);
  };

  /**
   * Starts an item in the selected zone.
   *
   * The browse id goes straight to `play`, which is what the contract promises and what now
   * happens. Nothing is verified here: a failure arrives as `zone.error` over the event stream
   * and is rendered where the zone is, rather than being polled for from the browser.
   */
  const play = (item: ContentItem) => {
    if (zone) {
      void api.play(zone.id, item.id);
    }
  };

  const loadMore = () => {
    const generation = browseGeneration.current;
    const loaded = (listing?.items.length ?? 0) + extra.length;
    void content.browse(here?.id, loaded, PAGE_SIZE).then((page) => {
      if (generation === browseGeneration.current) {
        setExtra((prev) => [...prev, ...page.items]);
      }
    });
  };

  const items = [...(listing?.items ?? []), ...extra];
  // `total === null` means the provider cannot count, so completeness is judged by whether
  // the last page came back full rather than by comparing against a number that does not exist.
  const maybeMore =
    listing !== null &&
    (listing.total === null
      ? (extra.length > 0 ? extra.length % PAGE_SIZE === 0 : listing.items.length === PAGE_SIZE)
      : items.length < listing.total);

  return (
    <div className="content">
      <div className="content-bar">
        <label className="search">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={
              zone ? `Search ${services.length} services — plays in ${zone.name}` : 'Search'
            }
            onChange={(event) => runSearch(event.target.value)}
          />
          {/* Only when there is something to clear, and drawn here rather than by the platform —
              `type="search"` otherwise supplies Chromium's own grey circle. */}
          {query && (
            <button
              type="button"
              className="icon-button small ghost search-clear"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => {
                runSearch('');
                searchRef.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          )}
        </label>
      </div>

      {!results && (
        <nav className="crumbs">
          <button type="button" className="text-button" onClick={() => setTrail([])}>
            Services
          </button>
          {trail.map((crumb, index) => (
            <button
              key={crumb.id}
              type="button"
              className="text-button"
              onClick={() => setTrail((prev) => prev.slice(0, index + 1))}
            >
              <Icon name="chevron-right" />
              {/* A folder cannot always name itself, so prefer the name we walked in with. */}
              {crumb.name || listing?.container?.name || '…'}
            </button>
          ))}
          {here?.name === 'Local Media' && (
            <button type="button" className="text-button" onClick={() => void createPlaylist()}>
              + New playlist
            </button>
          )}
        </nav>
      )}

      {/*
        Everything below the search field and the breadcrumbs scrolls; those two stay.
        The field is what you reach for after scrolling a long way, so it is the wrong thing to
        have to scroll back to — and the crumbs are how you get out of where that scrolling took
        you.
      */}
      <div className="content-scroll">
      {!results && listing?.sections && listing.sections.length > 0 && <h1 className="home-title">Home</h1>}

      {failedServices.length > 0 && (
        <p className="notice warn">
          No results from: {failedServices.join(', ')}.
        </p>
      )}

      {favorites.error && (
        <p className="notice warn">Could not add that favourite ({favorites.error}).</p>
      )}

      {results ? (
        <SearchResults
          results={results}
          zone={zone}
          onOpen={open}
          onPlay={play}
          favorites={favorites}
          serviceNames={serviceNames}
          onRenamePlaylist={renamePlaylist}
          onDeletePlaylist={deletePlaylist}
          playlistOptions={playlists}
          onAddToPlaylist={addToPlaylist}
        />
      ) : busy && items.length === 0 ? (
        <p className="hint">Loading…</p>
      ) : items.length === 0 ? (
        <p className="hint">Nothing here.</p>
      ) : (
        <>
          {listing?.sections?.map((section) => (
            <section key={section.id} className="panel home-section">
              <header className="panel-header">
                <h2>{section.name}</h2>
              </header>
              <ItemGrid
                items={section.items}
                zone={zone}
                onOpen={open}
                onPlay={play}
                favorites={favorites}
                serviceNames={serviceNames}
                onRenamePlaylist={renamePlaylist}
                onDeletePlaylist={deletePlaylist}
                playlistOptions={playlists}
                onAddToPlaylist={addToPlaylist}
              />
            </section>
          ))}
          <ItemGrid
            items={items}
            zone={zone}
            onOpen={open}
            onPlay={play}
            favorites={favorites}
            serviceNames={serviceNames}
            onRenamePlaylist={renamePlaylist}
            onDeletePlaylist={deletePlaylist}
            playlistOptions={playlists}
            onAddToPlaylist={addToPlaylist}
            {...(playlistId
              ? {
                  playlistId,
                  onRemovePlaylistItem: removePlaylistItem,
                  onMovePlaylistItem: movePlaylistItem,
                }
              : {})}
          />
          {maybeMore && (
            <p className="load-more">
              <button type="button" className="text-button" onClick={loadMore}>
                Load more
              </button>
            </p>
          )}
        </>
      )}
      </div>
    </div>
  );
}

function SearchResults({
  results,
  zone,
  onOpen,
  onPlay,
  favorites,
  serviceNames,
  onRenamePlaylist,
  onDeletePlaylist,
  playlistOptions,
  onAddToPlaylist,
}: {
  results: Record<string, ContentItem[]>;
  zone: ApiZoneState | null;
  onOpen: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
  favorites: AddFavoriteState;
  serviceNames: Record<string, string>;
  onRenamePlaylist: (item: ContentItem) => void;
  onDeletePlaylist: (item: ContentItem) => void;
  playlistOptions: ApiPlaylist[];
  onAddToPlaylist: (playlistId: string, itemId: string) => void;
}) {
  // Known kinds first in a sensible order, then anything the server added since — the kind
  // list is open, so an unrecognised bucket must still be shown.
  const kinds = [
    ...KIND_ORDER.filter((kind) => results[kind]?.length),
    ...Object.keys(results).filter((kind) => !KIND_ORDER.includes(kind) && results[kind]?.length),
  ];

  if (kinds.length === 0) {
    return <p className="hint">No matches.</p>;
  }

  return (
    <>
      {kinds.map((kind) => (
        <section key={kind} className="panel">
          <header className="panel-header">
            <h2>{KIND_LABELS[kind] ?? kind}</h2>
          </header>
          <ItemGrid
            items={results[kind]!}
            zone={zone}
            onOpen={onOpen}
            onPlay={onPlay}
            favorites={favorites}
            serviceNames={serviceNames}
            onRenamePlaylist={onRenamePlaylist}
            onDeletePlaylist={onDeletePlaylist}
            playlistOptions={playlistOptions}
            onAddToPlaylist={onAddToPlaylist}
          />
        </section>
      ))}
    </>
  );
}

function ItemGrid({
  items,
  zone,
  onOpen,
  onPlay,
  favorites,
  serviceNames,
  onRenamePlaylist,
  onDeletePlaylist,
  playlistOptions,
  onAddToPlaylist,
  playlistId,
  onRemovePlaylistItem,
  onMovePlaylistItem,
}: {
  items: ContentItem[];
  zone: ApiZoneState | null;
  onOpen: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
  favorites: AddFavoriteState;
  serviceNames: Record<string, string>;
  onRenamePlaylist: (item: ContentItem) => void;
  onDeletePlaylist: (item: ContentItem) => void;
  playlistOptions: ApiPlaylist[];
  onAddToPlaylist: (playlistId: string, itemId: string) => void;
  playlistId?: string;
  onRemovePlaylistItem?: (position: number) => void;
  onMovePlaylistItem?: (from: number, to: number) => void;
}) {
  const trackList = items.length > 0 && items.every((item) => item.kind === 'track');
  return (
    <ul className={`item-list ${trackList ? 'track-list' : 'grid'}`}>
      {items.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            className="item-row"
            // Opening wins for something that is both, since that is the non-destructive
            // action; playing the whole thing is the explicit button below.
            onClick={() => (item.browsable ? onOpen(item) : onPlay(item))}
            disabled={!item.browsable && !zone}
            title={
              item.browsable
                ? `Open ${item.name}`
                : zone
                  ? `Play in ${zone.name}`
                  : 'Select a zone first'
            }
          >
            {/*
              `tiny` is what the list geometry is built on: 40px in a row, and back to the full column
              width inside a grid (`.item-list.grid .cover.tiny`). Without it a row's artwork fell through
              to the base `.cover { width: 100% }` — which is invisibly correct in the grid and 826px tall
              in a track list, so this looked like the list view was broken rather than one class missing.
            */}
            <ItemCover
              url={item.coverUrl ?? ''}
              className="tiny"
              {...(item.animatedCoverUrl ? { animatedUrl: item.animatedCoverUrl } : {})}
            />
            <span className="item-text">
              <span className="item-title">{item.name}</span>
              {/* Artist/album when there is one, and always the provider. Previously the
                  service was only a *fallback* for a missing artist, so the rows that most
                  needed attributing — a fully-tagged track from one of four providers — were
                  the ones that never showed it. */}
              {(item.artist || item.album) && (
                <span className="item-sub">
                  {[item.artist, item.album].filter(Boolean).join(' — ')}
                </span>
              )}
              <ServiceBadge
                service={item.service}
                label={serviceNames[item.service]}
                className="item-service"
              />
            </span>
            {item.duration ? <span className="item-meta">{formatTime(item.duration)}</span> : null}
          </button>

          {/* Overlaid on the artwork: the actions that are not "what a tap does". */}
          <span className="item-overlay">
            {/* A container that is also playable gets its own verb — "play the whole album". */}
            {item.browsable && item.playable && zone && (
              <button
                type="button"
                className="icon-button small ghost play-all"
                title={`Play all in ${zone.name}`}
                onClick={() => onPlay(item)}
              >
                <Icon name="play" />
              </button>
            )}
            {/* Anything with an id can be a favourite — a track, an album, a whole playlist —
                because the API stores the id and resolves it at play time. */}
            {item.playable && (
              <FavoriteButton
                zone={zone}
                uri={item.id}
                name={item.name}
                pending={favorites.pending === item.id}
                saved={favorites.saved === item.id}
                onAdd={favorites.add}
              />
            )}
            {item.kind === 'track' && (
              <select
                className="playlist-add"
                defaultValue=""
                aria-label={`Add ${item.name} to playlist`}
                title="Add to playlist"
                disabled={playlistOptions.length === 0}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  event.stopPropagation();
                  if (event.currentTarget.value) {
                    onAddToPlaylist(event.currentTarget.value, item.id);
                    event.currentTarget.value = '';
                  }
                }}
              >
                <option value="">＋ Add to playlist…</option>
                {playlistOptions.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            )}
            {playlistId && item.kind === 'track' && (
              <>
                {index > 0 && (
                  <button
                    type="button"
                    className="text-button playlist-action"
                    title="Move up"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMovePlaylistItem?.(index, index - 1);
                    }}
                  >↑</button>
                )}
                {index < items.length - 1 && (
                  <button
                    type="button"
                    className="text-button playlist-action"
                    title="Move down"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMovePlaylistItem?.(index, index + 1);
                    }}
                  >↓</button>
                )}
                <button
                  type="button"
                  className="text-button playlist-action"
                  title="Remove from playlist"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemovePlaylistItem?.(index);
                  }}
                >Remove</button>
              </>
            )}
            {item.kind === 'playlist' && item.service === 'library' && (
              <>
                <button
                  type="button"
                  className="text-button playlist-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRenamePlaylist(item);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="text-button playlist-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeletePlaylist(item);
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
