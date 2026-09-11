/**
 * An artist is not an album with a round picture.
 *
 * That is what the page was. The same header a record gets, the same run line — `8 tracks · 30 min`,
 * which is a fact about a record and nothing at all about a person — and then a flat numbered list
 * with the artist's own name printed under every single row, on the artist's own page. A circle in a
 * black field, a list, and no answer to the only question the page is asked: what did they make.
 *
 * So the page is built from what a person actually has. Their records, as whole sleeves you can open,
 * and their songs, ranked, with the record each came from beside it rather than their name over and
 * over. The counts say `12 records · 60 songs`, which is what you would say out loud.
 *
 * The records are not in the listing: browsing an artist answers with their top songs and nothing
 * else. They come from one search, the same move the playing record makes to find where it came from
 * (see `useOrigin`), and under the same strict rule — `Coldplay` matches three singles by other
 * people, and a page that puts those on the shelf is worse than a page with no shelf.
 *
 * Strictness alone was not enough, in both directions. A provider that fills in an album's artist is
 * easy; the local library does not fill it in at all, so its own copy of `Parachutes` was thrown off
 * the page it belongs on. The artist's own songs settle it: each one names the record it came from,
 * and that naming is authority no search result can match. So a record earns its place by carrying
 * this artist's name *or* by being a record their songs come from.
 */
import { useEffect, useMemo, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import { Tile, TrackRow } from '@/art/Browse';
import { ForwardGlyph } from '@/art/glyphs';
import type { ContentItem } from '@/api/content';

/** How many of the ranked songs stand on the page before it offers the rest. */
const TOP = 8;

/** As many records as a service will usually own up to; the strict filter takes it down from here. */
const SEARCH = 24;

const norm = (value: string): string => value.trim().toLowerCase();

/** One lookup per artist per session — a page walked back into costs nothing. */
const cache = new Map<string, Promise<ContentItem[]>>();

/**
 * Everything this artist put their name to, in one service.
 *
 * Two ways in, because providers describe a record differently. Apple Music says who an album is by,
 * so the artist's name is the test. The local library says nothing at all, so the test is the songs:
 * a record their own songs come from is theirs, whatever the search result forgot to mention. A
 * record that fails both is somebody else's and does not appear.
 */
export function useArtistRecords(
  name: string | undefined,
  service: string | undefined,
  /** The artist's own songs, which name the records they came from. */
  songs: ContentItem[],
): ContentItem[] {
  const { content } = useServer();
  const [found, setFound] = useState<ContentItem[]>([]);
  const key = name && service ? `${service}|${norm(name)}` : null;

  useEffect(() => {
    setFound([]);
    if (!key || !name || !service || !content.available) {
      return undefined;
    }
    let live = true;
    const lookup =
      cache.get(key) ??
      content
        .search(name, { kinds: ['album'], services: [service], limit: SEARCH })
        .then((result) => result.items.album ?? [])
        .catch((): ContentItem[] => []);
    cache.set(key, lookup);
    void lookup.then((albums) => {
      if (live) {
        setFound(albums);
      }
    });
    return () => {
      live = false;
    };
  }, [key, name, service, content]);

  /* The filter runs on what the songs currently say rather than inside the cached lookup: the
     listing and the search arrive in either order, and a record must not be shut out for having
     been judged before its evidence turned up. */
  const fromSongs = useMemo(() => {
    const names = new Set<string>();
    for (const song of songs) {
      if (song.album) {
        names.add(norm(song.album));
      }
    }
    return names;
  }, [songs]);

  return useMemo(() => {
    if (!name) {
      return [];
    }
    return found.filter((record) =>
      record.artist ? norm(record.artist) === norm(name) : fromSongs.has(norm(record.name)),
    );
  }, [found, fromSongs, name]);
}

/**
 * What the page says this person is, in the two numbers anyone would ask for.
 *
 * Never a duration: an artist has no length. And never a count of nothing — a service that cannot
 * search answers no records, and `0 records` is a claim the page has no business making.
 */
export function artistLine(records: number, songs: number): string {
  const parts: string[] = [];
  if (records > 0) {
    parts.push(`${records} record${records === 1 ? '' : 's'}`);
  }
  if (songs > 0) {
    parts.push(`${songs} song${songs === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/**
 * The work: the records first, then the songs.
 *
 * Records before songs because that is the order a person's shelf is in — you look for the album you
 * know before you look for the track you half remember. The songs keep their rank, because the
 * provider's order is the one piece of editorial the page gets for free, and they carry the record
 * they came from instead of the artist's name, which the page has already said once in 120px type.
 */
export function ArtistWork({
  name,
  records,
  songs,
  nowPlaying,
  paused,
  returning,
  onOpen,
  onPlay,
  onQueue,
}: {
  name: string;
  records: ContentItem[];
  songs: ContentItem[];
  /** The title playing in this room, lowercased, so a row can show its bars. */
  nowPlaying: string;
  paused: boolean;
  /** The record just come back from: its sleeve lands on that tile. See `coverMorph`. */
  returning: string | null;
  onOpen: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
  onQueue: (item: ContentItem) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = useMemo(() => (all ? songs : songs.slice(0, TOP)), [all, songs]);

  return (
    <>
      {records.length > 0 && (
        /*
         * A grid, not a shelf that scrolls.
         *
         * A horizontal row is right for a shop window — a service's front page, where the shelf is a
         * sample and the point is that there is more. Here the records *are* the page, and a row
         * that shows four of eighteen and hides the rest behind a sideways drag is a discography in
         * a drawer. Laid out, it is what an artist's shelf looks like: all of it, at once.
         */
        <section className="cx-artist-sec">
          <div className="cx-sec-head">
            <span className="cx-sec-lbl mono">records</span>
            <span className="cx-sec-rule" />
          </div>
          <div className="cx-grid">
            {records.map((record, index) => (
              <Tile
                key={record.id}
                item={record}
                index={index}
                under={name}
                anchor={record.id === returning}
                onOpen={() => onOpen(record)}
                onPlay={() => onPlay(record)}
              />
            ))}
          </div>
        </section>
      )}

      {songs.length > 0 && (
        <section className="cx-artist-sec">
          <div className="cx-sec-head">
            <span className="cx-sec-lbl mono">most played</span>
            <span className="cx-sec-rule" />
            {songs.length > TOP && (
              /* The rest, when they are wanted. Sixty rows under a shelf of sleeves is a discography
                 pretending to be a page; eight is a top of the charts, which is what these are. */
              <button type="button" className="cx-sec-more mono" onClick={() => setAll(!all)}>
                {all ? 'fewer' : `all ${songs.length}`}
                <ForwardGlyph size={12} />
              </button>
            )}
          </div>
          <div className="cx-trows">
            {shown.map((song, index) => (
              <TrackRow
                key={song.id}
                item={song}
                index={index}
                playing={nowPlaying !== '' && song.name.trim().toLowerCase() === nowPlaying}
                paused={paused}
                sub={song.album}
                onPlay={() => onPlay(song)}
                onQueue={() => onQueue(song)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
