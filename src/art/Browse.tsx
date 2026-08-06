/**
 * Browsing, in the art face: big artwork on black, and as little furniture as the job allows.
 *
 * The same `/browse` tree the technical player walks, presented on the opposite principle. There is
 * no breadcrumb trail, no service badges, no kind labels and no "24 items" counts — one back link,
 * one title, and the covers. What a row *is* still comes off the item (`browsable` / `playable`,
 * never `kind`), because that is what makes one tile component correct for an album, an artist, a
 * category and a station at once.
 *
 * Four presentations, chosen by what the listing actually contains rather than by where you are:
 *
 *  - **Doors** when nothing has a picture and everything opens (a service root, a share, a folder of
 *    folders): a table of contents, with four sleeves from inside each one as the evidence.
 *  - **Shelves** when the server sent `sections` (Apple Music's home, a curated root) — and for a
 *    search, whose buckets *are* sections. A shelf says "here is a selection" where a grid says
 *    "here is everything".
 *  - **Tracks** when the listing is mostly playable non-browsable items: a numbered list under a
 *    header with the container's own artwork, which is what an album is.
 *  - **A grid** otherwise. `auto-fill` with a minimum, so the column count follows the window
 *    instead of a breakpoint.
 *
 * Playing anything hands `item.id` straight to `POST /zones/{id}/play`. The id is opaque and the
 * server resolves it — that is what lets this file contain no knowledge of providers at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import { itemCoverCss, zoneCoverCss } from '@/art/cover';
import { useVolumeControl } from '@/art/volume';
import { Motion } from '@/art/Motion';
import {
  BackGlyph,
  Bars,
  EmptyArtGlyph,
  ForwardGlyph,
  PauseGlyph,
  PlayGlyph,
  QueueGlyph,
  SearchGlyph,
  SpeakerGlyph,
} from '@/art/glyphs';
import { formatTime } from '@/lib/format';
import type { ContentAbout, ContentItem, ContentListing, ContentSection, ContentSource } from '@/api/content';
import type { ApiInput, ApiZoneState } from '@/api/types';
import type { Cur } from '@/art/useCur';

/** How many children to ask for. One screenful of tiles and then some. */
const PAGE = 120;

/**
 * A search bucket's name, as a shelf heading.
 *
 * `ContentKind` is an open set — a provider may answer with a kind nobody has heard of — so this is a
 * courtesy, not a mapping: anything missing falls through to the server's own word for it, which is
 * better than a lookup that swallows what it does not recognise.
 */
const PLURAL: Record<string, string> = {
  track: 'songs',
  album: 'albums',
  artist: 'artists',
  playlist: 'playlists',
  radio: 'stations',
  show: 'shows',
  episode: 'episodes',
  category: 'categories',
  folder: 'folders',
};

export type BrowseNode = { id?: string; label?: string };

/**
 * What is behind a door, so the door can show it.
 *
 * A service root, a share, a folder of folders — these arrive with a name and nothing else, and the grid
 * drew each as an empty grey square with a speaker glyph in it. Three of those was the first screen of
 * browsing on a phone, which is a poor advertisement for a player whose whole argument is the artwork.
 *
 * So each door asks what is inside it and shows four of them. One extra request per door, once per
 * session — the cache is module-level and keyed by the opaque id, so walking back out to the root and in
 * again costs nothing, and a failure resolves to an empty list rather than rejecting: a door with no
 * sleeves behind it is still a door.
 */
type Peek = { art: string[]; names: string[] };

/**
 * The story behind a container, once per id per session — misses included, for the same reason
 * `peek` remembers its own: a 404 asked once is the route's ordinary answer, asked on every visit
 * it is polling for a feature the server has said it does not have.
 */
const abouts = new Map<string, Promise<ContentAbout | null>>();

function aboutOf(content: ContentSource, id: string): Promise<ContentAbout | null> {
  let hit = abouts.get(id);
  if (!hit) {
    hit = content.about(id).catch(() => null);
    abouts.set(id, hit);
  }
  return hit;
}

/**
 * The prose, clamped to a glance and opened by a word.
 *
 * A biography on a browse page is context, not content — four lines say who this is, and the rest
 * is there for the person who asks. `more` only appears when there is genuinely more (the clamp is
 * by character count rather than measured overflow, which is approximate and fails politely: a
 * borderline text simply opens to nearly what it already showed). The attribution is not optional
 * dressing: prose from a cloud source arrives with a licence, and the name is the price.
 */
const ABOUT_CLAMP = 280;

function About({ about }: { about: ContentAbout }) {
  const [open, setOpen] = useState(false);
  const text = about.description?.trim() ?? '';
  if (!text) {
    return null;
  }
  const long = text.length > ABOUT_CLAMP;
  return (
    <div className="cx-about">
      <p className="cx-about-text" data-open={open || !long || undefined}>
        {text}
      </p>
      <span className="cx-about-foot mono">
        {long && (
          <button type="button" onClick={() => setOpen((value) => !value)}>
            {open ? 'less' : 'more'}
          </button>
        )}
        {about.source?.name && <i className="cx-about-src">{about.source.name}</i>}
      </span>
    </div>
  );
}

const NOTHING: Peek = { art: [], names: [] };

const peeked = new Map<string, Promise<Peek>>();

function peek(content: ContentSource, id: string): Promise<Peek> {
  let hit = peeked.get(id);
  if (!hit) {
    hit = content
      .browse(id, 0, 12)
      .then((listing) => {
        const pool = [...(listing.sections ?? []).flatMap((section) => section.items), ...listing.items];
        return {
          art: pool
            .map((item) => item.coverUrl)
            .filter((url): url is string => Boolean(url))
            .slice(0, 4),
          // For a door with nothing to show: the names of the first few things behind it, which is what
          // a table of contents does when there is no illustration.
          names: pool.map((item) => item.name).filter(Boolean).slice(0, 3),
        };
      })
      .catch(() => NOTHING);
    peeked.set(id, hit);
  }
  return hit;
}

/**
 * A door: a name the size of a heading, and a glimpse of what is behind it.
 *
 * The alternative — and what this replaces — is a tile with no picture, which is a hole the shape of a
 * record where there is no record. A listing of containers is a table of contents, and a table of
 * contents should be set as type, with the artwork as the evidence rather than the subject.
 */
function Door({ item, index, onOpen }: { item: ContentItem; index: number; onOpen: () => void }) {
  const { content } = useServer();
  const [inside, setInside] = useState<Peek>(NOTHING);

  useEffect(() => {
    let live = true;
    void peek(content, item.id).then((found) => {
      if (live) {
        setInside(found);
      }
    });
    return () => {
      live = false;
    };
  }, [content, item.id]);

  /*
   * Painted right to left, so the first sleeve ends up in front.
   *
   * The stack leans back away from the reader and each card overlaps the one before it, which only works
   * if the frontmost card is drawn last — hence the reversal here rather than an `order` in the
   * stylesheet, where the negative margins would then be applied in the wrong places and drag the whole
   * fan out of its box.
   */
  const stack = [...inside.art].reverse();

  return (
    <button
      type="button"
      className="cx-door"
      onClick={onOpen}
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className="cx-door-meta">
        <span className="cx-door-name disp">{item.name}</span>
        {inside.art.length === 0 && inside.names.length > 0 && (
          <span className="cx-door-inside mono">{inside.names.join(' · ')}</span>
        )}
      </span>

      <span className="cx-door-peek" data-on={stack.length > 0 || undefined}>
        {stack.map((url, at) => (
          <span
            key={url}
            className="cx-door-sleeve"
            style={{ backgroundImage: itemCoverCss(url), '--n': at, zIndex: at } as React.CSSProperties}
          />
        ))}
      </span>

      <span className="cx-door-go">
        <ForwardGlyph size={17} />
      </span>
    </button>
  );
}

/**
 * A tile: artwork, name, one line under it. The whole thing opens; the chip plays.
 *
 * `index` is only there to stagger the arrival — a grid of forty covers that all appear on the same
 * frame lands like a page refresh, and the same forty arriving over a fifth of a second reads as a shelf
 * being filled. Capped in CSS so the fortieth is not a second late.
 */
function Tile({
  item,
  index = 0,
  onOpen,
  onPlay,
}: {
  item: ContentItem;
  index?: number;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="cx-tile"
      // The glow under the lift reads the cover from here — see `.cx-tile::after` for why it cannot read
      // it from the element that actually paints it.
      style={{ '--tile-art': itemCoverCss(item.coverUrl), '--i': index } as React.CSSProperties}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="cx-tile-cov"
        style={{ backgroundImage: itemCoverCss(item.coverUrl) }}
        onClick={item.browsable ? onOpen : onPlay}
        aria-label={item.name}
      >
        {!item.coverUrl && <EmptyArtGlyph size={26} className="cx-tile-empty" />}
        {/* Only the tile being pointed at, so a shelf of thirty does not open thirty streams. */}
        <Motion src={item.animatedCoverUrl} active={hovered} />
        <span className="cx-tile-ov" />
        {item.playable && (
          <span
            className="cx-tile-chip"
            role="button"
            tabIndex={-1}
            title={`Play ${item.name}`}
            onClick={(event) => {
              // The cover opens, the chip plays. Without this the chip would do both.
              event.stopPropagation();
              onPlay();
            }}
          >
            <PlayGlyph size={13} />
          </span>
        )}
      </button>
      <span className="cx-tile-title">{item.name}</span>
      {(item.artist || item.album) && (
        <span className="cx-tile-sub">{item.artist || item.album}</span>
      )}
    </div>
  );
}

/**
 * What a listing looks like before it arrives.
 *
 * Apple Music's home takes about three seconds to answer, and what filled that time was the word
 * `loading…` set in 10px mono on an otherwise empty black page — three seconds of nothing, on the screen
 * whose entire argument is that browsing should be a pleasure. A grid of empty sleeves says the same
 * thing without saying anything: it shows the shape of what is coming, and the page does not jump when
 * it does.
 *
 * Deliberately not a spinner. A spinner claims that something is happening; this claims what will be
 * there, which is the more useful of the two and the only one that holds the composition still.
 */
function Waiting() {
  return (
    <div className="cx-grid" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="cx-ghost" key={index} style={{ '--i': index } as React.CSSProperties}>
          <span className="cx-ghost-cov" />
          <span className="cx-ghost-line" />
          <span className="cx-ghost-line cx-ghost-line-short" />
        </div>
      ))}
    </div>
  );
}

/**
 * One track row, in a listing that is a record rather than a shelf.
 *
 * Set like the back of a sleeve: a number, a title, a time hanging on the right margin, and no rule
 * between them. It had a hairline under every row, which turns a running order into a table — fourteen
 * horizontal lines competing with the one vertical edge the page is built on. Rhythm comes from the
 * leading instead, and the row you are pointing at is the one with a background.
 *
 * `playing` swaps the number for the moving bars. It is matched by title rather than by id because the
 * queue's ids and the catalogue's ids are different namespaces for the same recording — see `nowPlaying`.
 */
function TrackRow({
  item,
  index,
  playing,
  paused,
  onPlay,
  onQueue,
}: {
  item: ContentItem;
  index: number;
  playing?: boolean;
  paused?: boolean;
  onPlay: () => void;
  onQueue: () => void;
}) {
  return (
    <div className="cx-trow" data-playing={playing || undefined}>
      <button type="button" className="cx-trow-main" onClick={onPlay}>
        <span className="cx-tidx mono">{playing ? <Bars still={paused} /> : index + 1}</span>
        <span className="cx-tmeta">
          <span className="cx-ttitle">{item.name}</span>
          {item.artist && <span className="cx-tartist">{item.artist}</span>}
        </span>
      </button>
      <button type="button" className="cx-tact" onClick={onQueue} title="Add to the queue">
        <QueueGlyph size={15} />
      </button>
      {item.duration ? <span className="cx-tdur mono">{formatTime(item.duration)}</span> : null}
    </div>
  );
}

/**
 * Play it, or shuffle it.
 *
 * Text, not pills. They were a filled capsule and a hairline capsule — the only two boxed things in a
 * face whose stated rule is that nothing is boxed, and they sat directly under a heading that follows the
 * rule. `play` carries the accent because it is the one action here with a consequence.
 */
function Actions({
  container,
  zone,
  onPlay,
}: {
  container: ContentItem;
  zone: ApiZoneState | null;
  onPlay: (item: ContentItem) => void;
}) {
  const api = useApi();
  return (
    <div className="cx-browse-actions">
      <button type="button" className="mono cx-play-btn" onClick={() => onPlay(container)}>
        <PlayGlyph size={13} /> play
      </button>
      {zone && (
        <button
          type="button"
          className="mono cx-shuffle-btn"
          onClick={() => {
            // Shuffle-play is two calls, in this order: the mode has to be on *before* the queue is
            // built, or the first track is the first track.
            void api.setShuffle(zone.id, true).then(() => api.play(zone.id, container.id));
          }}
        >
          shuffle
        </button>
      )}
    </div>
  );
}

export function Browse({
  zone,
  root,
  onExit,
}: {
  zone: ApiZoneState | null;
  /** Where to start: a service root, or nothing for the catalogue's own root. */
  root: BrowseNode;
  /** Called when the back link is pressed at the top of the stack. */
  onExit: () => void;
}) {
  const api = useApi();
  const { content } = useServer();
  /** The path, so back is a pop rather than a re-browse from the top. */
  const [stack, setStack] = useState<BrowseNode[]>([root]);
  const [listing, setListing] = useState<ContentListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ContentSection[]>([]);
  const [about, setAbout] = useState<ContentAbout | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const here = stack[stack.length - 1] ?? {};

  // Re-browse whenever the top of the stack changes. A search takes over the pane without touching
  // the stack, so clearing the field returns you to exactly where you were browsing.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    /*
     * Drop what was on screen before asking for the next thing.
     *
     * The title comes off the stack and updates on the click, while the items came off the last response
     * and did not — so for the three seconds a service takes to answer, the page showed one record's name
     * over another record's tracks. Clearing it means the heading and the body always agree, and the
     * ghosts below fill the gap.
     */
    setListing(null);
    void content
      .browse(here.id, 0, PAGE)
      .then((next) => {
        if (!cancelled) {
          setListing(next);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setListing(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [content, here.id]);

  /* Search, debounced. Two characters is the floor — a one-letter search asks every provider for
     everything and then throws it away. */
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void content
        .search(trimmed, { limit: 24 })
        .then((found) => {
          /*
           * Kept in its buckets, as shelves.
           *
           * This used to flatten every kind into one grid on the argument that the art face does not
           * label a result by kind — which was true of the *row*, and stopped being true of the page
           * when browsing grew shelves. Eighty squares in one wall makes the album you were looking for
           * indistinguishable from the eleven tracks off it; four shelves called albums, songs, artists
           * and playlists is the same information sorted, in the presentation the rest of browsing
           * already uses. The bucket name is the section name, so nothing here has to know the kinds.
           */
          setResults(
            Object.entries(found.items)
              .map(([kind, items]) => ({
                id: kind,
                name: PLURAL[kind] ?? kind,
                items: (items ?? []).filter(Boolean),
              }))
              .filter((section) => section.items.length > 0),
          );
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [content, query]);

  const open = useCallback((item: ContentItem) => {
    setQuery('');
    setStack((prev) => [...prev, { id: item.id, label: item.name }]);
  }, []);

  const back = useCallback(() => {
    if (query) {
      setQuery('');
      return;
    }
    if (stack.length > 1) {
      setStack((prev) => prev.slice(0, -1));
      return;
    }
    onExit();
  }, [query, stack.length, onExit]);

  const play = useCallback(
    (item: ContentItem) => {
      if (zone) {
        void api.play(zone.id, item.id);
      }
    },
    [api, zone],
  );

  const queue = useCallback(
    (item: ContentItem) => {
      if (zone) {
        void api.queueAppend(zone.id, item.id);
      }
    },
    [api, zone],
  );

  const container = listing?.container ?? null;

  /*
   * The story around the container, when the server can tell one (`ContentAbout`). Fetched after
   * the listing rather than with it, so browsing never waits on prose — the page composes itself
   * and the biography joins it, or quietly never does.
   */
  const aboutId = container?.id ?? null;
  useEffect(() => {
    setAbout(null);
    if (!aboutId) {
      return undefined;
    }
    let cancelled = false;
    void aboutOf(content, aboutId).then((story) => {
      if (!cancelled) {
        setAbout(story);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, aboutId]);

  // Search comes back in buckets and is rendered as shelves, so it takes the sections slot and leaves
  // the flat one empty — the two are never both populated.
  const items = query ? [] : (listing?.items ?? []);
  const sections = query ? results : (listing?.sections ?? []);

  /*
   * A table of contents, not a wall of empty squares.
   *
   * Nothing here has a picture and everything opens: that is a service root, a share, a folder of
   * folders. Judged from the items rather than from where we are, because the same shape turns up two
   * and three levels down and deserves the same treatment there.
   */
  const doors =
    !query &&
    sections.length === 0 &&
    items.length > 0 &&
    items.length <= 12 &&
    items.every((item) => item.browsable && !item.coverUrl);

  /**
   * The recording this room is playing, if it is in this listing.
   *
   * Matched on the title, lower-cased. The catalogue's id for a track and the queue's id for the same
   * track are different strings — the queue entry is a position in a room's playback, the catalogue item
   * is a thing in a provider — so there is no id to compare. A title match across one album's worth of
   * rows is right in every case that matters and costs nothing when it is wrong: a row is lit that would
   * otherwise not have been.
   */
  const nowPlaying = zone?.track?.title?.trim().toLowerCase() ?? '';
  /*
   * Is this a record or a shelf?
   *
   * Playable-but-not-browsable is what a track is, and a listing that is mostly those is an album,
   * a playlist or a station list — which wants rows. Anything else wants covers. Judged from the
   * items rather than from `container.kind`, because `kind` is an open set and providers disagree
   * about what to call a playlist.
   */
  const trackish = items.length > 0 && items.filter((item) => item.playable && !item.browsable).length / items.length > 0.6;
  const title = query ? `“${query}”` : (container?.name ?? here.label ?? 'Music');

  /*
   * An object, as opposed to a shelf.
   *
   * A container with its own picture is a *thing* — an album, a playlist, an artist — and a thing
   * gets the hero: its picture large, its name on it, the two things you can do to it. A category
   * or a service root keeps the plain heading; a shelf is not an object and giving it a hero would
   * be inventing one. `detail` narrows the heroes to the track-listed kind (an album, a running
   * order), which is what decides the run line and the numbered rows below.
   */
  const hero = !query && container?.coverUrl ? container : null;
  const detail = hero && trackish ? hero : null;

  /*
   * Round for a person, square for a record — the one presentation decision `kind` makes here.
   * Presentation only, with a safe fallback: an unknown kind simply stays square, which is never
   * wrong, so the open set stays open.
   */
  const portrait = hero?.kind === 'artist';

  /** `24 tracks · 1 hr 32 min` — what the object is, in the two numbers anyone wants of it. */
  const runLine = ((): string => {
    if (!detail) {
      return '';
    }
    const seconds = items.reduce((total, item) => total + (item.duration ?? 0), 0);
    const parts = [`${items.length} track${items.length === 1 ? '' : 's'}`];
    if (seconds > 0) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.round((seconds % 3600) / 60);
      parts.push(hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`);
    }
    return parts.join(' · ');
  })();

  return (
    <div className="cx-browse">
      {/* The container's own artwork, washed out behind its title — the one flourish in this view,
          and only when there is a picture to wash. */}
      {hero && (
        <>
          <span className="cx-browse-bg" style={{ backgroundImage: itemCoverCss(hero.coverUrl) }} />
          <span className="cx-browse-fade" />
        </>
      )}

      <div
        className="cx-browse-inner"
        data-detail={hero ? '' : undefined}
        data-search={query ? '' : undefined}
      >
        <button type="button" className="mono cx-browse-back" onClick={back}>
          <BackGlyph size={13} />
          back
        </button>

        {hero ? (
          /*
           * The thing itself, as the left half of the page.
           *
           * Sleeve or portrait, what it is, what it is called, who by, and the two things you can do
           * to it — the same furniture the stage gives a playing track, because a record you are
           * looking at and a record that is playing are the same kind of object. Sticky, so the
           * picture stays with you down a hundred-track playlist: the list is the thing that
           * scrolls, not the thing it belongs to.
           */
          <header className="cx-detail" data-portrait={portrait || undefined}>
            <span className="cx-detail-art">
              <span className="cx-detail-bloom" style={{ backgroundImage: itemCoverCss(hero.coverUrl) }} />
              <span className="cx-detail-cover" style={{ backgroundImage: itemCoverCss(hero.coverUrl) }}>
                <Motion src={hero.animatedCoverUrl} />
              </span>
            </span>

            {runLine && <span className="mono cx-detail-kind">{runLine}</span>}
            <h1 className="disp cx-detail-title">{title}</h1>
            {hero.artist && <span className="cx-detail-sub">{hero.artist}</span>}

            {hero.playable && <Actions container={hero} zone={zone} onPlay={play} />}
          </header>
        ) : (
          <div className="cx-browse-head">
            <div className="cx-browse-title-row">
              <h1 className="disp cx-browse-title">{title}</h1>

              <div className="cx-search">
                <SearchGlyph size={15} />
                <input
                  ref={field}
                  type="search"
                  value={query}
                  placeholder="Search everything"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            {/* A shelf's own controls, when the shelf is itself playable. A category is not. */}
            {!query && container?.playable && <Actions container={container} zone={zone} onPlay={play} />}
          </div>
        )}

        {/*
          One wrapper for everything the header introduces, so the desktop's two-column detail
          layout has exactly three children to place — back, the hero, and this — instead of five
          auto-flowing blocks landing wherever the grid's cursor happens to be.
        */}
        <div className="cx-browse-body">

          {/* Who this is, when the server can say — see `About`. Keyed so a new container starts
              folded rather than inheriting the last one's `more`. */}
          {!query && about && <About about={about} key={aboutId ?? 'none'} />}

          {/* Ghosts only when there is nothing else to look at: a re-search should not blank the results
              it is about to replace. */}
          {((loading && !query) || searching) && items.length === 0 && sections.length === 0 && <Waiting />}

          {!loading && !searching && items.length === 0 && sections.length === 0 && (
            <p className="cx-browse-empty mono">{query ? 'nothing found' : 'nothing here'}</p>
          )}

          {sections.map((section) => (
            <section className="cx-shelf" key={section.id}>
              <div className="cx-sec-head">
                <span className="cx-sec-lbl mono">{section.name}</span>
                <span className="cx-sec-rule" />
              </div>
              {/* The mask on the right edge is what says "this row continues" without a scrollbar. */}
              <div className="cx-shelf-row">
                {section.items.map((item, index) => (
                  <Tile
                    key={item.id}
                    item={item}
                    index={index}
                    onOpen={() => open(item)}
                    onPlay={() => play(item)}
                  />
                ))}
              </div>
            </section>
          ))}

          {doors ? (
            <div className="cx-doors">
              {items.map((item, index) => (
                <Door key={item.id} item={item} index={index} onOpen={() => open(item)} />
              ))}
            </div>
          ) : trackish ? (
            <div className="cx-trows">
              {items.map((item, index) => (
                <TrackRow
                  key={item.id}
                  item={item}
                  index={index}
                  playing={nowPlaying !== '' && item.name.trim().toLowerCase() === nowPlaying}
                  paused={zone?.state !== 'playing'}
                  onPlay={() => play(item)}
                  onQueue={() => queue(item)}
                />
              ))}
            </div>
          ) : (
            items.length > 0 && (
              <div className="cx-grid">
                {items.map((item, index) => (
                  <Tile
                    key={item.id}
                    item={item}
                    index={index}
                    onOpen={() => open(item)}
                    onPlay={() => play(item)}
                  />
                ))}
              </div>
            )
          )}

          {/*
            The names beside this one, as a shelf at the end of the page — where a person who has
            read the records above goes next. The same `Tile` as everywhere: a similar item is a
            full item, openable and playable, not a caption.
          */}
          {!query && about && about.similar.length > 0 && (
            <section className="cx-shelf cx-similar">
              <div className="cx-sec-head">
                <span className="cx-sec-lbl mono">beside this</span>
                <span className="cx-sec-rule" />
              </div>
              <div className="cx-shelf-row">
                {about.similar.map((item, index) => (
                  <Tile
                    key={item.id}
                    item={item}
                    index={index}
                    onOpen={() => open(item)}
                    onPlay={() => play(item)}
                  />
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}

/**
 * The physical inputs, as a list.
 *
 * `GET /inputs` is server-level, not per zone — an input is selectable from anywhere — so this is a
 * list of the house's sockets and pressing one points the current room at it. `controllable: false`
 * (a turntable, a bare jack) means selecting it *is* the whole interaction, and saying so is more
 * use than offering transport buttons that will do nothing.
 */
export function Sources({ zone, onDone }: { zone: ApiZoneState | null; onDone: () => void }) {
  const api = useApi();
  const [inputs, setInputs] = useState<ApiInput[]>([]);

  useEffect(() => {
    void api
      .getInputs()
      .then(setInputs)
      .catch(() => setInputs([]));
  }, [api]);

  return (
    <div className="cx-browse">
      <div className="cx-browse-inner">
        <div className="cx-browse-head">
          <button type="button" className="mono cx-browse-back" onClick={onDone}>
            <BackGlyph size={13} />
            back
          </button>
          <h1 className="disp cx-browse-title">Inputs</h1>
        </div>

        {inputs.length === 0 ? (
          <p className="cx-browse-empty mono">nothing wired in yet</p>
        ) : (
          <div className="cx-inputs">
            {inputs.map((input) => (
              <button
                type="button"
                className="cx-input"
                key={input.id}
                onClick={() => {
                  if (zone) {
                    void api.selectInput(zone.id, input.id);
                    onDone();
                  }
                }}
              >
                <span className="cx-input-ic">
                  <SpeakerGlyph size={18} />
                </span>
                <span className="cx-input-meta">
                  <span className="cx-input-name">{input.name}</span>
                  {/* In the words of the person standing next to the turntable, not the person who
                      wrote the driver: `transport works` names a category of API call. */}
                  <span className="cx-input-sub mono">
                    {input.controllable ? 'pause and skip work' : 'plays whenever it is on'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The mini bar: what is playing, while you are looking at something else.
 *
 * Desktop only, and only while browsing — on the phone the bottom nav carries the way back to the
 * player, and stacking a mini bar above a five-tab nav leaves a listing two rows tall. Its
 * background is the artwork, blurred and desaturated, which is what keeps it feeling like part of
 * the page rather than a toolbar dropped on it.
 */
export function MiniBar({ cur, onOpen }: { cur: Cur; onOpen: () => void }) {
  const api = useApi();
  const control = useVolumeControl(cur.zone);
  const leader = cur.leader;

  if (!leader) {
    return null;
  }

  return (
    <div className="cx-mini">
      {cur.hasTrack && (
        <>
          <span className="cx-mini-bg" style={{ backgroundImage: zoneCoverCss(api, leader, 240) }} />
          <span className="cx-mini-scrim" />
        </>
      )}
      <span className="cx-mini-prog">
        <i style={{ width: cur.pct }} />
      </span>

      <button type="button" className="cx-mini-track" onClick={onOpen}>
        <span className="cx-mini-cov" style={{ backgroundImage: zoneCoverCss(api, leader, 120) }} />
        <span className="cx-mini-meta">
          <span className="cx-mini-title">{cur.title}</span>
          <span className="cx-mini-sub mono">{cur.name}</span>
        </span>
      </button>

      <div className="cx-mini-transport">
        <button
          type="button"
          className="cx-mini-play"
          aria-label={cur.isPlaying ? 'Pause' : 'Play'}
          onClick={() => void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id))}
        >
          {cur.isPlaying ? <PauseGlyph size={17} /> : <PlayGlyph size={18} />}
        </button>
      </div>

      <span className="cx-mini-vol">
        <SpeakerGlyph size={15} />
        <span className="cx-vol-slider" onPointerDown={control.onPointerDownH}>
          <span className="cx-vol-rail">
            <span className="cx-vol-fill" style={{ width: control.pct }} />
            <span className="cx-vol-knob" style={{ left: control.pct }} />
          </span>
        </span>
        <span className="cx-mini-vol-num mono">{control.value}</span>
      </span>
    </div>
  );
}
