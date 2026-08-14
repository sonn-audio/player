/**
 * One listing of content items, in whichever shape the items ask for.
 *
 * Lifted out of `ContentView` when shelves arrived, because a shelf is *the same list* laid out
 * along the other axis — same row, same affordances, same rules about what a tap does. Forking a
 * second card component for it would have been a second place to keep those rules true, and the
 * one thing this component exists to guarantee is that a track behaves like a track wherever it
 * is drawn.
 *
 * Which is why `layout` is a hint about geometry only:
 *
 *  - `auto` — a list when every item is a track, a grid of artwork otherwise. Artwork is the
 *    subject for an album and noise for a fifty-track playlist.
 *  - `shelf` — one horizontal row that scrolls, for a preview of somewhere you have not opened.
 *  - `shelf-rows` — the same scrolling row, stacked three deep. For tracks, where a square of
 *    artwork is the least useful thing on the card and three names fit in the height of one.
 *
 * The markup does not change between them; the CSS does. `data-kind` is on the row for the same
 * reason — an artist is a circle and a track is dense, and neither is worth a second component.
 */
import { ItemCover } from '@/components/Cover';
import { FolderCover } from '@/components/FolderCover';
import { Icon } from '@/components/Icon';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ServiceBadge } from '@/components/ServiceBadge';
import { formatTime } from '@/lib/format';
import type { ContentItem } from '@/api/content';
import type { AddFavoriteState } from '@/state/useAddFavorite';
import type { ApiPlaylist, ApiZoneState } from '@/api/types';

/**
 * What any listing needs to be interactive, in one bundle.
 *
 * Grouped rather than passed one by one because three places now render listings — the browser,
 * its search results, and every shelf — and each new prop was three more call sites to thread it
 * through.
 */
export type BrowseActions = {
  zone: ApiZoneState | null;
  onOpen: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
  favorites: AddFavoriteState;
  /** Provider id → display name, from `GET /services`. */
  serviceNames: Record<string, string>;
  onRenamePlaylist: (item: ContentItem) => void;
  onDeletePlaylist: (item: ContentItem) => void;
  playlistOptions: ApiPlaylist[];
  onAddToPlaylist: (playlistId: string, itemId: string) => void;
};

export type ItemGridProps = BrowseActions & {
  items: ContentItem[];
  layout?: 'auto' | 'shelf' | 'shelf-rows';
  /**
   * Whether every row names its provider.
   *
   * Left unset it is decided from the items: attribution is information when a listing mixes
   * providers, and pure repetition when it does not. A Spotify shelf that writes "Spotify" under
   * all fourteen covers is not telling anyone anything — the page is already called Spotify — and
   * fifty-six repetitions of one word is what a browse screen looks like when nobody counted them.
   * Search sets it explicitly, because there "only Spotify answered" is a real fact about a query
   * that asked five services.
   */
  showService?: boolean;
  /**
   * Whether a coverless folder should be drawn as a mosaic of what is inside it.
   *
   * Off by default because it costs one request per such tile. The caller decides, since only the
   * caller knows how many tiles are about to be drawn.
   */
  previewFolders?: boolean;
  /**
   * Number the rows instead of repeating one sleeve down the page.
   *
   * For an album, whose eighteen tracks carry eighteen copies of the artwork already shown at
   * 200px above them. A position is the thing a track list is actually missing — the API sends no
   * track number (see the library notes), so the row's place in the listing is the honest stand-in
   * and, for an album listed in order, the same number.
   */
  numbered?: boolean;
  /**
   * What the page above these rows has already said, so a row does not repeat it.
   *
   * An artist page whose every row reads "Ed Sheeran — Play (Extended Edition)" under a header that
   * says "Ed Sheeran" spends a third of each row on a word the eye has already had. Matched by
   * exact value rather than assumed from the kind: on a compilation the rows genuinely disagree
   * with the header, and those are precisely the rows that must keep their artist.
   */
  said?: { artist?: string | undefined; album?: string | undefined };
  /** Set when the listing *is* a playlist, which is what unlocks reorder and remove. */
  playlistId?: string;
  onRemovePlaylistItem?: (position: number) => void;
  onMovePlaylistItem?: (from: number, to: number) => void;
};

export function ItemGrid({
  items,
  layout = 'auto',
  showService,
  numbered = false,
  said,
  previewFolders = false,
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
}: ItemGridProps) {
  const trackList = layout === 'auto' && items.length > 0 && items.every((item) => item.kind === 'track');
  const shape =
    layout === 'shelf'
      ? 'shelf'
      : layout === 'shelf-rows'
        ? 'shelf rows'
        : trackList
          ? 'track-list'
          : 'grid';
  const attribute = showService ?? new Set(items.map((item) => item.service)).size > 1;

  return (
    <ul className={`item-list ${shape}`}>
      {items.map((item, index) => (
        <li key={item.id} data-kind={item.kind}>
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
            {numbered ? (
              <span className="item-index mono">{index + 1}</span>
            ) : previewFolders && item.browsable && !item.coverUrl ? (
              <FolderCover id={item.id} className="tiny" />
            ) : (
              <ItemCover
                url={item.coverUrl ?? ''}
                className="tiny"
                {...(item.animatedCoverUrl ? { animatedUrl: item.animatedCoverUrl } : {})}
              />
            )}
            <span className="item-text">
              <span className="item-title">{item.name}</span>
              {/* Artist/album when there is one, and the provider when it distinguishes anything —
                  see `showService`. The service was once only a *fallback* for a missing artist,
                  so the rows that most needed attributing (a fully-tagged track from one of four
                  providers) were the ones that never showed it; the rule is now about the listing
                  rather than about the row. */}
              {subLine(item, said) && <span className="item-sub">{subLine(item, said)}</span>}
              {attribute && (
                <ServiceBadge
                  service={item.service}
                  label={serviceNames[item.service]}
                  className="item-service"
                />
              )}
            </span>
            {item.duration ? <span className="item-meta">{formatTime(item.duration)}</span> : null}
          </button>

          {/*
            The play verb, sitting on the artwork itself.

            A container that is also playable has two different actions — open it, or play the
            whole thing — and only one of them can be what a tap does. This is the other one, and
            it is the mark every music player puts in this exact corner, which is why it is worth
            the accent: it is the one green thing on a page of album art, so it is findable without
            being read. The box it hangs in is squared off (`aspect-ratio`) so it lands on the
            bottom corner of the *cover* rather than of the card, whose text has its own height.
          */}
          {item.browsable && item.playable && zone && (
            <span className="item-play">
              <button
                type="button"
                className="play-all"
                title={`Play all in ${zone.name}`}
                aria-label={`Play ${item.name} in ${zone.name}`}
                onClick={() => onPlay(item)}
              >
                <Icon name="play" />
              </button>
            </span>
          )}

          {/* Overlaid on the artwork: the actions that are not "what a tap does". */}
          <span className="item-overlay">
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
                {/*
                  A bare "+" rather than "＋ Add to playlist…".

                  A `<select>` renders its selected option's text, and this control is 30px wide —
                  so the descriptive label was drawn as "Ad", led by a fullwidth plus the system UI
                  font has no glyph for, i.e. a tofu box followed by two letters. It read as a
                  rendering failure. The description lives on `aria-label` and `title`, where a
                  30px control's description belongs.
                */}
                <option value="">+</option>
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

/**
 * The artist/album line under a title, minus whatever the page has already said.
 *
 * Both halves can fall away — on an album page the header carries the artist *and* the album name,
 * which is why an album's rows end up with a title and a duration and nothing else, which is what
 * a track listing has always looked like on the back of a sleeve.
 */
function subLine(item: ContentItem, said: ItemGridProps['said']): string {
  const parts = [item.artist, item.album].filter(
    (part): part is string => !!part && part !== said?.artist && part !== said?.album,
  );
  return parts.join(' — ');
}
