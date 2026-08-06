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
import { Motion } from '@/art/Motion';
import { useZoneFavorite } from '@/state/useZoneFavorite';
import { useCoverAnchor } from '@/shell/coverMorph';
import {
  ChevronGlyph,
  EmptyArtGlyph,
  HeartGlyph,
  NextGlyph,
  PauseGlyph,
  PlayGlyph,
  PrevGlyph,
  RepeatGlyph,
  ShuffleGlyph,
  SpeakerGlyph,
} from '@/art/glyphs';
import type { Channel, Cur } from '@/art/useCur';

/** Greeting by hour — the welcome screen's line, reused as the stage's eyebrow. */
export function greeting(hour = new Date().getHours()): string {
  if (hour < 6) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Transport, one row, shared by both layouts so the two can never disagree about behaviour. */
function Transport({ cur, size }: { cur: Cur; size: 'desk' | 'phone' }) {
  const api = useApi();
  const leader = cur.leader;
  const phone = size === 'phone';

  const toggle = (): void => {
    if (!leader) {
      return;
    }
    void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id));
  };

  return (
    <div className="cx-transport" data-size={size}>
      {/*
       * Shuffle and repeat are a desk's affordances.
       *
       * On a phone they are two of five equal-looking targets around the one button anyone is reaching for,
       * and they are *modes* — set once a month, glanced at never. Three buttons under a full-bleed sleeve
       * is a player; five is a remote control. Both still live one tap away in the queue sheet's own header
       * on that screen.
       */}
      {!phone && (
        <button
          type="button"
          className="cx-tr-side"
          data-on={cur.shuffle || undefined}
          aria-label="Shuffle"
          onClick={() => leader && void api.setShuffle(leader.id, !cur.shuffle)}
        >
          <ShuffleGlyph size={19} />
        </button>
      )}
      <button type="button" className="cx-tr-skip" aria-label="Previous" onClick={() => leader && void api.previous(leader.id)}>
        <PrevGlyph size={phone ? 23 : 25} />
      </button>
      <button type="button" className="cx-tr-play" aria-label={cur.isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
        {cur.isPlaying ? <PauseGlyph size={phone ? 20 : 22} /> : <PlayGlyph size={phone ? 21 : 23} />}
      </button>
      <button type="button" className="cx-tr-skip" aria-label="Next" onClick={() => leader && void api.next(leader.id)}>
        <NextGlyph size={phone ? 23 : 25} />
      </button>
      {!phone && (
        <button
          type="button"
          className="cx-tr-side"
          data-on={cur.repeat || undefined}
          aria-label="Repeat"
          onClick={() => leader && void api.setRepeat(leader.id, cur.repeat ? 'off' : 'all')}
        >
          <RepeatGlyph size={19} />
        </button>
      )}
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
function Timeline({ cur, bare = false }: { cur: Cur; bare?: boolean }) {
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
function Times({ cur }: { cur: Cur }) {
  return (
    <div className="cx-times mono">
      <span className="cx-time-el">{cur.elapsed}</span>
      <span>{cur.remain}</span>
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

/**
 * What is coming, as one line.
 *
 * This is all that is left of the queue on this screen, and it replaces a 240px column that held the
 * whole of it at 62% opacity, permanently, beside a 90px title. One line answers the question anyone
 * actually has of a queue while listening — *what is after this* — and pressing it opens the rest. The
 * column answered a question nobody was asking and charged the artwork a fifth of the window for it.
 */
function NextUp({
  next,
  total,
  reserve,
  onOpen,
}: {
  next: { title: string; artist: string } | null;
  /** How many entries the queue holds, so the last track still has a way into it. */
  total: number;
  /**
   * Hold the line's height even with nothing to say.
   *
   * The queue arrives a couple of hundred milliseconds after this screen does, so without a reserved
   * slot the whole composition re-centres the moment it lands — the sleeve visibly settles every time
   * you open the player. True whenever the source *could* have a queue, which is known on the first
   * frame (`!isLive`), so the reservation never appears or disappears later.
   */
  reserve: boolean;
  onOpen: () => void;
}) {
  /*
   * Named when there is a next track, counted when there is not.
   *
   * Without the second case the queue becomes unreachable on the last track of an album — which is
   * exactly when someone wants to look at it and add something.
   */
  const empty = !next && total < 2;
  if (empty && !reserve) {
    return null;
  }
  return (
    <button
      type="button"
      className="cx-next"
      data-empty={empty || undefined}
      aria-hidden={empty}
      tabIndex={empty ? -1 : undefined}
      onClick={onOpen}
    >
      <span className="cx-next-lbl mono">{next ? 'next' : 'queue'}</span>
      <span className="cx-next-txt">
        {next ? (
          <>
            {next.title}
            {next.artist ? <i className="cx-next-artist"> {next.artist}</i> : null}
          </>
        ) : (
          <i className="cx-next-artist">{total} tracks · nothing after this one</i>
        )}
      </span>
    </button>
  );
}

/** A room's volume, as a horizontal fader with a readout that appears while dragging. */
function VolumeRow({ cur, className }: { cur: Cur; className: string }) {
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
      <SpeakerGlyph size={17} waves />
    </span>
  );
}

// --- desktop ----------------------------------------------------------------

export function Stage({
  cur,
  onOpenRooms,
  onOpenQueue,
  onBrowse,
  nextUp,
  queueCount,
}: {
  cur: Cur;
  onOpenRooms: () => void;
  onOpenQueue: () => void;
  onBrowse: () => void;
  /** The following queue entry, or null when there is nothing after this. */
  nextUp: { title: string; artist: string } | null;
  /** How many entries the queue holds. */
  queueCount: number;
}) {
  const api = useApi();
  const leader = cur.leader;
  const coverAnchor = useCoverAnchor();

  const toggle = (): void => {
    if (!leader || !cur.hasTrack) {
      return;
    }
    void (cur.isPlaying ? api.pause(leader.id) : api.play(leader.id));
  };

  return (
    <div className="cx-stage">
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
            <button
              type="button"
              className="cx-cover"
              style={{ backgroundImage: zoneCoverCss(api, leader) }}
              data-paused={!cur.isPlaying || undefined}
              aria-label={cur.isPlaying ? 'Pause' : 'Play'}
              onClick={toggle}
              {...coverAnchor}
            >
              {/* The sleeve, if this record has one that moves. A still underneath, always. */}
              <Motion src={cur.motion} />
              <span className="cx-cover-hover">
                <span className="cx-cover-glyph">
                  {cur.isPlaying ? <PauseGlyph size={19} /> : <PlayGlyph size={20} />}
                </span>
              </span>
            </button>
          ) : (
            <div className="cx-cover cx-cover-empty">
              <EmptyArtGlyph size={52} />
              <span className="mono cx-cover-empty-txt">nothing playing</span>
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
          <h1 className="disp cx-title cx-swap" key={`t:${cur.title}|${cur.artist}`}>
            {cur.title}
          </h1>

          <div className="cx-artistrow cx-swap cx-swap-2" key={`a:${cur.title}|${cur.artist}`}>
            {cur.artist && <span className="cx-artist">{cur.artist}</span>}
            {cur.hasTrack && <Favourite cur={cur} />}
          </div>

          {/* The album, under the artist rather than folded into it with a dash: it is a place the
              track came from, not part of its name. */}
          {cur.album && cur.album !== cur.title && (
            <span className="cx-album cx-swap cx-swap-3" key={`b:${cur.title}|${cur.album}`}>
              {cur.album}
            </span>
          )}

          {/* Why the last attempt failed. `play` answers before anything is resolved, so this is the
              only place a failure can appear — and it belongs beside the title it failed to become. */}
          {cur.error && <p className="cx-error">{cur.error}</p>}

          {!cur.hasTrack && (
            <span className="cx-cta">
              <button type="button" className="mono" onClick={onBrowse}>
                browse music
              </button>
              <button type="button" className="mono" onClick={onOpenRooms}>
                rooms
              </button>
            </span>
          )}

          {cur.isLive && <Live />}
          {cur.showBar && <Timeline cur={cur} />}

          <Transport cur={cur} size="desk" />

          {/*
           * Master, and the door to the house.
           *
           * `ROOMS +2` was here, then moved out when the top bar grew a room button, and is back now that
           * the corner has become the switch to the other face. It is the only way to grouping on this
           * screen and it belongs beside the level it is about to become the master of — the dock along
           * the bottom selects rooms, but joining them is a decision, not a selection.
           */}
          <div className="cx-volrow">
            <VolumeRow cur={cur} className="cx-vol" />
            <span className="cx-volrow-div" />
            <button
              type="button"
              className="mono cx-rooms-btn"
              onClick={onOpenRooms}
              data-on={cur.grouped || undefined}
            >
              rooms{cur.grouped ? ` +${cur.groupExtra}` : ''}
            </button>
          </div>

          <NextUp next={nextUp} total={queueCount} reserve={!cur.isLive && cur.hasTrack} onOpen={onOpenQueue} />
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
  channels,
  currentLeaderId,
  onOpenRooms,
  onOpenQueue,
  onBrowse,
  onPickChannel,
}: {
  cur: Cur;
  artKey: string;
  channels: Channel[];
  currentLeaderId: number | null;
  onOpenRooms: () => void;
  /** Raised by swiping up on the canvas — what is *behind* this track, pulled up from under it. */
  onOpenQueue: () => void;
  onBrowse: () => void;
  onPickChannel: (leaderId: number) => void;
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

      {/*
       * The room name, floating over the artwork.
       *
       * There is no header bar on this screen while something is playing — a 54px strip with a logo in it
       * is 54px the sleeve could have had, and the one thing it carried that matters is which room this is.
       * So the name sits on the artwork itself, centred, with a shadow under it so it reads over a light
       * sleeve as well as a dark one.
       */}
      <button type="button" className="cx-mroom mono" onClick={onOpenRooms}>
        {cur.name || 'rooms'}
        {cur.grouped && <i className="cx-mroom-plus">+{cur.groupExtra}</i>}
        <ChevronGlyph size={12} />
      </button>

      {cur.hasTrack ? (
        /*
         * The sleeve as a hung canvas.
         *
         * Full width, edge to edge, and *not* square — `min(100vw, 48vh)`, so on a tall phone it is a band
         * rather than a block and there is room under it for the player. It was an inset card with rounded
         * corners and a shadow, which made the artwork a *component on* the screen; full-bleed with its
         * bottom third melting into black makes the screen the artwork's.
         */
        <div className="cx-doek">
          <span
            className="cx-doek-art"
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
          </span>

          {/* Two gradients doing two jobs: the top one buys contrast for the room name, the bottom one is
              how the canvas stops — it fades to the page's own black rather than ending on an edge. */}
          <span className="cx-doek-top" aria-hidden="true" />
          <span className="cx-doek-fade" aria-hidden="true" />

          {/* Only when paused. A play button over a playing sleeve is a button that lies. */}
          {!cur.isPlaying && (
            <span className="cx-doek-play" aria-hidden="true">
              <PlayGlyph size={20} />
            </span>
          )}

          {/* Riding the canvas's bottom edge, half on and half off it. */}
          {cur.showBar && <Timeline cur={cur} bare />}
        </div>
      ) : (
        <div className="cx-doek cx-doek-empty">
          <EmptyArtGlyph size={42} />
          <span className="mono cx-cover-empty-txt">nothing playing</span>
        </div>
      )}

      <div className="cx-mstage-controls">
        {cur.showBar && <Times cur={cur} />}
        {cur.isLive && <Live />}

        {/* Keyed on the room *and* the track, so the block crossfades when you switch channels — feedback
            for a tap that otherwise changes nothing visible — and again when the record moves on, which is
            the same moment the desktop stage marks with its rise. */}
        <div className="cx-mstage-meta" key={`${currentLeaderId ?? 'none'}:${cur.title}`}>
          <div className="cx-mstage-titles">
            <span className="disp cx-mtitle">{cur.title}</span>
            {cur.artist && <span className="cx-martist">{cur.artist}</span>}
          </div>
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

        <Transport cur={cur} size="phone" />

        {cur.zone && <VolumeRow cur={cur} className="cx-mvol" />}

        {/* The room switcher: one quiet row, a breathing dot on the rooms that are playing. */}
        {channels.length > 1 && (
          <div className="cx-chips">
            {channels.map((channel) => (
              <button
                type="button"
                key={channel.leader.id}
                className="mono cx-chip"
                data-current={channel.leader.id === currentLeaderId || undefined}
                onClick={() => onPickChannel(channel.leader.id)}
              >
                {channel.short}
                {channel.playing && channel.hasTrack && <span className="cx-chip-dot" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
