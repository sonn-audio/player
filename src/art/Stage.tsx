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
import { artKeyOf } from '@/art/artKey';
import type { RoomDrag } from '@/art/useRoomDrag';
import { Motion } from '@/art/Motion';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { useCoverAnchor } from '@/shell/coverMorph';
import { useFitText } from '@/art/useFitText';
import { useLeaving } from '@/art/Leaving';
import { Mark } from '@/components/Mark';
import {
  ChevronGlyph,
  QueueGlyph,
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
export function Transport({ cur, size }: { cur: Cur; size: 'phone' | 'bar' }) {
  const api = useApi();
  const leader = cur.leader;

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
        <PrevGlyph size={23} />
      </button>
      <button type="button" className="cx-tr-play" aria-label={cur.isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
        {cur.isPlaying ? <PauseGlyph size={20} /> : <PlayGlyph size={21} />}
      </button>
      <button type="button" className="cx-tr-skip" aria-label="Next" onClick={() => leader && void api.next(leader.id)}>
        <NextGlyph size={23} />
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
      {/*
       * Keyed on the record, so a new one starts at nought instead of winding back to it.
       *
       * The fill glides between the server's once-a-second ticks, which is right for a line that is
       * filling and exactly wrong at the moment it empties: 95% to 0% over the same 0.92s is a
       * rewind, drawn every single time a track ends. A remount has no previous width to travel
       * from.
       */}
      <span className="cx-bar-rail" key={`${cur.title}|${cur.durationSec}`}>
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
/**
 * What is on the line, as a lamp and a figure, and the door to the reading.
 *
 * The lamp is always there and is lit for one thing only: a signal that reached the room untouched.
 * Anything else is a grey dot and the figure — a fact, not a warning.
 */
function Wire({ cur, onSignal }: { cur: Cur; onSignal: () => void }) {
  const ok = Boolean(cur.leader?.format?.bitPerfect);
  return (
    <button type="button" className="cx-wire mono" data-ok={ok || undefined} onClick={onSignal} title="What is happening to the audio">
      <i className="cx-wire-lamp" aria-hidden="true" />
      {ok && 'Bit-perfect'}
      <b>{wireLabel(cur)}</b>
      <ForwardGlyph size={11} />
    </button>
  );
}

function Favourite({ cur }: { cur: Cur }) {
  const { available, saved, toggle } = useZoneFavorite(cur.leader);

  if (!available) {
    return null;
  }
  return (
    <button
      type="button"
      className="cx-fav"
      data-on={saved ? '' : undefined}
      aria-label={saved ? 'Remove from favourites' : 'Add to favourites'}
      onClick={toggle}
    >
      <HeartGlyph size={17} filled={Boolean(saved)} />
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
    <button type="button" className={`${className} cx-origin`} onClick={() => onOpen(item)} title={title}>
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
  elsewhere,
  origin,
  onOpenOrigin,
  spread = true,
  upNextRows = 3,
  live,
  lately,
}: {
  cur: Cur;
  /** The room gestures — the sleeve is the thing you pick up. See `useRoomDrag`. */
  drag: RoomDrag;
  /**
   * Whether a wide window draws the record as a two-page spread — the sleeve the whole left page, the
   * words the right. True on a bare window; false inside the app's frame, where the pane is a sheet
   * with a sidebar beside it and a full-bleed sleeve would be a page torn out of the frame. See `app.css`.
   */
  spread?: boolean;
  /** How many of what is next to list under the record. Three on a bare window; the frame gives the column more. */
  upNextRows?: number;
  /**
   * What this room played lately, for a record with nothing after it: the column keeps a shelf rather
   * than a line saying there is none. Same rows as the running order, so the eye reads one list.
   */
  lately?: { key: string; title: string; artist: string; cover: string | undefined; play: () => void }[] | undefined;
  /**
   * What a station has instead of a running order: the radio service's own shelves, and the stations this
   * room keeps. Drawn in the foot where the queue would be. See `ArtApp` for where it comes from.
   */
  live?:
    | {
        doors: ContentItem[];
        kept: { key: string; name: string; play: () => void }[];
        onOpen: (item: ContentItem) => void;
      }
    | undefined;
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
  /** The album and the artist this record belongs to, once the catalogue has answered. See `useOrigin`. */
  origin?: { album: ContentItem | null; artist: ContentItem | null } | undefined;
  onOpenOrigin?: ((item: ContentItem) => void) | undefined;
}) {
  const api = useApi();
  const leader = cur.leader;
  const coverAnchor = useCoverAnchor();
  /* What "the artwork changed" means — the same handle the page's wash dissolves on. */
  const artKey = artKeyOf(leader?.track);

  /* The name is a nameplate, not a poster: three sizes by its length, so a long title steps down
     rather than filling the column. `Nothing playing` is a state, not a title, and is set smaller. */
  const letters = mainTitle(cur.title).length;
  const plate = !cur.hasTrack ? 56 : letters > 30 ? 44 : letters > 16 ? 56 : 72;
  /* At rest the name is read from across the room, so the same three sizes stand a third larger. */
  const fit = { ref: undefined, size: resting || spread ? Math.round(plate * 1.34) : plate };

  /*
   * A track change is a dissolve, so each line keeps the one it is replacing.
   *
   * Four lines, four identities, each changing on its own: two tracks by the same artist do not
   * redraw the artist, and a record whose name carries no edition leaves that line alone. What
   * dissolves is what actually changed, which is the difference between a page turning and a page
   * flickering. See `useLeaving`.
   */
  const titleId = `${cur.title}|${cur.artist}`;
  const tagsText = splitTitle(cur.title).tags.join(' · ');
  const albumText = albumWorthShowing(cur.title, cur.album) ? bareAlbum(cur.album) : '';
  const gone = {
    artist: useLeaving(cur.artist, cur.artist),
    title: useLeaving(titleId, { text: mainTitle(cur.title), size: fit.size }),
    tags: useLeaving(tagsText, tagsText),
    album: useLeaving(albumText, albumText),
  };

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

  return (
    <div
      className="cx-stage"
      data-spread={(cur.hasTrack && spread) || undefined}
      onClick={leave}
    >
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
            /* The light dissolves too, and slower than the sleeve that throws it: 1.9s is the same
               beat the page's wash keeps, so the room settles into the new record after it has
               arrived rather than with it. One picture feeds both halos — at 52px and 130px of blur
               the difference between a 160px copy and a 320px one is not a difference. */
            <Crossfade
              artKey={artKey}
              cover={zoneCoverCss(api, leader, 320)}
              ms={1900}
              render={(slot) => (
                <>
                  <span className="cx-bloom-far" style={{ backgroundImage: slot.cover }} aria-hidden="true" />
                  <span className="cx-bloom" style={{ backgroundImage: slot.cover }} aria-hidden="true" />
                </>
              )}
            />
          )}

          {cur.hasTrack ? (
            <>
              {/*
               * The record, at rest: a disc behind the sleeve, turning while the room plays.
               *
               * Only here. On every other screen the sleeve stands alone — a turning disc beside every
               * list would be furniture — and the rest is the one place that is about looking at a
               * record rather than doing something with it. The label is the sleeve's own artwork, the
               * grooves are a gradient, and the light on the vinyl stays still while the disc turns under
               * it (see `.cx-disc` in `app.css`). 1.8 s a turn is 33⅓ rpm.
               */}
              {resting && (
                <span className="cx-disc" data-playing={cur.isPlaying || undefined} aria-hidden="true">
                  <span className="cx-disc-platter">
                    <span className="cx-disc-label" style={{ backgroundImage: zoneCoverCss(api, leader, 240) }} />
                  </span>
                  <span className="cx-disc-shine" />
                </span>
              )}
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
          ) : lately && lately.length > 0 ? (
            /*
             * A silent room with a past offers it back.
             *
             * It showed the last record in the dark — grayscale, a fifth of the brightness, `nothing
             * playing` engraved over it — which was honest and useless: a picture you could not press.
             * The same sleeve, lit, with the one word that makes it an offer, is the most useful thing
             * a quiet room can show, and the first thing most people do in one.
             */
            <button
              type="button"
              className="cx-cover cx-cover-last"
              style={lately[0]!.cover ? { backgroundImage: lately[0]!.cover } : undefined}
              onClick={lately[0]!.play}
              title={`Play ${lately[0]!.title} again`}
            >
              <span className="cx-cover-last-scrim" aria-hidden="true" />
              <span className="cx-cover-last-txt">
                <span className="mono cx-cover-last-lbl">last here</span>
                <span className="cx-cover-last-title">{lately[0]!.title}</span>
                {lately[0]!.artist && <span className="cx-cover-last-artist">{lately[0]!.artist}</span>}
              </span>
              <span className="cx-cover-last-go mono">
                <PlayGlyph size={11} />
                play again
              </span>
            </button>
          ) : (
            /* A room that has never played anything: the mark, faint, in a frame. Not a dashed one —
               dashes mean "drop something here". */
            <div className="cx-cover cx-cover-empty">
              <Mark className="cx-cover-empty-mark" />
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
<Wire cur={cur} onSignal={onSignal} />
            )}
          </span>

          {/*
           * A track change is a moment, so the words arrive like one.
           *
           * Each line keeps the line it replaces for a beat and hands over to it — the copy that is
           * leaving lifts and blurs away, the new one rises into its place, a beat later for each
           * step down the column. See `useLeaving` and `.cx-in` / `.cx-out`. Lines are identified by
           * what they say rather than by the zone object, which is replaced every second: a dissolve
           * per progress tick would turn a gesture into a twitch.
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
          <div className="cx-artistrow">
            {gone.artist && (
              <span className="cx-artist cx-out" key={gone.artist.id} aria-hidden="true">
                {gone.artist.value}
              </span>
            )}
            {cur.artist && (
              <Origin
                className="cx-artist cx-in"
                key={cur.artist}
                text={cur.artist}
                item={origin?.artist}
                onOpen={onOpenOrigin}
                title={`Everything by ${cur.artist}`}
              />
            )}
            {/* The heart is not part of the record, it is a control that happens to sit beside one, so
                it stands still while the name behind it changes. */}
            {cur.hasTrack && <Favourite cur={cur} />}
          </div>

          {/*
           * The name, measured into a box of a height that never changes — see `useFitText`. The old
           * ladder sized it by character count, which is a guess about width, and a title that wrapped
           * to a third line pushed the timeline, the transport and the house down the page with it.
           *
           * The name that is leaving keeps the size that was measured for *it* — `useLeaving` hands
           * back the value that was on screen, and at the moment of the change that is still the old
           * measurement, because the new one has not been taken yet.
           */}
          <div className="cx-titlebox">
            {gone.title && (
              <h1
                className="disp cx-title cx-out"
                key={gone.title.id}
                style={gone.title.value.size ? { fontSize: `${gone.title.value.size}px` } : undefined}
                aria-hidden="true"
              >
                {gone.title.value.text}
              </h1>
            )}
            <h1
              className="disp cx-title cx-in cx-in-2"
              key={titleId}
              ref={fit.ref}
              style={fit.size ? { fontSize: `${fit.size}px` } : undefined}
            >
              {mainTitle(cur.title)}
            </h1>
          </div>
          {/*
           * The edition and the album, always drawn, empty or not.
           *
           * They are the two lines that come and go from one track to the next — one has `(Live)` after
           * its name, the next does not — and the page below them was moving by their height every few
           * minutes. Their rows are kept whether or not they have anything to say; empty type on black
           * is nothing to look at, and the timeline, the transport and the house stand still.
           */}
          <span className="cx-title-tags mono">
            {gone.tags && (
              <i className="cx-line cx-out" key={gone.tags.id} aria-hidden="true">
                {gone.tags.value}
              </i>
            )}
            <i className="cx-line cx-in cx-in-3" key={tagsText}>
              {tagsText}
            </i>
          </span>

          {/* The album, under the artist rather than folded into it with a dash: it is a place the
              track came from, not part of its name. */}
          <span className="cx-albumrow">
            {gone.album && (
              <span className="cx-album cx-out" key={gone.album.id} aria-hidden="true">
                {gone.album.value}
              </span>
            )}
            {albumText && (
              <Origin
                className="cx-album cx-in cx-in-3"
                key={albumText}
                text={albumText}
                item={origin?.album}
                onOpen={onOpenOrigin}
                title={`Open ${albumText}`}
              />
            )}
          </span>

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

          {/*
           * No transport, timeline or fader here: on a desk those are the player bar's, one set of controls
           * under every view (see `art/Shell`). The column keeps what is this room's alone — the record's
           * words and its running order.
           */}
          <div className="cx-stage-foot">
            {cur.hasTrack && !cur.isLive && (upNext.length > 0 || !lately?.length) && (
              <div className="cx-upnext">
                <button type="button" className="cx-upnext-lbl mono" onClick={onOpenQueue}>
                  up next{upNextTotal > 0 ? ` · ${upNextTotal}` : ''}
                </button>
                {/* Rows, each a record: sleeve, name, who, how long. The label opens the whole queue. */}
                <ol className="cx-upnext-list">
                  {upNext.slice(0, upNextRows).map((entry) => (
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
            {/* Nothing after this one, but a room with a past: what it played lately, as the same rows.
                A quiet room lists them too — the first stands as the sleeve, the rest under the words. */}
            {(cur.hasTrack ? !cur.isLive && upNext.length === 0 : true) && lately && lately.length > (cur.hasTrack ? 0 : 1) && (
              <div className="cx-upnext">
                <span className="cx-upnext-lbl mono">lately in this room</span>
                <ol className="cx-upnext-list">
                  {lately.slice(cur.hasTrack ? 0 : 1, (cur.hasTrack ? 0 : 1) + upNextRows).map((entry) => (
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
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {/* A station has no running order; it has the dial. The radio service's shelves, and the
                stations this room keeps, stand where the queue would. */}
            {cur.hasTrack && cur.isLive && live && (live.doors.length > 0 || live.kept.length > 0) && (
              <div className="cx-onradio">
                {live.doors.length > 0 && (
                  <>
                    <span className="cx-upnext-lbl mono">on radio</span>
                    <div className="cx-onradio-doors">
                      {live.doors.map((door) => (
                        <button type="button" className="cx-onradio-door" key={door.id} onClick={() => live.onOpen(door)}>
                          <span className="cx-onradio-name">{door.name}</span>
                          <ForwardGlyph size={11} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {live.kept.length > 0 && (
                  <>
                    <span className="cx-upnext-lbl mono">kept stations</span>
                    <div className="cx-onradio-kept">
                      {live.kept.map((station) => (
                        <button type="button" className="cx-onradio-chip" key={station.key} onClick={station.play}>
                          {station.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
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
  /* The same measured fit the desk uses, in a box two lines tall: a long name is set smaller rather
     than cut off at an ellipsis, and the transport below it does not move from track to track. */
  const fit = useFitText(mainTitle(cur.title), { max: 38, min: 17 });

  /* The label that is leaving, kept whole — see the head below and `useLeaving`. */
  const npId = `${currentLeaderId ?? 'none'}:${cur.title}`;
  const npTags = splitTitle(cur.title).tags.join(' · ');
  const npAlbum = albumWorthShowing(cur.title, cur.album) ? bareAlbum(cur.album) : '';
  const npGone = useLeaving(npId, {
    title: mainTitle(cur.title),
    size: fit.size,
    tags: npTags,
    artist: cur.artist,
    album: npAlbum,
  });

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
    <div className="cx-np" data-quiet={!cur.hasTrack || undefined}>
      {/* The head: the way back down, which room this is, and what follows. */}
      <div className="cx-np-top">
        {onDismiss && (
          <button type="button" className="cx-np-close" onClick={onDismiss} aria-label="Close the player">
            <ChevronGlyph size={22} />
          </button>
        )}
        <button type="button" className="cx-np-room mono" onClick={onOpenRooms}>
          {cur.name || 'rooms'}
          {cur.grouped && <i>+{cur.groupExtra}</i>}
        </button>
        {!cur.isLive && cur.hasTrack && (
          <button type="button" className="cx-np-queue mono" onClick={onOpenQueue} aria-label="Up next">
            {upNextTotal > 0 && <b>{upNextTotal}</b>}
            <QueueGlyph size={18} />
          </button>
        )}
      </div>

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
              translate: dx ? `${dx}px 0` : undefined,
              scale: dragging ? 0.985 : undefined,
            }}
            data-dragging={dragging || undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={settle}
          >
            {/* The sleeve was an inline `background-image` on the box itself, which cannot animate —
                so every track change cut, on the one screen that is almost entirely artwork. Same
                two slots the desk's sleeve has had all along. */}
            <Crossfade
              artKey={artKey}
              cover={zoneCoverCss(api, leader)}
              ms={900}
              render={(slot) => <span className="cx-np-cover-art" style={{ backgroundImage: slot.cover }} />}
            />
            <Motion src={cur.motion} />
            {!cur.isPlaying && (
              <span className="cx-doek-play" aria-hidden="true">
                <PlayGlyph size={20} />
              </span>
            )}
          </div>
        ) : (
          <div className="cx-np-cover cx-np-cover-empty">
            <Mark className="cx-cover-empty-mark" />
          </div>
        )}
      </div>

      <div className="cx-np-meta">
        {/*
         * The label, as one object that is replaced rather than four lines that blink.
         *
         * The whole block dissolves here, not line by line as on the desk: a phone's lines sit
         * directly under one another and the edition and the album come and go, so a per-line
         * dissolve would leave a frozen copy hanging beside lines that had already moved up. The
         * copy that is leaving is a still of the whole label, at the size and the spacing it had.
         */}
        <div className="cx-np-head">
          <span className="cx-np-titles">
            {npGone && (
              <span className="cx-np-ghost cx-out" key={npGone.id} aria-hidden="true">
                <span className="cx-np-titlebox">
                  <span
                    className="disp cx-np-title"
                    style={npGone.value.size ? { fontSize: `${npGone.value.size}px` } : undefined}
                  >
                    {npGone.value.title}
                  </span>
                </span>
                {npGone.value.tags && <span className="cx-np-tags mono">{npGone.value.tags}</span>}
                {npGone.value.artist && <span className="cx-np-artist">{npGone.value.artist}</span>}
                {npGone.value.album && <span className="cx-np-album">{npGone.value.album}</span>}
              </span>
            )}
            <span className="cx-np-titlebox cx-in" key={`t:${npId}`}>
              <span className="disp cx-np-title" ref={fit.ref} style={fit.size ? { fontSize: `${fit.size}px` } : undefined}>
                {mainTitle(cur.title)}
              </span>
            </span>
            {npTags && (
              <span className="cx-np-tags mono cx-in cx-in-2" key={`v:${npId}`}>
                {npTags}
              </span>
            )}
            {cur.artist && (
              <Origin
                className="cx-np-artist cx-in cx-in-2"
                key={`a:${npId}`}
                text={cur.artist}
                item={origin?.artist}
                onOpen={onOpenOrigin}
                title={`Everything by ${cur.artist}`}
              />
            )}
            {npAlbum && (
              <Origin
                className="cx-np-album cx-in cx-in-3"
                key={`b:${npId}`}
                text={npAlbum}
                item={origin?.album}
                onOpen={onOpenOrigin}
                title={`Open ${npAlbum}`}
              />
            )}
          </span>
        </div>

        {/* What is on the line, and the heart: one quiet row between the label and the clock. */}
        {cur.hasTrack && (
          <div className="cx-np-line">
            <Wire cur={cur} onSignal={onSignal} />
            <Favourite cur={cur} />
          </div>
        )}

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
          <div className="cx-np-prog mono">
            <span>{cur.elapsed}</span>
            <Timeline cur={cur} bare />
            <span>{cur.remain}</span>
          </div>
        )}
        {cur.isLive && <Live />}

        <Transport cur={cur} size="phone" />

        <PhoneVolume cur={cur} />
      </div>
    </div>
  );
}
