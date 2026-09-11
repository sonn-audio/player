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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import { useFavorites, useRecents } from '@/art/useCollections';
import { captureCoverFrom, useCoverAnchor } from '@/shell/coverMorph';
import { itemCoverCss, zoneCoverCss } from '@/art/cover';
import { useVolumeControl } from '@/art/volume';
import { Motion } from '@/art/Motion';
import { Crossfade } from '@/art/Crossfade';
import { artKeyOf } from '@/art/accent';
import { useLeaving } from '@/art/Leaving';
import { Origin, titleStep } from '@/art/Stage';
import { useResolved } from '@/art/useOrigin';
import { ArtistWork, artistLine, useArtistRecords } from '@/art/Artist';
import { LetterIndex, alphabetical } from '@/art/Index';
import {
  BackGlyph,
  Bars,
  EmptyArtGlyph,
  ForwardGlyph,
  PauseGlyph,
  PlayGlyph,
  PlusGlyph,
  QueueGlyph,
  SearchGlyph,
  SpeakerGlyph,
} from '@/art/glyphs';
import { formatTime } from '@/lib/format';
import { mainTitle } from '@/lib/title';
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

export type BrowseNode = {
  id?: string;
  label?: string;
  /**
   * What the tile that opened this already knew about it.
   *
   * A record's page can open on its sleeve, name and artist the instant it is pressed and let the tracks
   * arrive after; without this it opened on a skeleton and the sleeve had nothing to fly to for as long as
   * the service took to answer. Absent for a page reached any other way.
   */
  seed?: ContentItem;
};

/**
 * Container rows with no picture of their own, few enough to be a table of contents.
 *
 * That is a service root, a share, a folder of folders — the same shape turns up two and three
 * levels down and deserves the same treatment there.
 */
function doorlike(pool: ContentItem[]): boolean {
  return pool.length > 0 && pool.length <= 12 && pool.every((item) => item.browsable && !item.coverUrl);
}

/**
 * How long the page waits for the doors' peeks before composing without the stragglers.
 *
 * The peeks are what decide which doors open out into shelves and what the billboard has to pick
 * from, and those decisions have to be made *before* the page paints — a door that turns into a
 * shelf after render is the exact composition-shift this file spends its comments fighting. The
 * local library answers in milliseconds; a slow provider misses the window and its door simply
 * stays a door for this visit, upgrading on the next one from the module cache.
 */
const PEEK_WAIT_MS = 800;

/** From this many sleeves behind it, a door opens out into a shelf. */
const SHELF_MIN_ART = 4;

/** Today, as a number — the billboard walks its pool by the day. */
const DAY = Math.floor(Date.now() / 86_400_000);

/**
 * What is behind a door, so the door can show it — and so the page can be composed from it.
 *
 * A service root, a share, a folder of folders — these arrive with a name and nothing else, and the grid
 * drew each as an empty grey square with a speaker glyph in it. Three of those was the first screen of
 * browsing on a phone, which is a poor advertisement for a player whose whole argument is the artwork.
 *
 * So each door asks what is inside it. One extra request per door, once per session — the cache is
 * module-level and keyed by the opaque id, so walking back out to the root and in again costs nothing,
 * and a failure resolves to an empty list rather than rejecting: a door with no music behind it is
 * still a door.
 *
 * The peek keeps the *items*, not just their pictures, because two different presentations are built
 * from it: a door's fan of sleeves, and — where a door's children carry artwork — the door opened out
 * into a whole shelf of them (see `composed` in `Browse`). A shelf needs real items to open and play.
 */
type Peek = { items: ContentItem[] };

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

const NOTHING: Peek = { items: [] };

/** How many children a peek keeps — one shelf's worth. */
const PEEK_LIMIT = 12;

const peeked = new Map<string, Promise<Peek>>();

function peek(content: ContentSource, id: string): Promise<Peek> {
  let hit = peeked.get(id);
  if (!hit) {
    hit = content
      .browse(id, 0, PEEK_LIMIT)
      .then((listing) => ({
        items: [
          ...(listing.sections ?? []).flatMap((section) => section.items),
          ...listing.items,
        ].slice(0, PEEK_LIMIT),
      }))
      .catch(() => NOTHING);
    peeked.set(id, hit);
  }
  return hit;
}

/** The sleeves in a peek — what both the door's fan and the shelf decision read. */
function artOf(items: ContentItem[]): string[] {
  return items.map((item) => item.coverUrl).filter((url): url is string => Boolean(url));
}

/**
 * The *records* in a peek: albums only.
 *
 * A door's stack is a picture of what is behind it, and a playlist's cover is a tile with a word on it —
 * `Op repeat`, `Chill` — where an album's is a sleeve. Where a service offers both, the stack is made of
 * albums; the playlists stay for the shelf, where the word is the point.
 */
function albumArtOf(items: ContentItem[]): string[] {
  return artOf(items.filter((item) => item.kind === 'album'));
}

/** Children worth opening for albums first: the ones whose name says so. */
function albumish(item: ContentItem): boolean {
  return /album|release|nieuw|new|recent/i.test(item.name);
}

/**
 * A door: a name the size of a heading, and a glimpse of what is behind it.
 *
 * The alternative — and what this replaces — is a tile with no picture, which is a hole the shape of a
 * record where there is no record. A listing of containers is a table of contents, and a table of
 * contents should be set as type, with the artwork as the evidence rather than the subject.
 */
function Door({
  item,
  index,
  hall = false,
  preferred = [],
  onOpen,
}: {
  item: ContentItem;
  index: number;
  /** At the front of the catalogue: a tall panel with the sleeves whole in a stack, not a row with a fan. */
  hall?: boolean;
  /**
   * Sleeves that are *yours* — this room's favourites and what it played lately, from this service.
   * They stand in front of anything the service puts forward: the hall is a portrait of the house,
   * not the services' shop windows.
   */
  preferred?: string[];
  onOpen: () => void;
}) {
  const { content } = useServer();
  const [inside, setInside] = useState<Peek>(NOTHING);
  /* Sleeves found a level further down, when the room behind this door is itself all doors. */
  const [deeper, setDeeper] = useState<string[]>([]);

  /*
   * One level, and then one more only if the first had nothing to show.
   *
   * A library's door leads to *Albums · Artists · Tracks*, which are three more doors with no pictures
   * of their own — so a peek that stops at the first level finds nothing and the whole library renders
   * as three lines of type on an empty page, in a player holding a thousand sleeves. The music is one
   * step further down, and this is the only place that can go and get it: the shelf composition upstairs
   * decides from *this* door's peek, and a door with no art is exactly what it decides against.
   *
   * Bounded on purpose. One extra level, the first three doors behind this one, and it stops at the
   * first one that has sleeves — so the cost is at most three requests for a door that had none, once
   * per session (`peek` is a module-level cache), and zero for every door that already had artwork.
   */
  useEffect(() => {
    let live = true;
    void peek(content, item.id).then(async (found) => {
      if (!live) {
        return;
      }
      setInside(found);
      /* Enough records on the doorstep: no need to look further in. */
      if (albumArtOf(found.items).length >= 3) {
        return;
      }
      /* Otherwise look behind the first few doors inside, the ones named for albums first, and
         gather records until there are three. What is found is kept even if it is fewer. */
      const children = found.items.filter((entry) => entry.browsable);
      const ordered = [...children.filter(albumish), ...children.filter((entry) => !albumish(entry))].slice(0, 4);
      const found_: string[] = [];
      for (const child of ordered) {
        const below = await peek(content, child.id);
        if (!live) {
          return;
        }
        found_.push(...albumArtOf(below.items));
        if (found_.length >= 3) {
          break;
        }
      }
      if (found_.length > 0) {
        setDeeper(found_);
        return;
      }
      /* No records anywhere: any picture beats a blank, so the old rule — the first child with art. */
      if (artOf(found.items).length > 0) {
        return;
      }
      for (const child of children.slice(0, 3)) {
        const below = await peek(content, child.id);
        if (!live) {
          return;
        }
        const art = artOf(below.items);
        if (art.length > 0) {
          setDeeper(art);
          return;
        }
      }
    });
    return () => {
      live = false;
    };
  }, [content, item.id]);

  /* Records first — the door's own, then those found behind it — and only failing both, any art at all. */
  const own = artOf(inside.items);
  const albums = [...albumArtOf(inside.items), ...deeper];
  const behind = albums.length > 0 ? albums : own;
  const art = [...preferred, ...behind.filter((url) => !preferred.includes(url))].slice(0, 4);
  // For a door with nothing to show: the names of the first few things behind it, which is what
  // a table of contents does when there is no illustration.
  const names = inside.items.map((entry) => entry.name).filter(Boolean).slice(0, 3);

  /*
   * Painted right to left, so the first sleeve ends up in front.
   *
   * The stack leans back away from the reader and each card overlaps the one before it, which only works
   * if the frontmost card is drawn last — hence the reversal here rather than an `order` in the
   * stylesheet, where the negative margins would then be applied in the wrong places and drag the whole
   * fan out of its box.
   */
  const stack = [...art].reverse();

  if (hall) {
    const count = inside.items.length;
    return (
      <button
        type="button"
        className="cx-portal"
        data-art={art.length > 0 ? Math.min(art.length, 4) : 0}
        onClick={onOpen}
        style={{ '--i': index } as React.CSSProperties}
        title={item.name}
      >
        {/* The first sleeve, blurred past recognition, is the colour of the room. */}
        {art[0] && <span className="cx-portal-wall" style={{ backgroundImage: itemCoverCss(art[0]) }} aria-hidden="true" />}
        <span className="cx-portal-scrim" aria-hidden="true" />
        {/* The sleeves themselves, whole — a record is never cropped — standing in a short stack, the
            first in front. */}
        {art.length > 0 && (
          <span className="cx-portal-stack" aria-hidden="true">
            {art.slice(0, 3).map((url, n) => (
              <i key={url} style={{ backgroundImage: itemCoverCss(url) }} data-n={n} />
            ))}
          </span>
        )}
        {/* No sleeves to show: what is inside, as words, standing where the sleeves would. */}
        {art.length === 0 && names.length > 0 && (
          <span className="cx-portal-words disp" aria-hidden="true">
            {names.map((name) => (
              <i key={name}>{name}</i>
            ))}
          </span>
        )}
        <span className="cx-portal-txt">
          <span className="cx-portal-name disp">{item.name}</span>
          <span className="cx-portal-line">
            {art.length > 0 && names.length > 0
              ? names.join(' · ')
              : count > 0
                ? `${count} ${count === 1 ? 'folder' : 'folders'}`
                : ''}
          </span>
        </span>
        <span className="cx-portal-go" aria-hidden="true">
          <ForwardGlyph size={16} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="cx-door"
      onClick={onOpen}
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className="cx-door-meta">
        <span className="cx-door-name disp">{item.name}</span>
        {art.length === 0 && names.length > 0 && (
          <span className="cx-door-inside mono">{names.join(' · ')}</span>
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
 * The billboard: one record, put forward, at the top of a home-like page.
 *
 * A page of doors or shelves is a table of contents, and a table of contents sells nothing — every
 * album in the house is the same 150px square. This is the counter-move, taken from what a record
 * shop does with its window: *one* sleeve large, on a wall of its own light, with its name at
 * display size. Not curation (the server has no editor) but rotation: the pick walks the pool by
 * the day, so the window is dressed differently tomorrow and identical on every visit today.
 *
 * The wall is the sleeve itself, blurred past recognition and darkened until the page is still
 * black — the same argument as the stage's bloom: no palette guessed, the record's own light at the
 * record's own distribution. It fades into the page at the bottom because that is how every canvas
 * in this face ends (the phone player's `doek`, the detail hero on a phone): in the page, not on
 * an edge.
 */
function Billboard({
  item,
  from,
  onOpen,
  onPlay,
}: {
  item: ContentItem;
  /** Where the pick came from — a door's or section's name, as provenance in the kicker. */
  from: string;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const open = item.browsable ? onOpen : onPlay;
  return (
    <section className="cx-bill">
      <span className="cx-bill-wall" style={{ backgroundImage: itemCoverCss(item.coverUrl) }} aria-hidden="true" />
      <span className="cx-bill-scrim" aria-hidden="true" />

      <button
        type="button"
        className="cx-bill-cover"
        style={{ backgroundImage: itemCoverCss(item.coverUrl) }}
        onClick={open}
        aria-label={item.name}
        data-person={item.kind === 'artist' || undefined}
      >
        <Motion src={item.animatedCoverUrl} />
      </button>

      <span className="cx-bill-meta">
        <span className="mono cx-bill-kicker">
          today
          {from && <i className="cx-bill-from">{from}</i>}
        </span>
        <button type="button" className="disp cx-bill-title" onClick={open}>
          {item.name}
        </button>
        {item.artist && <span className="cx-bill-sub">{item.artist}</span>}

        <span className="cx-bill-actions">
          {item.playable && (
            <button type="button" className="mono cx-play-btn" onClick={onPlay}>
              <PlayGlyph size={13} /> play
            </button>
          )}
          {item.browsable && (
            <button type="button" className="mono cx-bill-open" onClick={onOpen}>
              open
            </button>
          )}
        </span>
      </span>
    </section>
  );
}

/**
 * A tile: artwork, name, one line under it. The whole thing opens; the chip plays.
 *
 * `index` is only there to stagger the arrival — a grid of forty covers that all appear on the same
 * frame lands like a page refresh, and the same forty arriving over a fifth of a second reads as a shelf
 * being filled. Capped in CSS so the fortieth is not a second late.
 */
/**
 * A name without the shelf's own name in front of it.
 *
 * A provider that names every stream `Radio Paradise - Rock Mix` is right to, on its own; under a
 * heading that already says `Radio Paradise` it is the same word five times in a row. The prefix is
 * only dropped when something is left, so a tile is never blank.
 */
/**
 * A person's initials — one letter per name, two at most.
 *
 * The little words are skipped, so `Asaf Avidan and the Mojos` is `AA` rather than `AA` padded out
 * with a conjunction, and a single name keeps its one letter rather than being doubled into a
 * monogram nobody uses.
 */
const SMALL = new Set(['and', 'the', 'of', 'de', 'van', 'der', 'y', '&', 'a', 'los', 'las', 'le', 'la']);

function initials(name: string): string {
  const words = name
    .split(/[\s.]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0 && !SMALL.has(word.toLowerCase()));
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function shortName(name: string, under: string | undefined): string {
  if (!under) {
    return name;
  }
  const rest = name.replace(new RegExp(`^${under.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:·]\\s*`, 'i'), '');
  return rest.trim() || name;
}

/*
 * Exported for the artist page, which is built from the same two pieces as every other listing — a
 * sleeve on a shelf and a row in a list. See `Artist`. The import runs the other way as well, which
 * is safe because neither module touches the other while it is being evaluated: these are components,
 * looked up when something renders.
 */
export function Tile({
  item,
  index = 0,
  under,
  anchor = false,
  onOpen,
  onPlay,
}: {
  item: ContentItem;
  index?: number;
  /** The shelf this tile stands on, so its name need not repeat it. */
  under?: string | undefined;
  /** This is the record we just came back from: its sleeve lands here. See `coverMorph`. */
  anchor?: boolean;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const landing = useCoverAnchor();
  /*
   * What a tile says under its name, when that is a different fact.
   *
   * An artist's tile carries the artist's name in both fields, so a page of people read `Adele /
   * Adele`, `AC/DC / AC/DC`, twenty-four times down a grid. A line that repeats the line above it is
   * not a second fact, and neither is the name of the shelf the tile is standing on.
   */
  const said = item.artist || item.album;
  const sub =
    said &&
    said.trim().toLowerCase() !== item.name.trim().toLowerCase() &&
    said.trim().toLowerCase() !== under?.trim().toLowerCase()
      ? said
      : undefined;

  return (
    <div
      className="cx-tile"
      // Round for a person, square for a record — presentation only, on an open kind set: anything
      // unrecognised stays square, which is never wrong.
      data-person={item.kind === 'artist' || undefined}
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
        /* Opening a record: the sleeve is measured here, before the page changes, and lands on the
           detail page's cover — one object moving, not two pages swapping. */
        onClick={(event) => {
          if (item.browsable) {
            captureCoverFrom(event.currentTarget);
            onOpen();
          } else {
            onPlay();
          }
        }}
        aria-label={item.name}
        {...(anchor ? landing : {})}
      >
        {!item.coverUrl &&
          (item.kind === 'artist' ? (
            /* A person with no photograph is still a person. Their initials in the display face say
               who the empty circle is for; a speaker glyph says the file is missing, which is a fact
               about us and not about them. */
            <span className="disp cx-tile-initials" aria-hidden="true">
              {initials(item.name)}
            </span>
          ) : (
            <EmptyArtGlyph size={26} className="cx-tile-empty" />
          ))}
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
      <span className="cx-tile-title">{shortName(item.name, under)}</span>
      {sub && <span className="cx-tile-sub">{sub}</span>}
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
export function TrackRow({
  item,
  index,
  playing,
  paused,
  albumArtist,
  sub,
  thumb = false,
  onPlay,
  onQueue,
}: {
  item: ContentItem;
  index: number;
  playing?: boolean;
  paused?: boolean;
  /** The record's own artist: a track by the same one does not say so again under its title. */
  albumArtist?: string | undefined;
  /** Said instead of the artist, where the artist is not the useful half — an artist's own page
      already carries their name in 120px type, and what the row is missing there is the record. */
  sub?: string | undefined;
  /** Draw the sleeve instead of the number — for a row that is not one of its record's tracks. */
  thumb?: boolean;
  onPlay: () => void;
  onQueue: () => void;
}) {
  const sameArtist =
    Boolean(item.artist && albumArtist) && item.artist!.trim().toLowerCase() === albumArtist!.trim().toLowerCase();
  return (
    <div className="cx-trow" data-playing={playing || undefined} data-thumb={thumb || undefined}>
      <button type="button" className="cx-trow-main" onClick={onPlay}>
        {thumb && <span className="cx-tthumb" style={{ backgroundImage: itemCoverCss(item.coverUrl) }} aria-hidden="true" />}
        <span className="cx-tidx mono">{playing ? <Bars still={paused} /> : index + 1}</span>
        <span className="cx-tmeta">
          <span className="cx-ttitle">{item.name}</span>
          {sub ? (
            <span className="cx-tartist">{sub}</span>
          ) : (
            item.artist && !sameArtist && <span className="cx-tartist">{item.artist}</span>
          )}
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
  onQueue,
  onOpenRooms,
}: {
  container: ContentItem;
  zone: ApiZoneState | null;
  onPlay: (item: ContentItem) => void;
  /** Add the whole record after what is playing. */
  onQueue?: ((item: ContentItem) => void) | undefined;
  onOpenRooms?: (() => void) | undefined;
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
      {zone && onQueue && (
        <button type="button" className="mono cx-shuffle-btn" onClick={() => onQueue(container)} title="Add to the queue">
          <PlusGlyph size={13} /> queue
        </button>
      )}
      {/* Where this will play, said out loud. A browser that does not name the room is a browser you
          press play in and then go looking for the music. */}
      {zone && onOpenRooms && (
        <span className="cx-browse-room mono">
          play in
          <button type="button" className="cx-wire mono" onClick={onOpenRooms}>
            {zone.name}
            <ForwardGlyph size={11} />
          </button>
        </span>
      )}
    </div>
  );
}

export function Browse({
  zone,
  root,
  onExit,
  onOpenRooms,
}: {
  zone: ApiZoneState | null;
  /** Where to start: a service root, or nothing for the catalogue's own root. */
  root: BrowseNode;
  /** Called when the back link is pressed at the top of the stack. */
  onExit: () => void;
  /** The way to the desk, from the head of a record: "play in · this room" is a door, not a label. */
  onOpenRooms?: (() => void) | undefined;
}) {
  const api = useApi();
  const { content } = useServer();
  /*
   * The house's own records, by service, for the hall's stacks.
   *
   * Favourites first (a choice), then what this room played lately (a trace), one sleeve per record.
   * The service is read off the entry's own `service` where it says one and off the source's prefix
   * where it does not — a favourite says `spotify:track:…`, which is enough.
   */
  const recents = useRecents(zone?.id ?? null);
  const favorites = useFavorites(zone?.id ?? null);
  const mine = useMemo(() => {
    const byService: Record<string, string[]> = {};
    const add = (service: string | undefined, url: string | undefined): void => {
      if (!service || !url) {
        return;
      }
      const list = (byService[service] ??= []);
      if (!list.includes(url) && list.length < 3) {
        list.push(url);
      }
    };
    for (const item of favorites) {
      add(item.source.includes(':') ? item.source.split(':')[0] : undefined, item.coverUrl);
    }
    for (const item of recents) {
      add(item.service ?? (item.source.includes(':') ? item.source.split(':')[0] : undefined), item.coverUrl);
    }
    return byService;
  }, [favorites, recents]);
  /* The record we are going back from lands on its tile — see `Tile`'s `anchor`. */
  const [returning, setReturning] = useState<string | null>(null);
  const detailLanding = useCoverAnchor();
  /** The path, so back is a pop rather than a re-browse from the top. */
  const [stack, setStack] = useState<BrowseNode[]>([root]);
  const [listing, setListing] = useState<ContentListing | null>(null);
  /** What is behind each door, gathered before paint — see the browse effect. */
  const [peeks, setPeeks] = useState<Record<string, ContentItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ContentSection[]>([]);
  const [about, setAbout] = useState<ContentAbout | null>(null);
  const field = useRef<HTMLInputElement>(null);
  /*
   * Paging state for the listing.
   *
   * One page of `PAGE` used to be the whole listing: a library of 362 artists stopped at the 120th
   * and there was nothing on the page to say the rest existed. `cursor` is how many rows the server
   * has handed over — the offset of the next page — counted from the responses rather than from what
   * is on screen, so a provider that repeats a row still advances instead of asking for the same page
   * forever. `done` is the other stop: `total` is allowed to be null, and a short page is the only
   * thing that reliably means "no more".
   */
  const cursor = useRef(0);
  const [done, setDone] = useState(false);
  const [paging, setPaging] = useState(false);
  const inFlight = useRef(false);
  /** The scroll container, as the observer's frame of reference — the page itself does not scroll. */
  const scroller = useRef<HTMLDivElement>(null);
  /** The mark at the end of the listing: when it comes into view, the next page is asked for. */
  const sentinel = useRef<HTMLDivElement>(null);

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
    setPeeks({});
    cursor.current = 0;
    setDone(false);
    setPaging(false);
    inFlight.current = false;
    void content
      .browse(here.id, 0, PAGE)
      .then(async (next) => {
        /*
         * A doors page is composed *before* it paints.
         *
         * Which doors open out into shelves, and what the billboard can feature, both come from the
         * peeks — so the page waits for them (briefly; see `PEEK_WAIT_MS`) and then renders once,
         * whole. The alternative was doors morphing into shelves and a billboard dropping in above
         * them a beat after the page landed. Skipped when the server sent sections: that page is
         * already composed, and peeking every category of a cloud service is a fan of upstream
         * requests nobody asked for.
         */
        const found: Record<string, ContentItem[]> = {};
        const pool = next.items ?? [];
        if ((next.sections ?? []).length === 0 && doorlike(pool)) {
          await Promise.race([
            Promise.all(
              pool.map(async (door) => {
                const inside = await peek(content, door.id);
                found[door.id] = inside.items;
              }),
            ),
            new Promise((resolve) => setTimeout(resolve, PEEK_WAIT_MS)),
          ]);
        }
        if (!cancelled) {
          setListing(next);
          cursor.current = pool.length;
          // A first page shorter than asked for is the whole listing, whatever `total` claims.
          setDone(pool.length < PAGE);
          // Copied at the moment of the set: stragglers keep mutating `found` after the race and
          // must not reach under a page that has already decided its shape.
          setPeeks({ ...found });
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
    setStack((prev) => [...prev, { id: item.id, label: item.name, ...(item.coverUrl ? { seed: item } : {}) }]);
  }, []);

  const back = useCallback(() => {
    if (query) {
      setQuery('');
      return;
    }
    if (stack.length > 1) {
      /* Going back from a record: its sleeve is measured here and lands on the tile it came from. */
      const sleeve = document.querySelector<HTMLElement>('.cx-detail-cover');
      const id = listing?.container?.id;
      if (sleeve && id && captureCoverFrom(sleeve)) {
        setReturning(id);
      }
      setStack((prev) => prev.slice(0, -1));
      return;
    }
    onExit();
  }, [query, stack.length, onExit, listing]);

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

  /*
   * Is there more of this listing than has arrived?
   *
   * Two stops, because the API documents two. `total` is the count when the provider can give one —
   * Apple Music says 362 artists — and `done` covers the case it cannot: `total` is explicitly
   * allowed to be null, and then a page shorter than the one asked for is the only honest signal.
   * Either stop alone leaves a library truncated or a scroll asking forever.
   */
  const more =
    !query &&
    !loading &&
    listing !== null &&
    !done &&
    (listing.total === null || listing.items.length < listing.total);

  /** The next page, appended. */
  const grow = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    const at = cursor.current;
    const of = listing?.container?.id ?? null;
    inFlight.current = true;
    setPaging(true);
    void content
      .browse(here.id, at, PAGE)
      .then((next) => {
        const fresh = next.items ?? [];
        cursor.current = at + fresh.length;
        if (fresh.length < PAGE) {
          setDone(true);
        }
        setListing((cur) => {
          // A page that arrives after you have moved on belongs to the listing you left.
          if (!cur || (cur.container?.id ?? null) !== of) {
            return cur;
          }
          const held = new Set(cur.items.map((item) => item.id));
          return {
            ...cur,
            items: [...cur.items, ...fresh.filter((item) => !held.has(item.id))],
            total: next.total ?? cur.total,
          };
        });
      })
      .catch(() => {
        // A failed page is the end of the listing as far as this view is concerned: retrying on every
        // scroll event would hammer a provider that is already not answering.
        setDone(true);
      })
      .finally(() => {
        inFlight.current = false;
        setPaging(false);
      });
  }, [content, here.id, listing]);

  /*
   * Paging by looking, not by pressing.
   *
   * The mark sits under the last row and the next page is fetched while it is still 800px away, so
   * the grid grows before the bottom of it is ever reached — no button, no spinner in the common
   * case, which is the only version of this that suits a face with no motion in it.
   */
  useEffect(() => {
    const mark = sentinel.current;
    if (!mark || !more) {
      return undefined;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          grow();
        }
      },
      { root: scroller.current, rootMargin: '800px 0px' },
    );
    watch.observe(mark);
    return () => watch.disconnect();
  }, [more, grow]);

  // Search comes back in buckets and is rendered as shelves, so it takes the sections slot and leaves
  // the flat one empty — the two are never both populated.
  const items = query ? [] : (listing?.items ?? []);
  const sections = query ? results : (listing?.sections ?? []);

  /*
   * A table of contents, not a wall of empty squares.
   *
   * Nothing here has a picture and everything opens: that is a service root, a share, a folder of
   * folders. No longer conditional on the absence of sections — a home that sends shelves *and*
   * categories (Apple Music's does) used to draw the categories as a grid of empty grey tiles under
   * its shelves; as doors they are the same table of contents they are everywhere else.
   */
  const doors = !query && doorlike(items);

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
  /*
   * The name you pressed wins over the name the server holds.
   *
   * They are almost always the same word — a row's `name` becomes the stack label becomes the next
   * page's `container.name`. The one place they differ is a service's own root: the nav says
   * `Library` and the provider names its root category after itself (`Local Media`), which put a
   * heading on the page that repeated the first row under it and matched nothing anyone pressed.
   * The container's name stays the answer where no label exists — a deep link, a search result.
   */
  const title = query ? `“${query}”` : (here.label ?? container?.name ?? 'Music');

  /*
   * An object, as opposed to a shelf.
   *
   * A container with its own picture is a *thing* — an album, a playlist, an artist — and a thing
   * gets the hero: its picture large, its name on it, the two things you can do to it. A category
   * or a service root keeps the plain heading; a shelf is not an object and giving it a hero would
   * be inventing one. `detail` narrows the heroes to the track-listed kind (an album, a running
   * order), which is what decides the run line and the numbered rows below.
   */
  /* The record itself, or — while it loads — what the tile that opened it already knew. */
  const hero = !query ? (container?.coverUrl ? container : (here.seed ?? null)) : null;
  /* A record's own page names its artist, and that name is a door to everything by them — the same
     move the stage makes with the record it is playing. See `useOrigin`. */
  const heroArtist = useResolved('artist', hero?.artist, hero?.service);
  const detail = hero && trackish ? hero : null;

  /*
   * The record in the window — see `Billboard`.
   *
   * Only a home-like page dresses one: a page with its own hero is about that hero, a track list is
   * a record's own inside, and a search is a question. The pool is everything with a sleeve that the
   * page already knows about — the sections it was sent, or the peeks it composed — walked by the
   * day so the window changes tomorrow and holds still today. Sections win over peeks because they
   * are the service's own idea of "put this forward", which is closer to an editor than a folder is.
   */
  /** The front of the catalogue: the services themselves, as peers. */
  const atRoot = stack.length === 1 && !here.id;

  const spotlight = ((): { item: ContentItem; from: string } | null => {
    if (query || hero || trackish || loading) {
      return null;
    }
    const fromSections = sections.flatMap((section) =>
      section.items.filter((entry) => entry.coverUrl).map((entry) => ({ item: entry, from: section.name })),
    );
    const fromPeeks = items.flatMap((door) =>
      (peeks[door.id] ?? []).filter((entry) => entry.coverUrl).map((entry) => ({ item: entry, from: door.name })),
    );
    const pool = fromSections.length > 0 ? fromSections : fromPeeks;
    return pool[DAY % pool.length] ?? null;
  })();

  /*
   * Round for a person, square for a record — the one presentation decision `kind` makes here.
   * Presentation only, with a safe fallback: an unknown kind simply stays square, which is never
   * wrong, so the open set stays open.
   */
  const portrait = hero?.kind === 'artist';

  /*
   * Whose face this is.
   *
   * A person's container can come back describing one of their records: Apple Music answers the
   * browse of an artist with the first album's name and its sleeve, which is how the Parachutes
   * cover ended up standing in for the band. The tile that opened the page knew who this was — it
   * came from a search, which does describe the artist — so for a person its picture wins.
   *
   * It is also the only picture on this page that may be cropped. A photograph of a person can be
   * composed to a page; a sleeve cannot, and without a photograph the page keeps the circle rather
   * than take a knife to a record cover.
   */
  /*
   * A listing long enough to need finding rather than reading, and already in the order an index
   * would read it in.
   *
   * Twelve is about where a grid stops being a page you take in at a glance and starts being a rack
   * — under that, a letter over five names is a divider card in a box of six records. One kind at a
   * time, because a letter over a mixture of albums and folders is filing two things under one rule.
   * And never a menu: a service's own categories are a way in, not a collection, and six of them do
   * not need an alphabet. The rest is up to the listing itself — see `alphabetical`.
   */
  const indexed = useMemo(() => {
    if (query || items.length < 12) {
      return false;
    }
    const kind = items[0]?.kind;
    if (!kind || kind === 'category' || kind === 'folder' || !items.every((item) => item.kind === kind)) {
      return false;
    }
    return alphabetical(items);
  }, [query, items]);

  const face = portrait ? here.seed?.coverUrl : undefined;
  const heroArt = face ?? hero?.coverUrl;

  /* What this person made. Not in the listing — browsing an artist answers with their top songs —
     so it is one search under the strict rule. See `Artist`. */
  const records = useArtistRecords(portrait ? title : undefined, hero?.service, items);

  /** `24 tracks · 1 hr 32 min` — what the object is, in the two numbers anyone wants of it. */
  const runLine = ((): string => {
    /* A person has no running time. Theirs is how much there is of them — and how much there is
       is what the provider says, not how many rows have been fetched so far. */
    if (portrait) {
      return artistLine(records.length, listing?.total ?? items.length);
    }
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
    <div className="cx-browse" ref={scroller}>
      {/* The container's own artwork, washed out behind its title — the one flourish in this view,
          and only when there is a picture to wash. */}
      {hero && (
        <>
          <span className="cx-browse-bg" style={{ backgroundImage: itemCoverCss(heroArt) }} />
          <span className="cx-browse-fade" />
        </>
      )}

      <div
        className="cx-browse-inner"
        data-detail={hero ? '' : undefined}
        data-search={query ? '' : undefined}
        data-root={(atRoot && !query) || undefined}
        data-spotlight={(spotlight && !query) || undefined}
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
          <header className="cx-detail" data-portrait={portrait || undefined} data-photo={face ? '' : undefined}>
            <span className="cx-detail-art">
              <span className="cx-detail-bloom" style={{ backgroundImage: itemCoverCss(heroArt) }} />
              <span
                className="cx-detail-cover"
                style={{ backgroundImage: itemCoverCss(heroArt) }}
                {...detailLanding}
              >
                <Motion src={hero.animatedCoverUrl} />
              </span>
            </span>

            {runLine && <span className="mono cx-detail-kind">{runLine}</span>}
            <h1 className="disp cx-detail-title" data-len={titleStep(title)}>
              {title}
            </h1>
            {/* An artist's page is named after them; saying it twice is not two facts. */}
            {hero.artist && hero.artist.trim().toLowerCase() !== title.trim().toLowerCase() && (
              <Origin
                className="cx-detail-sub"
                text={hero.artist}
                item={heroArtist}
                onOpen={open}
                title={`Everything by ${hero.artist}`}
              />
            )}

            {hero.playable && <Actions container={hero} zone={zone} onPlay={play} onQueue={queue} onOpenRooms={onOpenRooms} />}
          </header>
        ) : (
          <div className="cx-browse-head">
            <div className="cx-browse-title-row">
              <h1 className="disp cx-browse-title">{title}</h1>
              {/* How much of it there is. Only for a listing of things — the count of a page of
                  categories is a fact about the menu, not about the music. */}
              {!query && !doors && listing?.total ? (
                <span className="mono cx-browse-count">{listing.total}</span>
              ) : null}

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
            {/* Only for a thing that is itself a record — an album, a playlist. "Play New Releases" is a
                button on a category, and a category is a place, not a thing you press play on. */}
            {!query && container?.playable && container.coverUrl && (
              <Actions container={container} zone={zone} onPlay={play} onQueue={queue} onOpenRooms={onOpenRooms} />
            )}
          </div>
        )}

        {/*
          One wrapper for everything the header introduces, so the desktop's two-column detail
          layout has exactly three children to place — back, the hero, and this — instead of five
          auto-flowing blocks landing wherever the grid's cursor happens to be.
        */}
        <div className="cx-browse-body" data-toc={(doors && !atRoot) || undefined}>
          {/*
           * Inside a service, the categories are a table of contents in the margin.
           *
           * They were rows between the shelves — Albums opened out into a shelf, Songs a line of type,
           * Artists a shelf again — which made the page's rhythm depend on which categories happened to
           * have pictures. As a column beside the shelves they are what they are: the way the service
           * is organised, read top to bottom, while the shelves show what is in it. A magazine's
           * contents page and its spreads, not a list with pictures in some of the rows.
           */}
          {doors && !atRoot && (
            <nav className="cx-toc" aria-label="Contents">
              <span className="cx-toc-lbl mono">contents</span>
              {items.map((item) => {
                const inside = peeks[item.id] ?? [];
                return (
                  <button type="button" className="cx-toc-item" key={item.id} onClick={() => open(item)}>
                    <span className="cx-toc-name disp">{item.name}</span>
                    {inside.length > 0 && (
                      <span className="cx-toc-sub">
                        {inside
                          .map((entry) => entry.name)
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {/* The window dressing, above everything the page lists — see `Billboard`. */}
          {spotlight && (
            <Billboard
              item={spotlight.item}
              from={spotlight.from}
              onOpen={() => open(spotlight.item)}
              onPlay={() => play(spotlight.item)}
            />
          )}

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
            <section
              className="cx-shelf"
              key={section.id}
              data-lead={(section.items.length >= 3 && !section.items.every((item) => item.kind === 'track')) || undefined}
            >
              <div className="cx-sec-head">
                <span className="cx-sec-lbl mono">{section.name}</span>
                <span className="cx-sec-rule" />
              </div>
              {section.items.length > 0 && section.items.every((item) => item.kind === 'track') ? (
                /* Songs are rows. A song as a 160px tile is a sleeve with the wrong name under it —
                   the album's picture, the track's title — and eight of them in a row say nothing a
                   list does not say better, with the artist and the length beside each. */
                <div className="cx-trows" data-cols>
                  {section.items.map((item, index) => (
                    <TrackRow
                      key={item.id}
                      item={item}
                      index={index}
                      thumb
                      playing={nowPlaying !== '' && item.name.trim().toLowerCase() === nowPlaying}
                      paused={zone?.state !== 'playing'}
                      onPlay={() => play(item)}
                      onQueue={() => queue(item)}
                    />
                  ))}
                </div>
              ) : (
                /* The mask on the right edge is what says "this row continues" without a scrollbar. */
                <div className="cx-shelf-row">
                  {section.items.map((item, index) => (
                    <Tile
                      key={item.id}
                      item={item}
                      index={index}
                      anchor={item.id === returning}
                      onOpen={() => open(item)}
                      onPlay={() => play(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          {doors ? (
            /*
             * The table of contents, opened out where it can be.
             *
             * A door whose children carry artwork stops describing the shelf and becomes it: the
             * name turns into a shelf heading (still the way in to the whole folder) and the first
             * dozen sleeves stand under it, each openable and playable in place. A door with
             * nothing to show stays a door. The mix is the page's rhythm — Albums and Artists as
             * shelves, Folders as a line of type — and it was decided before paint (see the browse
             * effect), so nothing here morphs.
             */
            <div className={atRoot ? 'cx-hall' : 'cx-doors'}>
              {items.map((item, index) => {
                const inside = peeks[item.id] ?? [];
                const artful = inside.filter((entry) => entry.coverUrl);
                /*
                 * Not at the front of the catalogue.
                 *
                 * The mix is the right rhythm *inside* a service — Albums and Artists opened out into
                 * shelves, Folders left as a line of type, because those are not peers and the page
                 * should say so. At the root they are peers: five services, and whether one of them
                 * happens to have four cover images at the top of its listing is not a fact about its
                 * standing. Mixed there, the front page came out as two shelves, one line with a fan
                 * pinned to the far edge and one line with nothing — four kinds of row in five, which
                 * is not rhythm, it is noise.
                 */
                return atRoot ? (
                  <Door
                    key={item.id}
                    item={item}
                    index={index}
                    hall
                    preferred={mine[item.service] ?? []}
                    onOpen={() => open(item)}
                  />
                ) : artful.length >= SHELF_MIN_ART ? (
                  <section className="cx-shelf cx-doorshelf" key={item.id} data-lead style={{ '--i': index } as React.CSSProperties}>
                    <button type="button" className="cx-doorshelf-head" onClick={() => open(item)}>
                      <span className="cx-doorshelf-name disp">{item.name}</span>
                      <span className="cx-doorshelf-go mono">
                        all <ForwardGlyph size={13} />
                      </span>
                    </button>
                    <div className="cx-shelf-row">
                      {artful.map((entry, at) => (
                        <Tile
                          key={entry.id}
                          item={entry}
                          index={at}
                          under={item.name}
                          anchor={entry.id === returning}
                          onOpen={() => open(entry)}
                          onPlay={() => play(entry)}
                        />
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
            </div>
          ) : portrait ? (
            <ArtistWork
              name={title}
              records={records}
              songs={items}
              nowPlaying={nowPlaying}
              paused={zone?.state !== 'playing'}
              returning={returning}
              onOpen={open}
              onPlay={play}
              onQueue={queue}
            />
          ) : trackish ? (
            <div className="cx-trows">
              {items.map((item, index) => (
                <TrackRow
                  key={item.id}
                  item={item}
                  index={index}
                  playing={nowPlaying !== '' && item.name.trim().toLowerCase() === nowPlaying}
                  paused={zone?.state !== 'playing'}
                  albumArtist={detail?.artist}
                  onPlay={() => play(item)}
                  onQueue={() => queue(item)}
                />
              ))}
            </div>
          ) : (
            items.length > 0 &&
            (indexed ? (
              <LetterIndex items={items} returning={returning} onOpen={open} onPlay={play} />
            ) : (
              <div className="cx-grid">
                {items.map((item, index) => (
                  <Tile
                    key={item.id}
                    item={item}
                    index={index}
                    anchor={item.id === returning}
                    onOpen={() => open(item)}
                    onPlay={() => play(item)}
                  />
                ))}
              </div>
            ))
          )}

          {/*
            The end of what has arrived. Invisible while there is more coming (the grid simply grows),
            and a line of type only once a page is actually being waited on.
          */}
          {more && (
            <div className="cx-browse-more" ref={sentinel}>
              {paging && <span className="mono">more…</span>}
            </div>
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
          /* An empty room, not an empty page: say what would appear here and where it is set up. */
          <div className="cx-inputs-empty">
            <p className="cx-browse-empty mono">nothing wired in yet</p>
            <p className="cx-inputs-empty-txt">
              A turntable, a line-in, a phone over Bluetooth — wire something into a room and it appears here,
              ready to play in any of them.
            </p>
            <a className="cx-inputs-empty-go mono" href="/admin/">
              set it up in admin
            </a>
          </div>
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
  /* The bar is on screen through every track change while you are reading the catalogue, so it
     dissolves like everything else that carries a record. */
  const artKey = artKeyOf(leader?.track);
  const title = mainTitle(cur.title);
  const gone = useLeaving(title, title);

  if (!leader) {
    return null;
  }

  return (
    <div className="cx-mini">
      {cur.hasTrack && (
        <>
          <Crossfade
            artKey={artKey}
            cover={zoneCoverCss(api, leader, 240)}
            ms={1400}
            render={(slot) => <span className="cx-mini-bg" style={{ backgroundImage: slot.cover }} />}
          />
          <span className="cx-mini-scrim" />
        </>
      )}
      <span className="cx-mini-prog">
        <i style={{ width: cur.pct }} key={`${cur.title}|${cur.durationSec}`} />
      </span>

      <button type="button" className="cx-mini-track" onClick={onOpen}>
        <span className="cx-mini-cov">
          <Crossfade
            artKey={artKey}
            cover={zoneCoverCss(api, leader, 120)}
            ms={700}
            render={(slot) => <span className="cx-mini-cov-art" style={{ backgroundImage: slot.cover }} />}
          />
        </span>
        <span className="cx-mini-meta">
          <span className="cx-mini-titlebox">
            {gone && (
              <span className="cx-mini-title cx-out" key={gone.id} aria-hidden="true">
                {gone.value}
              </span>
            )}
            <span className="cx-mini-title cx-in" key={title}>
              {title}
            </span>
          </span>
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
