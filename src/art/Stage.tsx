/**
 * The stage: one room, playing, with the technology out of sight.
 *
 * Two layouts of the same room, because a desk and a phone are not the same problem and a single
 * responsive layout serves neither:
 *
 *  - **`Stage`** (desktop) puts the artwork beside the title, which can run to 90px. The room's
 *    other faders live in the strip along the bottom and the queue in the rail, so this half of the
 *    screen holds only what is playing.
 *  - **`MobileStage`** is a full-screen player: artwork dominant and shrinking on short viewports,
 *    everything below it pinned, and the room switcher reduced to a row of chips. Nothing here
 *    scrolls — a home screen that scrolls is one where the controls can be off-screen.
 *
 * Neither shows a codec, a bitrate or a signal path. That is not an omission; it is the difference
 * between the two faces, and anything technical that ends up here belongs in the other one.
 */
import { useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import { horizontalDrag } from '@/art/drag';
import { useVolumeControl } from '@/art/volume';
import { Crossfade } from '@/art/Crossfade';
import { artKeyOf } from '@/art/accent';
import type { RoomDrag } from '@/art/useRoomDrag';
import { Motion } from '@/art/Motion';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { useCoverAnchor } from '@/shell/coverMorph';
import {
  BackGlyph,
  ChevronGlyph,
  EmptyArtGlyph,
  ForwardGlyph,
  HeartGlyph,
  NextGlyph,
  PauseGlyph,
  PlayGlyph,
  PrevGlyph,
  RepeatGlyph,
  ShuffleGlyph,
  SpeakerGlyph,
} from '@/art/glyphs';
import { formatTime } from '@/lib/format';
import { bareAlbum, mainTitle, splitTitle } from '@/lib/title';
import type { Cur } from '@/art/useCur';
import type { ContentItem } from '@/api/content';

/** Greeting by hour — the welcome screen's line, reused as the stage's eyebrow. */
export function greeting(hour = new Date().getHours()): string {
  if (hour < 6) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Transport, one row, shared by every layout so they can never disagree about behaviour.
 *
 * Three sizes rather than two: `bar` is the signal view's context strip, where the transport rides a
 * 64px band beside a thumbnail. Same five controls and the same handlers — only the metal shrinks,
 * because a reading you cannot pause from is a reading you have to leave to act on.
 */
export function Transport({ cur, size }: { cur: Cur; size: 'desk' | 'phone' | 'bar' }) {
  const api = useApi();
  const leader = cur.leader;
  const phone = size !== 'desk';

  const toggle = (): void => {
    if (!leader) {
      return;
    }
    void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id));
  };

  return (
    <div className="cx-transport" data-size={size}>
      {/*
       * Five controls on both, now that the phone's player has the room for them.
       *
       * They were a desk's affordances only: on the old phone screen the transport was five
       * equal-looking targets crammed under a full-bleed sleeve, which is a remote control rather
       * than a player. What changed is the hierarchy around them — a 74px solid white play against
       * 19px outline glyphs is not five equal targets, it is one button with four settings beside
       * it, which is what the design asks for and what every phone player draws.
       */}
      <button
        type="button"
        className="cx-tr-side"
        data-on={cur.shuffle || undefined}
        aria-label="Shuffle"
        onClick={() => leader && void api.setShuffle(leader.id, !cur.shuffle)}
      >
        <ShuffleGlyph size={19} />
      </button>
      <button type="button" className="cx-tr-skip" aria-label="Previous" onClick={() => leader && void api.previous(leader.id)}>
        <PrevGlyph size={phone ? 23 : 25} />
      </button>
      <button type="button" className="cx-tr-play" aria-label={cur.isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
        {cur.isPlaying ? <PauseGlyph size={phone ? 20 : 22} /> : <PlayGlyph size={phone ? 21 : 23} />}
      </button>
      <button type="button" className="cx-tr-skip" aria-label="Next" onClick={() => leader && void api.next(leader.id)}>
        <NextGlyph size={phone ? 23 : 25} />
      </button>
      <button
        type="button"
        className="cx-tr-side"
        data-on={cur.repeat || undefined}
        aria-label="Repeat"
        onClick={() => leader && void api.setRepeat(leader.id, cur.repeat ? 'off' : 'all')}
      >
        <RepeatGlyph size={19} />
      </button>
    </div>
  );
}

/**
 * The timeline.
 *
 * Drawn only when there is something to seek within — `cur.showBar` is `source.seekable` and a
 * known duration, never `duration > 0` on its own. A live stream gets the LIVE mark instead, which
 * is a statement rather than a bar that cannot be dragged.
 */
export function Timeline({ cur, bare = false }: { cur: Cur; bare?: boolean }) {
  const api = useApi();
  const [scrubbing, setScrubbing] = useState(false);
  const leader = cur.leader;

  const seek = horizontalDrag(
    (fraction) => {
      if (leader && cur.durationSec > 0) {
        void api.seek(leader.id, Math.round(fraction * cur.durationSec));
      }
    },
    () => setScrubbing(true),
    () => setScrubbing(false),
  );

  const bar = (
    /* While scrubbing the fill must not animate: a transition on `width` fights the finger and the knob
       lands where the drag was a moment ago. */
    <div className="cx-bar" onPointerDown={seek} data-scrub={scrubbing || undefined}>
      <span className="cx-bar-rail">
        <span className="cx-bar-fill" style={{ width: cur.pct }} />
        <span className="cx-bar-knob" style={{ left: cur.pct }} />
      </span>
    </div>
  );

  /*
   * `bare` splits the bar from its clock.
   *
   * On a desk the two belong together — a bar with the times under it is one object. On a phone the bar
   * rides the bottom edge of the artwork and the times sit below it in the player, with the canvas's edge
   * between them, so they cannot be one element.
   */
  if (bare) {
    return bar;
  }

  return (
    <div className="cx-bar-wrap">
      {bar}
      <Times cur={cur} />
    </div>
  );
}

/** Elapsed and remaining, tabular so nothing twitches while it counts. */
/**
 * Elapsed on the left; on the right what is left — or, pressed, how long the whole thing is. The
 * choice is remembered for the session: someone who wants to know the length wants it every time.
 */
let showTotal = false;
function Times({ cur }: { cur: Cur }) {
  const [total, setTotal] = useState(showTotal);
  return (
    <div className="cx-times mono">
      <span className="cx-time-el">{cur.elapsed}</span>
      <button
        type="button"
        className="cx-time-tot mono"
        title={total ? 'Show time remaining' : 'Show the length'}
        onClick={() => {
          showTotal = !total;
          setTotal(!total);
        }}
      >
        {total && cur.durationSec > 0 ? formatTime(cur.durationSec) : cur.remain}
      </button>
    </div>
  );
}

function Live() {
  return (
    <div className="cx-live">
      <span className="cx-live-dot" />
      <span className="cx-live-txt mono">live</span>
    </div>
  );
}

/**
 * The heart. Absent when the source cannot be restarted by id — see `useZoneFavorite`.
 *
 * Bound to the *leader*, not to the selected room: a follower has no queue and no source of its own,
 * so favouriting from it would save nothing. The favourite still lands on the room you are looking
 * at, which is what "favourite of where" means here.
 */
function Favourite({ cur, round = false }: { cur: Cur; round?: boolean }) {
  const { available, saved, toggle } = useZoneFavorite(cur.leader);

  if (!available) {
    return null;
  }
  return (
    <button
      type="button"
      className={round ? 'cx-fav-round' : 'cx-fav'}
      data-on={saved ? '' : undefined}
      aria-label={saved ? 'Remove from favourites' : 'Add to favourites'}
      onClick={toggle}
    >
      <HeartGlyph size={round ? 18 : 17} filled={Boolean(saved)} />
    </button>
  );
}

/** A room's volume, as a horizontal fader with a readout that appears while dragging. */
export function VolumeRow({ cur, className }: { cur: Cur; className: string }) {
  const control = useVolumeControl(cur.zone);
  return (
    <span className={className}>
      <SpeakerGlyph size={15} />
      <span className="cx-vol-slider" onPointerDown={control.onPointerDownH}>
        <span className="cx-vol-rail">
          <span className="cx-vol-fill" style={{ width: control.pct }} />
          <span className="cx-vol-knob" style={{ left: control.pct }} />
          <span className="cx-vol-bubble mono" style={{ left: control.pct, opacity: control.active ? 1 : 0 }}>
            {control.value}
          </span>
        </span>
      </span>
      {/* The number, always: a fader without its reading is a line. The louder speaker glyph it
          replaces said nothing the number does not. */}
      <span className="cx-vol-num mono">{control.value}</span>
    </span>
  );
}

/**
 * How big the title is set, decided by how long it is.
 *
 * The size used to be a pure function of viewport height (`clamp(50px, 8.6vh, 112px)`), so a
 * 1440px-tall monitor set every title at 112px — including `Suddenly (w/ Beatie Wolfe)`, which then
 * ran out of its column and was clipped to `Suddenly (w/ Beatie…` while 900px of the page beside it
 * stayed empty. A title is the subject of this screen; cutting it short with room to spare is the one
 * thing it must never do.
 *
 * Stepped rather than measured, on purpose. A fit-to-width pass has to render, measure and re-render,
 * which costs a frame on every track change and can disagree with itself between two renders of the
 * same track — and the thing being avoided (a clipped title) is a *threshold*, so a threshold is the
 * honest shape of the answer. Step 1 is the shortest title and the largest type; the boundaries sit
 * where two lines of the step above stop fitting the column (see the ladder in `art.css`).
 *
 * Characters, not words: what fills a line is glyph count, and `Ænima` and `Untitled #3` cost the
 * same either way.
 */
/**
 * The phone's fader: speaker, a short rail, the number. The number is always there rather than in a
 * bubble while dragging, because on a phone the thumb covers the rail and the number is the readout.
 */
function PhoneVolume({ cur }: { cur: Cur }) {
  const control = useVolumeControl(cur.zone);
  return (
    <span className="cx-np-vol">
      <SpeakerGlyph size={16} />
      <span className="cx-vol-slider" onPointerDown={control.onPointerDownH}>
        <span className="cx-vol-rail">
          <span className="cx-vol-fill" style={{ width: control.pct }} />
          <span className="cx-vol-knob" style={{ left: control.pct }} />
        </span>
      </span>
      <span className="cx-np-vol-num mono">{control.value}</span>
    </span>
  );
}

/**
 * A name that becomes a door when there is a page behind it.
 *
 * The artist above the title and the album under it are already on the page; a player that wants you
 * to *go* to them does not need a menu for it, it needs those words to be pressable. Rendered as plain
 * type until the catalogue has answered (see `useOrigin`), so a door is never drawn onto a dead end.
 */
export function Origin({
  className,
  text,
  item,
  onOpen,
  title,
}: {
  className: string;
  text: string;
  item: ContentItem | null | undefined;
  onOpen?: ((item: ContentItem) => void) | undefined;
  title: string;
}) {
  if (!item || !onOpen) {
    return <span className={className}>{text}</span>;
  }
  return (
    <button type="button" className={`${className} cx-door`} onClick={() => onOpen(item)} title={title}>
      {text}
    </button>
  );
}

export function titleStep(title: string): 1 | 2 | 3 | 4 | 5 {
  const length = title.trim().length;
  if (length <= 12) {
    return 1;
  }
  if (length <= 24) {
    return 2;
  }
  if (length <= 40) {
    return 3;
  }
  if (length <= 56) {
    return 4;
  }
  return 5;
}

/**
 * What is on the wire, as three or four characters' worth of mono: `24 / 44.1 → sendspin`.
 *
 * Depth first when the format has one (a lossy codec does not), the rate in kHz with the trailing
 * zero dropped, then the protocol carrying it. When the zone has not reported a format yet the chip
 * still says where it goes — `signal` — so the door does not blink in and out while a stream starts.
 */
/**
 * Whether the album line is worth a line: not when it is the title again with `- Single` or `- EP`
 * behind it, which is how a store spells "this is the only track".
 */
export function albumWorthShowing(title: string, album: string): boolean {
  if (!album || album === title) {
    return false;
  }
  return bareAlbum(album).toLowerCase() !== mainTitle(title).toLowerCase();
}

export function wireLabel(cur: Cur): string {
  /* `format.output` is what is on the wire — the reading's own "handed off" column, not the source. */
  const format = cur.leader?.format?.output;
  const protocol = cur.leader?.output?.protocol;
  if (!format) {
    return 'signal';
  }
  const rate = (format.sampleRate / 1000).toString().replace(/\.0$/, '');
  const depth = format.bitDepth ? `${format.bitDepth} / ` : '';
  return `${depth}${rate}${protocol ? ` → ${protocol}` : ''}`;
}

// --- desktop ----------------------------------------------------------------

export function Stage({
  cur,
  onOpenRooms,
  onOpenQueue,
  onBrowse,
  onSignal,
  onLeaveCanvas,
  resting,
  drag,
  upNext,
  upNextTotal,
  lastCover,
  elsewhere,
  house,
  onTurn,
  neighbours,
  origin,
  onOpenOrigin,
}: {
  cur: Cur;
  /** The room gestures — the sleeve is the thing you pick up. See `useRoomDrag`. */
  drag: RoomDrag;
  onOpenRooms: () => void;
  onOpenQueue: () => void;
  onBrowse: () => void;
  /** The third way of looking: what the audio is doing, in this same window. Opened from the format chip. */
  onSignal: () => void;
  /** Leave it again — see the click handler below for what counts as leaving. */
  onLeaveCanvas: () => void;
  /** Whether the picture is what is on screen, however it was arrived at. */
  resting: boolean;
  /** What comes after this one, as sleeves — the room's own shelf. See `.cx-upnext`. */
  upNext: {
    key: string;
    title: string;
    artist: string;
    cover: string | undefined;
    /** Seconds; 0 when unknown. */
    duration: number;
    play: () => void;
  }[];
  /** How many entries follow the one playing — the shelf shows two, the count says the rest. */
  upNextTotal: number;
  /**
   * Music playing in another room, for a room with none: the one thing a quiet stage can offer that a
   * catalogue cannot. `join` puts this room in that room's group.
   */
  elsewhere?: { room: string; title: string; join: () => void } | undefined;
  /**
   * The house, drawn at the foot of the record's own page.
   *
   * On a wide window the stage is a spread — the sleeve is the left page, the room the right — and the
   * rooms belong on the right page, not on a strip under both. See `HouseStrip`.
   */
  house?: React.ReactNode;
  /** Turn to the next room, or the one before — see `ArtApp`'s `turnRoom`. Absent with one room. */
  onTurn?: ((dir: 'left' | 'right') => void) | undefined;
  /** Who is on either side, for the edges' labels. */
  neighbours?: { left: string; right: string } | undefined;
  /** The album and the artist this record belongs to, once the catalogue has answered. See `useOrigin`. */
  origin?: { album: ContentItem | null; artist: ContentItem | null } | undefined;
  onOpenOrigin?: ((item: ContentItem) => void) | undefined;
  /**
   * The last record this room played, as `url("…")`.
   *
   * The only honest picture a silent room has. See the empty branch below for what it is for.
   */
  lastCover?: string | undefined;
}) {
  const api = useApi();
  const leader = cur.leader;
  const coverAnchor = useCoverAnchor();
  /* What "the artwork changed" means — the same handle the page's wash dissolves on. */
  const artKey = artKeyOf(leader?.track);

  const toggle = (): void => {
    /* A press that turned into a throw is not a press. See `useRoomDrag`. */
    if (drag.consumed() || !leader || !cur.hasTrack) {
      return;
    }
    void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id));
  };

  /*
   * Leaving the picture by pressing the page it is on.
   *
   * Everything except the sleeve is hidden while resting, so "click anywhere that is not a control" is
   * the whole of the page around it — and the sleeve keeps meaning what it means everywhere else, which
   * is play and pause. Closing on the sleeve would be the one place in this player where pressing the
   * artwork does something other than stop the music.
   */
  const leave = (event: React.MouseEvent): void => {
    if (resting && !(event.target as HTMLElement).closest('button')) {
      onLeaveCanvas();
    }
  };

  /*
   * A horizontal wheel — a trackpad swipe — turns the page. Summed until it is a deliberate gesture,
   * then one turn and a moment's silence, so a long swipe is one page and not four.
   */
  const wheelSum = useRef(0);
  const wheelUntil = useRef(0);
  const onWheel = (event: React.WheelEvent): void => {
    if (!onTurn || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
      return;
    }
    const now = Date.now();
    if (now < wheelUntil.current) {
      return;
    }
    wheelSum.current += event.deltaX;
    if (Math.abs(wheelSum.current) > 140) {
      onTurn(wheelSum.current > 0 ? 'right' : 'left');
      wheelSum.current = 0;
      wheelUntil.current = now + 900;
    }
  };

  return (
    <div
      className="cx-stage"
      data-spread={cur.hasTrack || undefined}
      onClick={leave}
      onWheel={onWheel}
    >
      {/* The page's edges: rest the pointer there and the neighbouring room's name appears; press and the
          page turns. Drawn only with somewhere to turn to. */}
      {onTurn && neighbours && !resting && (
        <>
          <button type="button" className="cx-turn" data-side="left" onClick={() => onTurn('left')} aria-label={`To ${neighbours.left}`}>
            <BackGlyph size={18} />
            <span className="cx-turn-name mono">{neighbours.left}</span>
          </button>
          <button type="button" className="cx-turn" data-side="right" onClick={() => onTurn('right')} aria-label={`To ${neighbours.right}`}>
            <span className="cx-turn-name mono">{neighbours.right}</span>
            <ForwardGlyph size={18} />
          </button>
        </>
      )}
      {/* The composition is one block, centred: cover and column together, capped, rather than a cover
          pinned left and a column stretching to whatever the window happens to be. A player on a
          2560px monitor should look composed, not spread. */}
      <div className="cx-stage-inner">
        <div className="cx-stage-art" data-quiet={!cur.isPlaying || undefined}>
          {/*
           * The sleeve, blurred behind itself.
           *
           * Not a gradient in an extracted colour — *the artwork*, a second copy of it clipped to a circle
           * the same size as the cover, sitting directly behind it under a 52px blur and pushed a quarter
           * more saturated. Which means the light in the room is the record's own light at the record's own
           * distribution, and no palette has to be guessed at: a sleeve that is mostly one colour throws
           * that colour, and a busy one throws a wash of all of it.
           *
           * It breathes on a 7s cycle while playing and settles when paused. That is the one continuous
           * animation in this face and it is load-bearing — a still page with a still glow reads as a
           * screenshot, and this is the thing that says the room is live.
           */}
          {cur.hasTrack && (
            <>
              <span
                className="cx-bloom-far"
                style={{ backgroundImage: zoneCoverCss(api, leader, 160) }}
                aria-hidden="true"
              />
              <span
                className="cx-bloom"
                style={{ backgroundImage: zoneCoverCss(api, leader, 320) }}
                aria-hidden="true"
              />
            </>
          )}

          {cur.hasTrack ? (
            <>
              <button
                type="button"
                className="cx-cover"
                data-paused={!cur.isPlaying || undefined}
                aria-label={cur.isPlaying ? 'Pause' : 'Play'}
                onClick={toggle}
                /*
                 * Press it to stop the music, pull it to move the music.
                 *
                 * The same object doing both is the point: the record *is* what is playing, so carrying
                 * it to another room is the gesture a person already has for that idea. Nine pixels of
                 * travel separate the two — far enough that nobody pauses by accident, short enough that
                 * the throw feels picked up rather than dragged.
                 */
                onPointerDown={(event) =>
                  leader &&
                  drag.begin(
                    {
                      kind: 'record',
                      zoneId: leader.id,
                      cover: zoneCoverCss(api, leader, 320),
                      name: cur.title || cur.name,
                    },
                    event,
                  )
                }
                {...coverAnchor}
              >
                {/*
                 * One record dissolves into the next.
                 *
                 * The artwork was an inline `background-image` on this button, which cannot animate —
                 * a url does not interpolate, so every track change cut. The wash behind the page has
                 * dissolved for as long as it has existed and the *sleeve itself*, the one thing on
                 * screen anybody is looking at, snapped. Same two-slot component, faster: 900ms is a
                 * record being replaced, where the room's light takes 1.9s to follow it.
                 */}
                <Crossfade
                  artKey={artKey}
                  cover={zoneCoverCss(api, leader)}
                  ms={900}
                  render={(slot) => (
                    <span className="cx-cover-art" style={{ backgroundImage: slot.cover }} />
                  )}
                />
                {/* The sleeve, if this record has one that moves. A still underneath, always. */}
                <Motion src={cur.motion} />
                <span className="cx-cover-hover">
                  <span className="cx-cover-glyph">
                    {cur.isPlaying ? <PauseGlyph size={19} /> : <PlayGlyph size={20} />}
                  </span>
                </span>
              </button>
            </>
          ) : (
            /*
             * A silent room, drawn as what it is: the record that was on, in the dark.
             *
             * It was a dashed square with a glyph in it — a form field where the subject of the face
             * should be, and the state most rooms are in most of the time. A room that has played
             * something has one honest picture to show, and holding it far down says *silent* better
             * than an outline of an absence does. Rooms that have never played anything keep a plain
             * frame: a hairline, not a dashed one, because dashes mean "drop something here".
             */
            <div
              className="cx-cover cx-cover-empty"
              data-remembers={lastCover ? '' : undefined}
              style={lastCover ? { backgroundImage: lastCover } : undefined}
            >
              {!lastCover && <EmptyArtGlyph size={52} />}
              {/* No caption over the record: the column beside it says `Nothing playing` in 110px, and
                  the same sentence twice is not two facts. The frame with no memory keeps its words,
                  because a bare outline needs telling. */}
              {!lastCover && <span className="mono cx-cover-empty-txt">nothing playing</span>}
            </div>
          )}
        </div>

        <div className="cx-stage-meta">
          {/*
           * The room and where the music came from, on one line.
           *
           * The source used to be a bordered chip beside the artist — the only boxed thing left on a
           * screen whose design says nothing is boxed — and it competed with the artist's name for the
           * same row. As the second half of the eyebrow it is provenance, which is what it is.
           */}
          <span className="mono cx-eyebrow">
            {cur.name || greeting()}
            {cur.hasTrack && cur.source && <i className="cx-eyebrow-src">{cur.source}</i>}
            {/*
             * The one measurement this face carries, and it is a door.
             *
             * What is on the wire to the room — `24 / 44.1 → sendspin` — in a small boxed chip at the far
             * end of the eyebrow: the only boxed thing on the screen, because it is the only thing on the
             * screen that is *about the technology*. Pressing it opens the reading (`Signal`), which is
             * where every other number lives. A hidden word (`signal`) used to do this from the volume row;
             * a chip that says what it is about is a door that says where it goes.
             */}
            {cur.hasTrack && (
              <button type="button" className="cx-wire mono" onClick={onSignal} title="What is happening to the audio">
                {wireLabel(cur)}
                <ForwardGlyph size={11} />
              </button>
            )}
          </span>

          {/*
           * A track change is a moment, so the words arrive like one.
           *
           * Keyed on the track's identity: React remounts the three lines and each runs the same
           * rise the phone's meta block already had, staggered a beat apart (`cx-swap-2/-3`) so
           * the title leads and the provenance follows. Keyed on title+artist rather than on the
           * zone object, which is replaced every second — a rise per progress tick would turn a
           * gesture into a twitch.
           */}
          {/*
           * Who, then what — a gallery card's order, not a search result's.
           *
           * The artist used to sit under the title, which is how a listing is written: the thing you
           * matched on first, then who it was by. A page with one record on it is not a listing, it is a
           * label on a wall, and every label ever printed reads *Artist / Title / medium*. It also fixes
           * what was under the title before: a 100px headline followed by two lines of grey, one of
           * which was the same size as the other. Now the drop is deliberate — a tracked name, the work
           * at full size, and the record it came from set small underneath.
           */}
          <div className="cx-artistrow cx-swap" key={`a:${cur.title}|${cur.artist}`}>
            {cur.artist && (
              <Origin
                className="cx-artist"
                text={cur.artist}
                item={origin?.artist}
                onOpen={onOpenOrigin}
                title={`Everything by ${cur.artist}`}
              />
            )}
            {cur.hasTrack && <Favourite cur={cur} />}
          </div>

          <h1
            className="disp cx-title cx-swap cx-swap-2"
            data-len={titleStep(mainTitle(cur.title))}
            key={`t:${cur.title}|${cur.artist}`}
          >
            {mainTitle(cur.title)}
          </h1>
          {/* The edition, as a line of small type: what the store hung off the name — see `splitTitle`. */}
          {splitTitle(cur.title).tags.length > 0 && (
            <span className="cx-title-tags mono cx-swap cx-swap-3" key={`v:${cur.title}`}>
              {splitTitle(cur.title).tags.join(' · ')}
            </span>
          )}

          {/* The album, under the artist rather than folded into it with a dash: it is a place the
              track came from, not part of its name. */}
          {albumWorthShowing(cur.title, cur.album) && (
            <span className="cx-albumrow cx-swap cx-swap-3" key={`b:${cur.title}|${cur.album}`}>
              <Origin
                className="cx-album"
                text={bareAlbum(cur.album)}
                item={origin?.album}
                onOpen={onOpenOrigin}
                title={`Open ${bareAlbum(cur.album)}`}
              />
            </span>
          )}

          {/* Why the last attempt failed. `play` answers before anything is resolved, so this is the
              only place a failure can appear — and it belongs beside the title it failed to become. */}
          {cur.error && <p className="cx-error">{cur.error}</p>}

          {!cur.hasTrack && (
            <>
              <span className="cx-cta">
                <button type="button" className="mono" onClick={onBrowse}>
                  browse music
                </button>
                <button type="button" className="mono" onClick={onOpenRooms}>
                  rooms
                </button>
              </span>
              {/* What the house is doing, as an invitation rather than a fact: one press and this room
                  is listening too. Only when there is something to join. */}
              {elsewhere && (
                <button type="button" className="cx-else" onClick={elsewhere.join}>
                  <span className="cx-else-txt">
                    <i className="cx-else-room mono">{elsewhere.room}</i> is playing {elsewhere.title}
                  </span>
                  <span className="cx-else-go mono">listen here</span>
                </button>
              )}
            </>
          )}

          {cur.isLive && <Live />}
          {/*
           * The plain bar, on this face, at every width.
           *
           * The desk drew the track's scanned envelope here for a while — the same shape the phone
           * player once carried — and it was the wrong instrument on the wrong stage: forty bars of
           * measurement under a 100px title is a reading, and this face's argument is that readings
           * live on the other one. The line says the one thing the room needs from it, which is how
           * far in it is.
           */}
          {cur.showBar && <Timeline cur={cur} />}

          <Transport cur={cur} size="desk" />

          {/*
           * The foot of the column: what is next on the left, the level on the right.
           *
           * The row that stood here held the fader and four words — `rooms canvas house signal` — and
           * every one of the four has a better home now: rooms is in the top bar, canvas and house
           * are at the end of the house strip, signal is the format chip in the eyebrow. What is left
           * is the two things that are genuinely *this room's*: its running order and its volume.
           *
           * Two sleeves and the first title, not four sleeves with hover captions. Two is enough to
           * read as a shelf, the title says what the shelf's first record is without a hover, and the
           * count in the label carries the rest. The label and the text open the queue; a sleeve plays
           * the record it shows.
           */}
          <div className="cx-stage-foot">
            {cur.hasTrack && !cur.isLive && (
              <div className="cx-upnext">
                <button type="button" className="cx-upnext-lbl mono" onClick={onOpenQueue}>
                  up next{upNextTotal > 0 ? ` · ${upNextTotal}` : ''}
                </button>
                {/* Three rows, each a record: sleeve, name, who, how long. Two thumbnails and one line
                    said less than this and took the same height. The label opens the whole queue. */}
                <ol className="cx-upnext-list">
                  {upNext.slice(0, 3).map((entry) => (
                    <li key={entry.key}>
                      <button
                        type="button"
                        className="cx-upnext-item"
                        onClick={entry.play}
                        title={`Play ${entry.title}${entry.artist ? ` — ${entry.artist}` : ''}`}
                      >
                        <span className="cx-upnext-art" style={{ backgroundImage: entry.cover }} aria-hidden="true" />
                        <span className="cx-upnext-txt">
                          <span className="cx-upnext-title">{entry.title}</span>
                          {entry.artist && <i className="cx-upnext-artist">{entry.artist}</i>}
                        </span>
                        {entry.duration > 0 && <span className="cx-upnext-dur mono">{formatTime(entry.duration)}</span>}
                      </button>
                    </li>
                  ))}
                  {upNext.length === 0 && <li className="cx-upnext-empty">nothing after this one</li>}
                </ol>
              </div>
            )}
            <VolumeRow cur={cur} className="cx-vol" />
          </div>

          {house && <div className="cx-stage-house">{house}</div>}
        </div>
      </div>
    </div>
  );
}

// --- phone ------------------------------------------------------------------

/**
 * The phone player.
 *
 * The artwork absorbs every spare pixel and is the *first* thing to give them back: the control rows
 * beneath it are all `flex: none`, so on a short viewport (a landscape phone, a small screen) the
 * cover shrinks and the transport, volume and room chips stay exactly where they are. The
 * alternative — letting the block below scroll — puts the play button under the fold on precisely
 * the devices where it matters most.
 */
/** How far the sleeve has to travel before letting go changes the track. */
const SWIPE_COMMIT_PX = 55;

/** Under this it was a tap, not a drag. Without the band, an imprecise tap skips the track. */
const SWIPE_TAP_PX = 8;

/**
 * One soft tick under the thumb, at the moment a gesture commits.
 *
 * The canvas gestures have no button to press and therefore no visual travel to feel — a swipe
 * that changes the track and a swipe that fell short look identical until the artwork answers.
 * 8 ms is a tick, not a buzz: confirmation, in the register of a camera shutter. Android only;
 * iOS Safari has no vibration API and the optional call simply never fires there.
 */
function tick(): void {
  navigator.vibrate?.(8);
}

export function MobileStage({
  cur,
  artKey,
  currentLeaderId,
  onOpenRooms,
  onOpenQueue,
  onBrowse,
  onSignal,
  onDismiss,
  upNextTotal = 0,
  origin,
  onOpenOrigin,
}: {
  cur: Cur;
  artKey: string;
  currentLeaderId: number | null;
  onOpenRooms: () => void;
  /** Raised by swiping up on the canvas, and by the row along the bottom. */
  onOpenQueue: () => void;
  onBrowse: () => void;
  /** The reading, from the format chip — the same door the desk's eyebrow carries. */
  onSignal: () => void;
  /** How many entries follow the one playing; the foot's `up next` carries the number. */
  upNextTotal?: number;
  /** The album and the artist this record belongs to — see `useOrigin`. */
  origin?: { album: ContentItem | null; artist: ContentItem | null } | undefined;
  onOpenOrigin?: ((item: ContentItem) => void) | undefined;
  /**
   * Put the player away — it is a layer over the app now, not the app's home screen.
   *
   * Both the chevron and a downward swipe on the sleeve call this. Down was deliberately dead
   * before, on the argument that a pull which opens what a push closes feels broken; that held
   * while the player *was* home and there was nowhere to go. Now down is the one gesture every
   * phone has taught for exactly this, and up (the queue) keeps its opposite.
   */
  onDismiss?: (() => void) | undefined;
}) {
  const api = useApi();
  const leader = cur.leader;

  const toggle = (): void => {
    if (!leader || !cur.hasTrack) {
      return;
    }
    void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id));
  };

  /*
   * Swipe the sleeve for previous/next, tap it to pause — and let it follow the finger.
   *
   * The gesture worked before and gave no sign that it was working: you dragged across a sleeve that did
   * not move, let go, and either the track changed or it did not. Following the drag turns a hidden
   * threshold into a visible one — the sleeve leans, the lean stops keeping up past the commit distance,
   * and letting go under it springs back.
   */
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onDown = (event: React.PointerEvent): void => {
    swipe.current = { x: event.clientX, y: event.clientY, moved: false };
    setDragging(true);
  };
  const onMove = (event: React.PointerEvent): void => {
    const start = swipe.current;
    if (!start) {
      return;
    }
    const raw = event.clientX - start.x;
    if (Math.abs(raw) > SWIPE_TAP_PX || Math.abs(event.clientY - start.y) > SWIPE_TAP_PX) {
      start.moved = true;
    }
    // Linear to the commit point, then a third of the distance — rubber, not rails. The lean is
    // horizontal only: a vertical swipe barely moves x, so the sleeve holds still under it.
    const over = Math.max(0, Math.abs(raw) - SWIPE_COMMIT_PX);
    setDx((Math.abs(raw) - over + over / 3) * Math.sign(raw));
  };
  const settle = (): void => {
    swipe.current = null;
    setDragging(false);
    setDx(0);
  };
  const onUp = (event: React.PointerEvent): void => {
    const start = swipe.current;
    if (!start || !leader) {
      settle();
      return;
    }
    const travelledX = event.clientX - start.x;
    const travelledY = event.clientY - start.y;
    if (start.moved && Math.abs(travelledY) >= SWIPE_COMMIT_PX && Math.abs(travelledY) > Math.abs(travelledX)) {
      /*
       * Up, from the sleeve: what is behind this track. The queue was reachable only through the
       * bottom nav, a reach away from where the thumb already is — and pulling upward on the thing
       * that is playing to see what follows it is the gesture every phone player has taught.
       * Downward deliberately does nothing; the sheet's own dismiss is a downward drag, and a pull
       * that opens what a push closes would make the pair feel broken.
       */
      if (travelledY < 0) {
        tick();
        onOpenQueue();
      } else if (onDismiss) {
        // Down puts the player away — see `onDismiss`.
        tick();
        onDismiss();
      }
    } else if (start.moved && Math.abs(travelledX) >= SWIPE_COMMIT_PX) {
      tick();
      void (travelledX < 0 ? api.next(leader.id) : api.previous(leader.id));
    } else if (!start.moved) {
      tick();
      toggle();
    }
    settle();
  };

  return (
    <div className="cx-mstage" data-quiet={!cur.hasTrack || undefined}>
      {/* The room, lit by the record: the sleeve blurred to a wall behind everything. This is the whole
          background of the phone player — there is no other surface. */}
      {cur.hasTrack && (
        <Crossfade
          artKey={artKey}
          cover={zoneCoverCss(api, leader)}
          render={(slot) => (
            <>
              <span className="cx-mstage-bg" style={{ backgroundImage: slot.cover }} />
              <span className="cx-mstage-scrim" />
            </>
          )}
        />
      )}

      {/* The way back down, where the mockup puts it: top-left, a chevron, nothing else. */}
      {onDismiss && (
        <button type="button" className="cx-np-close" onClick={onDismiss} aria-label="Close the player">
          <ChevronGlyph size={26} />
        </button>
      )}

      {/* Which room this is, over the sleeve's top edge, and the way to the others. It stood in the
          foot beside the queue; up here it is the header a full-screen player has anyway. */}
      <button type="button" className="cx-np-roompill mono" onClick={onOpenRooms}>
        {cur.name || 'rooms'}
        {cur.grouped && <i className="cx-np-plus">+{cur.groupExtra}</i>}
        <ChevronGlyph size={12} />
      </button>

      {/*
       * The sleeve as a square, inset, with corners.
       *
       * It was full-bleed and *not* square — a landscape crop of the artwork bleeding to all four
       * edges with its bottom third melting into black. On a wall panel that reads as the record
       * taking the room; in a hand it reads as a picture that has been cut, and it cost the screen
       * its centre of gravity. A square with margins is what a record is, and what every phone
       * player shows, and it leaves the type below a clean edge to start from.
       */}
      <div className="cx-np-art">
        {cur.hasTrack ? (
          <div
            className="cx-np-cover"
            style={{
              backgroundImage: zoneCoverCss(api, leader),
              translate: dx ? `${dx}px 0` : undefined,
              scale: dragging ? 0.985 : undefined,
            }}
            data-dragging={dragging || undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={settle}
          >
            <Motion src={cur.motion} />
            {/* The printed gloss, the same breath the desk's sleeve carries. */}
            <span className="cx-np-gloss" aria-hidden="true" />
            {!cur.isPlaying && (
              <span className="cx-doek-play" aria-hidden="true">
                <PlayGlyph size={20} />
              </span>
            )}
          </div>
        ) : (
          <div className="cx-np-cover cx-np-cover-empty">
            <EmptyArtGlyph size={42} />
            <span className="mono cx-cover-empty-txt">nothing playing</span>
          </div>
        )}
      </div>

      <div className="cx-np-meta">
        {/*
         * Provenance and the one measurement, on a line of their own above the title — the same
         * eyebrow the desk has. The chip is the door to the reading; on a phone it is the only one.
         */}
        {cur.hasTrack && (
          <div className="cx-np-eyebrow mono">
            {cur.source && <span>{cur.source}</span>}
            <button type="button" className="cx-wire mono" onClick={onSignal} title="What is happening to the audio">
              {wireLabel(cur)}
              <ForwardGlyph size={11} />
            </button>
          </div>
        )}

        {/* Keyed on the room *and* the track, so the block crossfades when either changes. */}
        <div className="cx-np-head" key={`${currentLeaderId ?? 'none'}:${cur.title}`}>
          <span className="cx-np-titles">
            <span className="disp cx-np-title">{mainTitle(cur.title)}</span>
            {splitTitle(cur.title).tags.length > 0 && (
              <span className="cx-np-tags mono">{splitTitle(cur.title).tags.join(' · ')}</span>
            )}
            {cur.artist && (
              <Origin
                className="cx-np-artist"
                text={cur.artist}
                item={origin?.artist}
                onOpen={onOpenOrigin}
                title={`Everything by ${cur.artist}`}
              />
            )}
            {albumWorthShowing(cur.title, cur.album) && (
              <Origin
                className="cx-np-album"
                text={bareAlbum(cur.album)}
                item={origin?.album}
                onOpen={onOpenOrigin}
                title={`Open ${bareAlbum(cur.album)}`}
              />
            )}
          </span>
          {cur.hasTrack && <Favourite cur={cur} round />}
        </div>

        {cur.error && <p className="cx-error">{cur.error}</p>}

        {!cur.hasTrack && (
          <span className="cx-cta">
            <button type="button" className="mono" onClick={onBrowse}>
              browse music
            </button>
          </span>
        )}

        {/*
         * The position, as a hairline with its two clocks under it.
         *
         * Elapsed and *total* rather than elapsed and remaining: this is the one screen where the
         * record's own length is the more useful of the two, and it is what the design asks for.
         * A scanned envelope belongs to the desk — at this size it was texture rather than shape.
         */}
        {cur.showBar && (
          <div className="cx-np-prog">
            <Timeline cur={cur} bare />
            <div className="cx-np-times mono">
              <span>{cur.elapsed}</span>
              <span>{cur.remain}</span>
            </div>
          </div>
        )}
        {cur.isLive && <Live />}

        <Transport cur={cur} size="phone" />

        {/*
         * The room on the left, the running order on the right.
         *
         * This row replaces the strip of room chips. Chips put every room on screen at all times
         * and asked the thumb to aim at 60px words; the room you are in is one press from the
         * sheet that shows all of them properly, and the space buys the queue a way in that the
         * player screen never had.
         */}
        <div className="cx-np-foot">
          <PhoneVolume cur={cur} />
          {!cur.isLive && cur.hasTrack && (
            <button type="button" className="cx-np-queue mono" onClick={onOpenQueue}>
              up next
              {upNextTotal > 0 && <b>{upNextTotal}</b>}
              <ChevronGlyph size={14} className="cx-np-queue-up" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
