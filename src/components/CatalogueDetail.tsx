/**
 * Where a shelf leads: the album, the playlist, the artist, at its own size.
 *
 * The catalogue got good at taking you somewhere and then dropped you on a bare list — eighteen
 * rows each carrying a 40px copy of one sleeve, and that sleeve nowhere on the page at full size.
 * The subject of the screen was the only thing not on it.
 *
 * So a container that has artwork gets a head: the cover large, the name in the display face, who
 * made it, how much of it there is, and the one verb that matters. Everything here is read off
 * `ContentListing.container` and the rows themselves — nothing is fetched, because the browse call
 * that drew the list already answered all of it.
 *
 * A container **without** artwork gets nothing at all. There is no placeholder hero: a 200px music
 * note over a name is worse than the breadcrumb that was already doing that job honestly.
 */
import { FavoriteButton } from '@/components/FavoriteButton';
import { Icon } from '@/components/Icon';
import { ItemCover } from '@/components/Cover';
import type { ContentItem } from '@/api/content';
import type { AddFavoriteState } from '@/state/useAddFavorite';
import type { ApiZoneState } from '@/api/types';

/** Sentence-case names for the eyebrow. An unknown kind simply is not labelled. */
const KIND_NAMES: Record<string, string> = {
  album: 'Album',
  playlist: 'Playlist',
  artist: 'Artist',
  show: 'Show',
  radio: 'Station',
};

/**
 * Who made this, preferring what the tracks say over what the container claims.
 *
 * The container's own `artist` is not reliable: the local library fills an album's with the box
 * set it came out of ("Greatest Hits I, II & III (The Platinum Collection) [3CD Box Set]"), while
 * every track inside it correctly says "Queen". Where the rows agree with each other they are the
 * better source, and where they do not — a compilation — there is no single artist to name and the
 * container's answer is used or none is.
 */
export function artistOf(container: ContentItem, items: ContentItem[]): string | undefined {
  const named = items.map((item) => item.artist).filter((name): name is string => !!name);
  if (named.length === items.length && named.length > 0) {
    const first = named[0]!;
    if (named.every((name) => name === first)) {
      return first;
    }
  }
  return container.artist;
}

export function CatalogueDetail({
  container,
  items,
  total,
  zone,
  onPlay,
  favorites,
}: {
  container: ContentItem;
  /** The rows below, for the counts and the artist they agree on. */
  items: ContentItem[];
  /** What the provider says it holds, or null when it cannot count. */
  total: number | null;
  zone: ApiZoneState | null;
  onPlay: (item: ContentItem) => void;
  favorites: AddFavoriteState;
}) {
  const artist = artistOf(container, items);
  const kind = KIND_NAMES[container.kind];
  const tracks = items.length > 0 && items.every((item) => item.kind === 'track');
  const count = total ?? (items.length > 0 ? items.length : null);

  return (
    <header className="detail" data-kind={container.kind}>
      {/* The sleeve's own colour, thrown across the head. The same move the now-playing view makes
          under the cover, and the reason this reads as a record rather than as a page about one. */}
      <span className="detail-bloom" aria-hidden="true">
        <img src={container.coverUrl} alt="" decoding="async" />
      </span>

      <ItemCover
        url={container.coverUrl ?? ''}
        className="detail-cover"
        {...(container.animatedCoverUrl ? { animatedUrl: container.animatedCoverUrl } : {})}
      />

      <div className="detail-text">
        {kind && <p className="detail-kind mono">{kind}</p>}
        <h1 className="detail-title">{container.name}</h1>
        {/* An artist's own page names them in the title; printing it again underneath is the page
            saying one thing twice. */}
        {artist && artist !== container.name && <p className="detail-artist">{artist}</p>}
        <p className="detail-meta">
          {count !== null && `${count} ${tracks ? (count === 1 ? 'track' : 'tracks') : count === 1 ? 'item' : 'items'}`}
        </p>

        <div className="detail-actions">
          {/* The whole thing, in the room you are pointed at. Disabled rather than hidden without a
              room, so the page does not change shape depending on what the rail is doing. */}
          {container.playable && (
            <button
              type="button"
              className="detail-play"
              disabled={!zone}
              title={zone ? `Play in ${zone.name}` : 'Select a room first'}
              onClick={() => onPlay(container)}
            >
              <Icon name="play" />
              Play
            </button>
          )}
          {container.playable && (
            <FavoriteButton
              zone={zone}
              uri={container.id}
              name={container.name}
              pending={favorites.pending === container.id}
              saved={favorites.saved === container.id}
              onAdd={favorites.add}
            />
          )}
        </div>
      </div>
    </header>
  );
}
