/**
 * Browsing and search.
 *
 * The two things this view has to get right, both read off the item rather than guessed:
 *
 *  - **`browsable` and `playable` are independent.** An album is both. So a row opens on tap
 *    when it can be opened, and carries a separate play affordance when it can be played —
 *    rather than one behaviour inferred from `kind`.
 *  - **`total` may be `null`,** meaning the provider cannot count. So there is taken to be more
 *    whenever a page came back full, rather than when a running count says so — and a page that
 *    comes back empty (or fails) is what ends a listing no one can measure.
 *
 * Breadcrumbs are kept as a client-side stack. The server names the container it listed, but a
 * listing does not carry its ancestors — and for the folder case it cannot even name itself
 * (providers hardcode the literal "Album"), so the trail this view walked in on is the better
 * source for the path. Falling back to the container's own name when we arrived cold.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import type { ContentItem, ContentListing, ContentService } from '@/api/content';
import { CatalogueDetail, artistOf } from '@/components/CatalogueDetail';
import { CatalogueHub } from '@/components/CatalogueHub';
import { Icon } from '@/components/Icon';
import { FavoritesPanel } from '@/components/FavoritesPanel';
import { ItemGrid, type BrowseActions } from '@/components/ItemGrid';
import { RecentsPanel } from '@/components/RecentsPanel';
import { ServiceCards } from '@/components/ServiceCards';
import { useAddFavorite } from '@/state/useAddFavorite';
import type { ApiPlaylist, ApiZoneState } from '@/api/types';

/** One page. The server caps it; this is a screenful of a grid. */
const PAGE_SIZE = 60;

/**
 * How many doorways a listing may hold before it is drawn as a grid instead of as shelves.
 *
 * A shelf is a request, so this is the point where opening one folder to introduce it stops being
 * an introduction and becomes a download. Spotify's root has seven; a genre directory has sixty-
 * nine and is a grid — which is right for it anyway, since those *do* carry artwork.
 */
const MAX_SHELVES = 10;

/**
 * How many coverless folders may borrow a mosaic from their contents in one grid.
 *
 * Same trade, one request per tile, but bounded lower because a grid is where the long listings
 * are. Past this the plain rack glyph is the answer.
 */
const MAX_MOSAICS = 24;

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
  /* Set when a page came back empty or failed: the only end an uncountable listing has. */
  const [exhausted, setExhausted] = useState(false);
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
  /* The scrolling column and the marker at the foot of the list, which is what asks for more. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLParagraphElement>(null);
  /* A page already on its way. The marker stays on screen while it loads, and would ask again. */
  const loadingMore = useRef(false);
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
    setExhausted(false);
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

  /**
   * Appends the next page.
   *
   * Guarded rather than debounced: the marker that triggers this stays on screen while the page
   * is in flight, so without the flag a slow answer would be asked for several times over and
   * arrive several times over.
   *
   * An empty page ends the listing, and so does a failed one — otherwise a provider that has
   * stopped answering would be asked again every time the marker came back into view.
   */
  const loadMore = useCallback(() => {
    if (loadingMore.current) return;
    const generation = browseGeneration.current;
    const loaded = (listing?.items.length ?? 0) + extra.length;
    loadingMore.current = true;
    void content
      .browse(here?.id, loaded, PAGE_SIZE)
      .then((page) => {
        if (generation !== browseGeneration.current) return;
        if (page.items.length === 0) {
          setExhausted(true);
          return;
        }
        setExtra((prev) => [...prev, ...page.items]);
      })
      .catch(() => {
        if (generation === browseGeneration.current) setExhausted(true);
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [content, extra.length, here?.id, listing]);

  const items = [...(listing?.items ?? []), ...extra];
  // `total === null` means the provider cannot count, so completeness is judged by whether
  // the last page came back full rather than by comparing against a number that does not exist.
  const maybeMore =
    !exhausted &&
    listing !== null &&
    (listing.total === null
      ? (extra.length > 0 ? extra.length % PAGE_SIZE === 0 : listing.items.length === PAGE_SIZE)
      : items.length < listing.total);

  /*
   * The next page arrives because the end of this one came into view, not because someone asked
   * for it. The marker at the foot of the list is both the trigger and the whole of the
   * interface: it is on screen only while there is more, and only where more would go.
   *
   * `root` is the scrolling column rather than the viewport. The page itself never scrolls, so a
   * viewport-rooted observer would call the marker visible from the moment it mounts and pull a
   * six-thousand-row listing down in one go. The margin starts the fetch a screenful early, so
   * the grid grows ahead of the reader instead of stalling under them.
   *
   * Re-running as `loadMore` changes identity is deliberate: a fresh page re-attaches the
   * observer, and if the marker is *still* in view — a listing shorter than the column, or a
   * fast scroll — it simply fires again until the column is full or the listing runs out.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, maybeMore]);

  /* Everything a listing needs to be interactive, in one object — see `BrowseActions`. */
  const actions: BrowseActions = {
    zone,
    onOpen: open,
    onPlay: play,
    favorites,
    serviceNames,
    onRenamePlaylist: renamePlaylist,
    onDeletePlaylist: deletePlaylist,
    playlistOptions: playlists,
    onAddToPlaylist: addToPlaylist,
  };

  /*
   * How this listing should be drawn — decided from what came back, never from where we are.
   *
   * A listing of browsable, unplayable, artwork-less items is a set of doorways rather than a set
   * of records, and the artwork grid is the wrong instrument for it: it draws seven empty sleeves
   * and calls it a page. There are two kinds of doorway and they want opposite treatments —
   *
   *  - **services** (the root) have no contents worth borrowing a picture from, because their
   *    children are doorways too. They get their brand mark.
   *  - **folders inside a service** are full of music, so they are drawn as that music.
   *
   * Read off the items rather than off `trail.length` so a provider that nests one level deeper
   * than Spotify does gets the same treatment at whatever depth its doorways appear.
   */
  const doorways = items.length > 0 && items.every((item) => item.browsable && !item.coverUrl);
  const asServices = doorways && trail.length === 0;
  const asShelves = doorways && !asServices && items.length <= MAX_SHELVES;
  // The grid's fallback: mosaics, while there are few enough of them to be worth the requests.
  const mosaics = items.filter((item) => item.browsable && !item.coverUrl).length <= MAX_MOSAICS;

  /*
   * Somewhere with a face of its own — an album, a playlist, an artist — gets a head above its
   * listing. Gated on artwork rather than on kind: what makes the head worth the height is the
   * cover, and a container without one has nothing to show that the breadcrumb was not already
   * saying. Never over search results, which are about the query rather than about a place.
   */
  const detail = !results && !asShelves && !asServices && listing?.container?.coverUrl ? listing.container : null;
  // An album's rows are numbered; a playlist's keep their sleeves, because there they differ.
  const numbered = detail?.kind === 'album' && items.every((item) => item.kind === 'track');
  // What the head has already said, so the rows below can stop repeating it.
  const said = detail
    ? { artist: artistOf(detail, items), album: detail.kind === 'album' ? detail.name : undefined }
    : undefined;

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
      <div className="content-scroll" ref={scrollRef}>
      {/* The hub draws its own header, and "Home" above "Apple Music" is the page named twice. */}
      {!results && !asShelves && !asServices && listing?.sections && listing.sections.length > 0 && (
        <h1 className="home-title">Home</h1>
      )}

      {failedServices.length > 0 && (
        <p className="notice warn">
          No results from: {failedServices.join(', ')}.
        </p>
      )}

      {favorites.error && (
        <p className="notice warn">Could not add that favourite ({favorites.error}).</p>
      )}

      {results ? (
        <SearchResults results={results} actions={actions} />
      ) : busy && items.length === 0 ? (
        /* A block the size of what is coming rather than the word "Loading…", which occupied one
           line and then jumped the whole page down as the real thing replaced it. */
        <div className="hub-loading" aria-label="Loading" />
      ) : items.length === 0 ? (
        <p className="hint">Nothing here.</p>
      ) : asServices ? (
        <ServiceCards services={items} serviceNames={serviceNames} onOpen={open} />
      ) : asShelves ? (
        <CatalogueHub
          // The trail's name, not the container's: providers put their own junk in that field —
          // Spotify answers with the account id — and this is the largest text on the page.
          title={here?.name || listing?.container?.name || 'Catalogue'}
          service={listing?.container?.service}
          serviceName={
            listing?.container?.service ? serviceNames[listing.container.service] : undefined
          }
          folders={items}
          sections={listing?.sections ?? []}
          actions={actions}
        />
      ) : (
        <>
          {listing?.sections?.map((section) => (
            <section key={section.id} className="panel home-section">
              <header className="panel-header">
                <h2>{section.name}</h2>
              </header>
              <ItemGrid {...actions} items={section.items} previewFolders={mosaics} />
            </section>
          ))}
          {detail && (
            <CatalogueDetail
              container={detail}
              items={items}
              total={listing?.total ?? null}
              zone={zone}
              onPlay={play}
              favorites={favorites}
            />
          )}
          <ItemGrid
            {...actions}
            items={items}
            previewFolders={mosaics}
            numbered={numbered}
            {...(said ? { said } : {})}
            {...(playlistId
              ? {
                  playlistId,
                  onRemovePlaylistItem: removePlaylistItem,
                  onMovePlaylistItem: movePlaylistItem,
                }
              : {})}
          />
          {maybeMore && (
            /* Only ever read while it is true: it sits below the last row, and by the time it is
               on screen the page it announces has been asked for. */
            <p className="load-more hint" ref={sentinelRef} role="status">
              Loading more…
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
  actions,
}: {
  results: Record<string, ContentItem[]>;
  actions: BrowseActions;
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
          <ItemGrid {...actions} items={results[kind]!} showService />
        </section>
      ))}
    </>
  );
}
