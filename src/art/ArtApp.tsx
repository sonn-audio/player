/**
 * The art player: the same rooms, the same API, the technology out of sight.
 *
 * This is the second face of one bundle (see `shell/useFace`), and it shares everything below the
 * presentation with the technical one — the client, the event stream, the zone store, the selected
 * room. What differs is what it is *for*: the artwork is the subject, the controls are quiet, and no
 * codec, sample rate or signal path appears anywhere. When you want to know what the audio is doing,
 * you switch face; that is the point of there being two.
 *
 * The shell is deliberately not responsive-by-CSS-alone. Desktop and phone get different component
 * trees (`Stage` vs `MobileStage`, a rail and a fader strip vs sheets and a bottom nav) because they
 * are different products: one has a pointer, a lot of width and every room on screen at once; the
 * other has a thumb, one column, and a player that must never scroll. A single tree bent by media
 * queries serves whichever one it was written for first.
 *
 * Everything modal is a sheet — bottom-anchored on a phone, centred on a desk, one component either
 * way. Grouping, the queue and the settings are decisions about the house rather than places in it,
 * so they overlay what you were doing instead of replacing it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import { useSelectedZone } from '@/state/useSelectedZone';
import { useLocalPlayback } from '@/state/useLocalPlayback';
import { useMediaSession } from '@/state/useMediaSession';
import { useScenes } from '@/state/useScenes';
import { useWakeLock } from '@/state/useWakeLock';
import { Brand } from '@/shell/Brand';
import { InstallHint } from '@/shell/InstallHint';
import { Mark } from '@/components/Mark';
import { Stage, MobileStage, greeting } from '@/art/Stage';
import { Signal } from '@/art/Signal';
import { RoomsSheet } from '@/art/Channels';
import { Wall } from '@/art/Wall';
import { useRoomDrag } from '@/art/useRoomDrag';
import { useEdges, useEscape } from '@/art/useEdges';
import { QueueSheet } from '@/art/Rail';
import { Crossfade } from '@/art/Crossfade';
import { Browse, MiniBar, Sources, type BrowseNode } from '@/art/Browse';
import { channelsOf, leaderOf, useCur, type Channel } from '@/art/useCur';
import { useFavorites, useQueue, useRecents } from '@/art/useCollections';
import { accentOf, artKeyOf } from '@/art/accent';
import { useClock, useIdle } from '@/art/useIdle';
import { captureCover } from '@/shell/coverMorph';
import { zoneCoverCss, itemCoverCss } from '@/art/cover';
import {
  ChevronGlyph,
  ForwardGlyph,
  GridGlyph,
  HomeGlyph,
  MoreGlyph,
  RoomsGlyph,
} from '@/art/glyphs';
import type { ContentService } from '@/api/content';

/** Where the desktop tree ends and the phone tree begins. Matches `art.css`. */
const PHONE_MAX = 979;

/**
 * How long the room has to be left alone before the screen becomes the record.
 *
 * A minute. Long enough that it never fires while someone is deciding what to play, short enough that
 * the panel on the wall spends its day in the state that was designed for it rather than in the state
 * that was designed for being used.
 */
const IDLE_AFTER_MS = 60_000;

function useIsPhone(): boolean {
  const query = `(max-width: ${PHONE_MAX}px)`;
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setPhone(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return phone;
}

/**
 * What the middle of the screen is showing.
 *
 * `signal` is the technical side of the product, and it is a view here rather than a second app
 * because that is all it ever was: one room's chain, meters and clock, which needs a room with
 * something playing in it and no shell of its own. See `art/Signal`.
 */
type View =
  | { kind: 'home' }
  | { kind: 'browse'; node: BrowseNode }
  | { kind: 'inputs' }
  | { kind: 'signal' };

type Sheet = null | 'rooms' | 'queue' | 'more';

export function ArtApp() {
  const api = useApi();
  const { zones: serverZones, status, synced, content } = useServer();
  const local = useLocalPlayback();

  /*
   * This device takes its place among the rooms — here too, not only in the technical face.
   *
   * The art face is the phone's face, and a phone player that can only *point at* other rooms is
   * a remote control. With the local destination merged in ("This phone", first in the list), the
   * rooms sheet offers the device in your hand alongside the kitchen, and picking it makes this a
   * music player in its own right — same components, same transport, audio out of this speaker.
   * The technical face has always done this; the phone face needing it more was an oversight.
   */
  const zones = useMemo(
    () => (local.zone ? [local.zone, ...serverZones] : serverZones),
    [local.zone, serverZones],
  );
  const { zone, zoneId, select } = useSelectedZone(zones, synced);
  const phone = useIsPhone();

  const [view, setView] = useState<View>({ kind: 'home' });
  /*
   * The phone's player, as a place you go rather than the place you start.
   *
   * Home used to *be* the player: opening the app put you in front of one record with the catalogue
   * a tab away. That is the right shape for a wall panel and the wrong one for a phone, where the
   * first question is almost always "what shall I put on" and only sometimes "what is on". So the
   * phone follows the shape every music app has settled on for good reasons — a home you browse, a
   * bar along the bottom that says what is playing, and the full player one press up from it.
   *
   * A layer over the app rather than a fourth view, because that is what it is: dismissing it puts
   * you back exactly where you were, mid-scroll in whatever you were reading.
   */
  const [playerOpen, setPlayerOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [services, setServices] = useState<ContentService[]>([]);

  const cur = useCur(zone, zones);
  const channels = useMemo(() => channelsOf(zones), [zones]);
  const leader = cur.leader;
  const { queue } = useQueue(leader?.id ?? null);
  const recents = useRecents(zone?.id ?? null);
  const favorites = useFavorites(zone?.id ?? null);
  const { scenes, recall } = useScenes();

  // The lock screen and the media keys follow the room this face controls — the leader,
  // which is where `useCur` already says playback lives.
  useMediaSession(leader);

  /*
   * A playing room keeps the screen on.
   *
   * The idle state below turns this face into a picture of the record, which is what a wall
   * panel is for — and the OS, seeing only an inputless minute, would blank it. Held while
   * audio flows and released when the house goes quiet, so a silent panel still sleeps.
   */
  useWakeLock(cur.isPlaying);

  /*
   * One drop of the record's colour, and the handle that says when the artwork changed.
   *
   * The accent lands on `.cx-root` as three custom properties and everything downstream reads it from
   * there — the play ring, the timeline, the live mark, the glow under the sleeve. Derived once here so
   * the wash's dissolve and the accent's glide are keyed off the same moment.
   */
  const accent = useMemo(() => accentOf(leader?.track), [leader?.track]);
  const artKey = artKeyOf(leader?.track);

  /*
   * Left alone, this becomes a picture of a record.
   *
   * Only while something is playing, and only on `home` — dimming the chrome away from a listing leaves
   * a wall of covers with no way to scroll them, and dimming a quiet house hides the only useful thing
   * on the screen. See `.cx-root[data-idle]`.
   */
  /*
   * The same picture, asked for.
   *
   * The resting state is the best thing this face does and the only way in was to *stop touching it for a
   * minute*, which is a strange thing to ask of someone who came to look at a record. So it is a place
   * now: `canvas` in the volume row opens it, and the timeout still arrives on its own for the panel on
   * the wall that nobody is holding.
   *
   * Two ways in, one state — `data-idle` stays the single attribute everything downstream keys off, so
   * there is no second look to keep in step with the first. What differs is only how you leave: the
   * timeout's version lifts the moment a pointer moves, because that is someone arriving at the panel;
   * the asked-for version does not, because a mouse resting on a desk would close a thing you opened on
   * purpose. That one leaves on a key or on a click of the page around the sleeve.
   */
  /*
   * Two things worth looking at when nobody is touching it, and they are not the same thing.
   *
   *  - `record` is the picture: this room's sleeve, hung, with its label under it.
   *  - `house` is the gallery: every room the same width, each showing what is playing in it. This is
   *    the one for a panel in a hallway, where the useful question is not *what is this* but *what is
   *    the house doing* — and it is the wall's own logic taken to its end, since the wall is already
   *    N panels with one of them wide.
   *
   * The timeout still arrives on its own and always chooses the record: a screen that dims itself is
   * answering "what is playing here", because here is where the person stopped touching it.
   */
  const [asked, setAsked] = useState<'record' | 'house' | null>(null);
  const timedOut = useIdle(IDLE_AFTER_MS, !asked && cur.isPlaying && view.kind === 'home' && sheet === null);
  const idle = asked !== null || timedOut;
  const rest = asked ?? (timedOut ? 'record' : null);
  const clock = useClock(idle);

  /* Leaving what was asked for. Any key at all, the way a screensaver has always ended. */
  useEffect(() => {
    if (!asked) {
      return undefined;
    }
    const onKey = (): void => setAsked(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asked]);

  /*
   * And the moment there is nothing to look at, it closes itself rather than resting on an empty page.
   *
   * `hasTrack`, not `isPlaying`. The timeout above is right to insist on playing — dimming a screen
   * nobody asked to dim, in a room that has stopped, hides the one useful thing on it. But a record that
   * is paused is still a picture, and the door said so: `canvas` appears whenever there is a track, so
   * guarding the *state* on playback meant pressing it on a paused room opened and shut the canvas in
   * one frame. Two conditions for one thing is how a control ends up doing nothing.
   */
  useEffect(() => {
    if (asked && !((cur.hasTrack || asked === 'house') && view.kind === 'home' && sheet === null)) {
      setAsked(null);
    }
  }, [asked, cur.hasTrack, view.kind, sheet]);

  /*
   * The queue down the right edge and the house along the bottom, folded.
   *
   * One piece of state for both, because the rules are about the pair — see `useEdges`.
   */
  const edges = useEdges();
  useEscape(edges.open !== null, edges.closeAll);

  // The dim folds both, and a sheet does too: a panel behind a modal is a panel nobody can reach.
  useEffect(() => {
    if (idle || sheet !== null) {
      edges.closeAll();
    }
  }, [idle, sheet, edges]);

  useEffect(() => {
    if (!content.available) {
      return;
    }
    void content
      .services()
      .then(setServices)
      .catch(() => setServices([]));
  }, [content]);

  /*
   * The house is quiet: nothing loaded in any room.
   *
   * Worth its own screen rather than an empty player, because an empty player invites you to press
   * play on nothing. This offers the ways *in* instead — and it is the state a wall panel sits in for
   * most of the day, so it should look composed rather than unfinished.
   */
  const houseQuiet = zones.length > 0 && zones.every((candidate) => !candidate.track);

  /*
   * Does this room have a running order — and therefore a queue, a shuffle and a repeat?
   *
   * `source.seekable` is the first-frame answer and the reason it is first: it arrives with the zone, so
   * the queue rail can be laid out before the queue itself lands and the composition never shifts under
   * a cover that is mid-flight. But it is the *provider's* claim about scrubbing, not about ordering, and
   * at least one of them (Apple Music, on this server) sends `seekable: false` for an ordinary album
   * track — which hid the queue tab, the rail and both playback modes for a room with fourteen tracks
   * lined up behind it.
   *
   * So: believe `seekable` when it says yes, and let the queue itself overrule it when it says no. The
   * stable case stays stable; the case that was simply wrong now answers late instead of never.
   *
   * More than one entry, not more than none: a live station reports its own stream as a single queue
   * item, and that item is *this* — the thing already on the stage. A lane whose whole stack is the
   * track you are looking at showed one coverless tile and a sideways "next" for every radio in the
   * house. One entry is a mirror, not a queue.
   */
  const hasQueue = !cur.isLive || queue.total > 1;

  /**
   * The next few entries as sleeves, for the room's shelf.
   *
   * Four, because the shelf sits under a composition rather than beside it: five starts competing with
   * the record above them, and three is not a shelf. A live source has no running order, so it has no
   * shelf either — which is honest, and is also why this is empty rather than absent.
   */
  const upNext = useMemo(() => {
    if (queue.currentIndex === null || cur.isLive) {
      return [];
    }
    return queue.items.slice(queue.currentIndex + 1, queue.currentIndex + 5).map((item) => ({
      key: item.id,
      title: item.title,
      artist: item.artist,
      cover: itemCoverCss(item.coverUrl),
      play: () => leader && void api.queuePlay(leader.id, item.id),
    }));
  }, [queue, cur.isLive, api, leader]);

  /** The entry after the one playing, for the canvas's one line about the future. */
  const nextUp = useMemo(() => {
    if (queue.currentIndex === null) {
      return null;
    }
    const next = queue.items[queue.currentIndex + 1];
    return next ? { title: next.title, artist: next.artist, cover: itemCoverCss(next.coverUrl) } : null;
  }, [queue]);

  /**
   * Music in another room, for a room with none — see `Stage`'s `elsewhere`. The first channel playing
   * something that is not this one; joining it is the same call the desk's `join` makes.
   */
  const elsewhere = useMemo(() => {
    if (cur.hasTrack || !zone) {
      return undefined;
    }
    const mine = leaderOf(zone, zones)?.id;
    const other = channels.find((channel) => channel.playing && channel.hasTrack && channel.leader.id !== mine);
    if (!other) {
      return undefined;
    }
    return {
      room: other.leader.name,
      title: other.leader.track?.title ?? '',
      join: () =>
        void api.setGroup(other.leader.id, [...other.members.map((member) => member.id), zone.id]).catch(() => undefined),
    };
  }, [cur.hasTrack, zone, zones, channels, api]);

  /** How many entries follow the one playing — the number the shelf's label carries. */
  const upNextTotal =
    queue.currentIndex === null || cur.isLive ? 0 : Math.max(0, queue.total - queue.currentIndex - 1);

  /*
   * The two gestures the wall invites.
   *
   * Drag the sleeve onto another room and the music goes there; drag a room onto the one you are in and
   * they play together. Both were already in the contract and both were a list with checkboxes.
   *
   * The wall follows the music after a handoff. Someone who threw the record into the kitchen is now
   * thinking about the kitchen, and leaving the screen on the room they just emptied would be answering
   * a gesture with a shrug.
   */
  const [dropSaid, setDropSaid] = useState<string | null>(null);
  const drag = useRoomDrag((payload, target) => {
    if (payload.kind === 'record') {
      void api
        .handoff(payload.zoneId, target.zoneId)
        .then(() => select(target.zoneId))
        .catch(() => setDropSaid('that room would not take it'));
      return;
    }
    /* On the desk a strip dropped on a strip joins *that* strip's group; on the stage a room dropped on
       the wall joins the room you are in. Either way the head of the list is the room whose music
       continues, which is what dragging *into* it means. */
    const host =
      target.kind === 'desk'
        ? (zones.find((candidate) => candidate.id === target.zoneId) ?? null)
        : zone;
    const leader = leaderOf(host, zones);
    if (!leader || leader.id === leaderOf(zones.find((c) => c.id === payload.zoneId) ?? null, zones)?.id) {
      return;
    }
    /* `members` already leads with the leader — see `ApiGroup`. */
    const members = leader.group?.members ?? [leader.id];
    void api
      .setGroup(leader.id, [...members, payload.zoneId])
      .then((result) => {
        const refused = result.rejected[0];
        if (refused) {
          setDropSaid(
            refused.reason === 'protocol-mismatch'
              ? `${payload.name} can’t stay in step with this room`
              : `${payload.name} is not there any more`,
          );
        }
      })
      .catch(() => setDropSaid('that did not work'));
  });

  /* A refusal is worth one sentence and then silence. */
  useEffect(() => {
    if (!dropSaid) {
      return undefined;
    }
    const timer = window.setTimeout(() => setDropSaid(null), 4200);
    return () => window.clearTimeout(timer);
  }, [dropSaid]);

  const goHome = (): void => setView({ kind: 'home' });
  const openBrowse = (node: BrowseNode = {}): void => setView({ kind: 'browse', node });

  /*
   * Into the reading and back out, with the sleeve flying between the two.
   *
   * `captureCover` measures what is on screen *before* React is told anything — the state update
   * unmounts the stage in the same commit that mounts the deck, so a capture taken any later has
   * nothing left to measure. The arriving cover consumes it (`useCoverAnchor` in both places), which
   * is why this works in both directions with one call each way.
   */
  const openSignal = (): void => {
    captureCover();
    setView({ kind: 'signal' });
  };
  const leaveSignal = useCallback((): void => {
    captureCover();
    setView({ kind: 'home' });
  }, []);

  /* The one shortcut a view that covers the player owes you. The door in the band is the discoverable
     half; this is for the hand already on the keyboard. */
  useEscape(view.kind === 'signal', leaveSignal);

  /*
   * The keys a player on a desk is expected to answer.
   *
   * Space plays and pauses, the arrows seek and set the level, `n` and `p` skip, `/` puts the cursor
   * in the search field. Never while typing — an input, a textarea, anything editable — and never with a
   * modifier held, so the browser's own shortcuts stay its own. Nothing is drawn for these: a player
   * that labels its space bar is a player that does not trust it.
   */
  useEffect(() => {
    if (phone) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') !== null)) {
        return;
      }
      const room = leader;
      switch (event.key) {
        case ' ':
          if (room && cur.hasTrack) {
            event.preventDefault();
            void (cur.isPlaying ? api.pause(room.id) : api.play(room.id));
          }
          break;
        case 'ArrowRight':
        case 'ArrowLeft':
          if (room && cur.showBar && cur.durationSec > 0) {
            event.preventDefault();
            const step = event.shiftKey ? 30 : 10;
            const next = cur.elapsedSec + (event.key === 'ArrowRight' ? step : -step);
            void api.seek(room.id, Math.max(0, Math.min(cur.durationSec, Math.round(next))));
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          if (zone) {
            event.preventDefault();
            const max = zone.volumeLimits.max ?? 100;
            const step = event.shiftKey ? 5 : 2;
            const next = zone.volume + (event.key === 'ArrowUp' ? step : -step);
            void api.setVolume(zone.id, Math.max(0, Math.min(max, next)));
          }
          break;
        case 'n':
          if (room && cur.hasTrack) {
            void api.next(room.id);
          }
          break;
        case 'p':
          if (room && cur.hasTrack) {
            void api.previous(room.id);
          }
          break;
        case '/':
          event.preventDefault();
          if (view.kind !== 'browse') {
            openBrowse();
          }
          window.requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.cx-search input')?.focus();
          });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phone, leader, zone, cur, api, view.kind]);

  /*
   * And the moment there is nothing to read, it closes itself.
   *
   * The same rule the canvas has, for the same reason and deliberately not a different one: two
   * answers to "the record went away while I was looking at it" is how a window becomes
   * unpredictable. `hasTrack`, not `isPlaying` — a paused room still has a chain, a format and a
   * clock lock worth reading, and pausing from the band must not throw you out of the view you
   * pressed pause in.
   */
  useEffect(() => {
    if (view.kind === 'signal' && !cur.hasTrack) {
      setView({ kind: 'home' });
    }
  }, [view.kind, cur.hasTrack]);

  /* The mini bar exists for "you are looking at something else and want the music" — which is not the
     signal view, whose own band carries the identity and the transport. */
  const browsing = view.kind === 'browse' || view.kind === 'inputs';

  return (
    <div
      className="cx-root"
      data-idle={idle || undefined}
      /* Which room the wash is lighting — see `.cx-bg-scrim`: a record's colour belongs to the page
         that is showing that record, and nowhere near a wall of thirty other people's covers. */
      data-view={view.kind}
      data-dragging={drag.active?.kind}
      data-rest={rest ?? undefined}
      style={accent as React.CSSProperties}
    >
      {/*
       * The room, lit by what is playing in it.
       *
       * Two things, dissolving together on every track change: the sleeve blurred past recognition, and
       * the two colours the server read out of it as a pair of very large, very faint radials. The blur
       * was already here and was forced to `grayscale(1)` — because a saturated 110px blur behind a
       * listing tints every cover standing on it, which is true, and the answer is not to throw the
       * colour away but to put it in a layer that knows how faint it has to be. The result is a black
       * page that takes the record's temperature; the covers on top of it stay their own colour.
       */}
      {leader?.track && (
        <Crossfade
          artKey={artKey}
          cover={zoneCoverCss(api, leader, 480)}
          render={(slot) => (
            <>
              <span className="cx-bg" style={{ backgroundImage: slot.cover }} />
              <span className="cx-bg-scrim" />
            </>
          )}
        />
      )}

      {/*
       * What is in the hand.
       *
       * Fixed to the pointer rather than parented to what it came from, because it has to cross panels
       * that clip their own overflow — a ghost inside the sliver it was picked up from would be cut off
       * at the first edge it met.
       */}
      {drag.active && (
        <span
          className="cx-hand"
          style={{
            left: `${drag.active.x}px`,
            top: `${drag.active.y}px`,
            backgroundImage: drag.active.cover,
          }}
          aria-hidden="true"
        >
          {!drag.active.cover && <i className="cx-hand-name mono">{drag.active.name}</i>}
        </span>
      )}

      {dropSaid && <span className="cx-said mono">{dropSaid}</span>}

      {/* The dimmed screen's one readout: a panel on a wall is also a clock — and a calendar. */}
      {idle && (
        <span className="cx-idle-clock disp">
          {clock.time}
          <i className="cx-idle-date mono">{clock.date}</i>
        </span>
      )}

      {/*
       * The one measurement the poster keeps: how far into the record the room is, as a light
       * along the bottom edge rather than a bar with a knob. Faint enough to ignore, present
       * enough to answer the glance from across the room. Only when there is a position at all —
       * a station gets nothing, which is honest.
       */}
      {idle && cur.showBar && (
        <span className="cx-idle-progress" style={{ width: cur.pct }} aria-hidden="true" />
      )}

      {/* And the one thing about the future a glance from across the room might want: what is next.
          Bottom-left, in the greys the clock uses, so the record stays the only bright thing. */}
      {idle && rest === 'record' && nextUp && (
        <span className="cx-idle-next" aria-hidden="true">
          {nextUp.cover && <i className="cx-idle-next-cov" style={{ backgroundImage: nextUp.cover }} />}
          <i className="cx-idle-next-lbl mono">up next</i>
          <i className="cx-idle-next-txt">{nextUp.title}</i>
        </span>
      )}

      {/* --- desktop chrome --- */}
      {!phone && (
        <header className="cx-top">
          {/* A hidden twin, holding the space the shell's shared copy floats over — see `shell/Brand`. */}
          <span className="cx-brand">
            <Brand placeholder />
          </span>

          {/*
           * Three things, where there were eight.
           *
           * The bar used to list every service — `LIBRARY RADIO SPOTIFY APPLE MUSIC YOUTUBE MUSIC` —
           * which is a website menu, and it started saying the same thing twice the moment browsing
           * moved into the room's panel: the panel already carries the service's name at poster size,
           * and the bar was lighting up that same word in 10px. The root of the catalogue *is* the list
           * of services, so the way in is one press and the naming happens where the looking happens.
           *
           * `home` appears only when you are somewhere else. A button that takes you where you already
           * are is furniture pretending to be a control.
           */}
          {/*
           * Four words, at the right, where the eye ends a line.
           *
           * `stage` is where the record is; `music` is the catalogue; `inputs` is what is wired in;
           * `rooms` is the desk. The one that is on screen is lit, so the bar is also the answer to
           * "where am I". Words, not glyphs: a 10px magnifier is a door that does not say where it
           * goes. And nothing under the bar — the hairline that ran here drew a frame around a
           * poster, and a poster is not framed.
           */}
          <div className="cx-status">
            {/* Only when the stream is down, and only ever a dot: the numbers on this screen may be stale
                and that is worth saying; *why* is the reading's business. */}
            {status !== 'open' && (
              <span className="cx-stale" title="Not in touch with the house right now" />
            )}
          </div>
          <nav className="cx-nav mono">
            <button type="button" data-on={(view.kind === 'home' && !idle) || undefined} onClick={goHome}>
              stage
            </button>
            <button type="button" data-on={view.kind === 'browse' || undefined} onClick={() => openBrowse()}>
              music
            </button>
            <button
              type="button"
              data-on={view.kind === 'inputs' || undefined}
              onClick={() => setView({ kind: 'inputs' })}
            >
              inputs
            </button>
            <button type="button" data-on={sheet === 'rooms' || undefined} onClick={() => setSheet('rooms')}>
              rooms{cur.grouped ? ` +${cur.groupExtra}` : ''}
            </button>
          </nav>
        </header>
      )}

      {/*
       * The phone header, on every screen.
       *
       * It used to vanish on home whenever a record was playing, and that was right while home *was*
       * the player: the artwork ran to all four edges and carried the room name itself, so a 54px
       * strip above it holding a logo and a second copy of that name was 54px of sleeve, spent twice.
       *
       * Home is a list now and the full-bleed sleeve lives in its own layer, so the rule had nothing
       * left to protect — and it was doing real damage once the installed app started filling the
       * screen properly: the header is what holds `env(safe-area-inset-top)`, so on a phone with
       * music playing the greeting ran straight under the status bar and the notch sat on it.
       */}
      {phone && (
        <header className="cx-mhead">
          <span className="cx-brand">
            <Mark className="cx-brand-mark" />
          </span>
          <button type="button" className="cx-room-btn mono" onClick={() => setSheet('rooms')}>
            {cur.name || 'rooms'}
            {cur.grouped ? ` +${cur.groupExtra}` : ''}
            <ChevronGlyph size={13} />
          </button>
        </header>
      )}

      <div className="cx-body">
        <div className="cx-main-wrap">
          <div className="cx-content-row">
            <main className="cx-main">
              {/*
               * On a desk with music in the house, the wall is the shell — and what the room is doing
               * goes *inside* its panel.
               *
               * Browsing used to replace the whole screen, which put a page with a menu bar over a
               * player that had just spent its whole design becoming a room. It also lost the one thing
               * a browser needs to be unambiguous about: which room this is going to play in. Inside the
               * panel, between the slivers, that question answers itself — you are looking for something
               * *in this room*, and the rest of the house is still standing either side of it.
               *
               * A quiet house has no wall to put anything in, so it keeps the old shape: the welcome
               * screen, or a listing at full width.
               */}
              {/*
               * The deck stands on its own, edge to edge.
               *
               * Browsing goes *inside* the wall because the question it raises — which room is this
               * going to play in — is answered by the rooms standing either side of it. The deck
               * raises no such question: it is one room's instruments, and the only thing 152px of
               * other rooms' spines does here is take the width the spectrum wanted. A rack is
               * edge to edge or it is a widget.
               */}
              {!phone && view.kind === 'signal' && zone ? (
                <Signal cur={cur} zone={zone} zones={zones} onLeave={leaveSignal} />
              ) : !phone ? (
                <Wall
                  channels={channels}
                  currentLeaderId={leaderOf(zone, zones)?.id ?? null}
                  onSelect={select}
                  drag={drag}
                  onCanvas={() => setAsked('record')}
                  onHouse={() => setAsked('house')}
                  canCanvas={cur.hasTrack}
                  foot={view.kind === 'home'}
                >
                  {view.kind === 'browse' ? (
                    <Browse
                      zone={zone}
                      root={view.node}
                      onExit={goHome}
                      onOpenRooms={() => setSheet('rooms')}
                      // Remount on a different root so the internal path stack starts fresh rather than
                      // keeping the last service's trail.
                      key={view.node.id ?? 'root'}
                    />
                  ) : view.kind === 'inputs' ? (
                    <Sources zone={zone} onDone={goHome} />
                  ) : houseQuiet ? (
                    /*
                     * A quiet house is still a house.
                     *
                     * With nothing playing anywhere the desk swapped in a different layout altogether —
                     * a page of cards where the wall had been — so the one screen this product has
                     * became two, depending on whether anybody happened to be listening. The rooms are
                     * still there when they are silent; what changes is only what the panel between them
                     * holds, which is now a place to start something rather than a picture of something
                     * already started.
                     *
                     * `house={[]}` because the rooms are the panels on either side of this. Drawing them
                     * again as cards inside one of them is the same list twice.
                     */
                    <Welcome
                      greetingText={greeting()}
                      rooms={zones.length}
                      playing={zones.filter((candidate) => Boolean(candidate.track)).length}
                      services={services}
                      onBrowse={openBrowse}
                      onInputs={() => setView({ kind: 'inputs' })}
                      scenes={scenes.slice(0, 4).map((scene) => ({
                        key: scene.id,
                        title: scene.name,
                        cover: scene.coverUrl,
                        play: () => void recall(scene),
                      }))}
                      recents={recents.slice(0, 12).map((item) => ({
                        key: item.source,
                        title: item.title || item.album || item.source,
                        cover: item.coverUrl,
                        play: () => zone && void api.play(zone.id, item.source),
                      }))}
                      house={[]}
                      favorites={favorites.slice(0, 12).map((item) => ({
                        key: String(item.id),
                        title: item.name,
                        cover: item.coverUrl,
                        play: () => zone && void api.play(zone.id, item.source),
                      }))}
                    />
                  ) : (
                    <Stage
                      cur={cur}
                      drag={drag}
                      onSignal={openSignal}
                      onLeaveCanvas={() => setAsked(null)}
                      resting={idle}
                      onOpenRooms={() => setSheet('rooms')}
                      onOpenQueue={() => setSheet('queue')}
                      onBrowse={() => openBrowse()}
                      upNext={upNext}
                      upNextTotal={upNextTotal}
                      elsewhere={elsewhere}
                      /* What this room played last, for the one thing an idle room can honestly show:
                         the record that was on, in the dark. See `Stage`'s empty branch. */
                      lastCover={recents[0]?.coverUrl ? `url("${recents[0].coverUrl}")` : undefined}
                    />
                  )}
                </Wall>
              ) : view.kind === 'browse' ? (
                <Browse
                  zone={zone}
                  root={view.node}
                  onExit={goHome}
                  onOpenRooms={() => setSheet('rooms')}
                  key={view.node.id ?? 'root'}
                />
              ) : view.kind === 'inputs' ? (
                <Sources zone={zone} onDone={goHome} />
              ) : view.kind === 'signal' && zone ? (
                /* One column of instruments, read one at a time down the page — which is what a phone
                   can honestly do with a deck, and what it never could with a whole second shell. */
                <Signal cur={cur} zone={zone} zones={zones} onLeave={leaveSignal} />
              ) : (
                /*
                 * Home is where you decide what to play.
                 *
                 * On a phone that is *always* true now — the record you are listening to lives in
                 * the bar along the bottom and in the player above it — while a desk keeps the
                 * stage on home and only falls back to this when the whole house is quiet, because
                 * a desk has the width to be both at once and a wall panel should show the record.
                 */
                <Welcome
                  greetingText={greeting()}
                  rooms={zones.length}
                  playing={zones.filter((candidate) => Boolean(candidate.track)).length}
                  services={services}
                  onBrowse={openBrowse}
                  onInputs={() => setView({ kind: 'inputs' })}
                  // A quiet house is exactly when a saved moment earns its place: scenes carry
                  // their own rooms and volumes, so they work from this screen with nothing
                  // selected — unlike the recents beside them, which need a room to land in.
                  scenes={scenes.slice(0, 4).map((scene) => ({
                    key: scene.id,
                    title: scene.name,
                    cover: scene.coverUrl,
                    play: () => void recall(scene),
                  }))}
                  recents={recents.slice(0, 12).map((item) => ({
                    key: item.source,
                    title: item.title || item.album || item.source,
                    cover: item.coverUrl,
                    play: () => zone && void api.play(zone.id, item.source),
                  }))}
                  /*
                   * Every room, led by the one you are in. Pressing a room *selects* it — and
                   * opens the player when it has something on, because "take me to the kitchen"
                   * and "show me what the kitchen is playing" are the same intent from here.
                   */
                  house={channels.map((channel) => ({
                    key: String(channel.leader.id),
                    name: channel.leader.name,
                    title: channel.leader.track?.title ?? '',
                    cover: zoneCoverCss(api, channel.leader, 480),
                    playing: channel.playing && channel.hasTrack,
                    current: channel.leader.id === leaderOf(zone, zones)?.id,
                    pct:
                      channel.hasTrack && channel.leader.duration > 0
                        ? Math.min(100, (channel.leader.position / channel.leader.duration) * 100)
                        : null,
                    off: channel.leader.powerState?.power === 'off',
                    open: () => {
                      select(channel.leader.id);
                      if (channel.hasTrack) {
                        setPlayerOpen(true);
                      }
                    },
                  }))}
                  /* The room's saved list — the one shelf here that is a deliberate choice rather
                     than a trace of what happened, which is why it leads. */
                  favorites={favorites.slice(0, 12).map((item) => ({
                    key: String(item.id),
                    title: item.name,
                    cover: item.coverUrl,
                    play: () => zone && void api.play(zone.id, item.source),
                  }))}
                />
              )}
            </main>

          </div>

          {!phone && browsing && leader && <MiniBar cur={cur} onOpen={goHome} />}
        </div>
      </div>

      {/*
       * The phone's player, over everything, and the bar that opens it.
       *
       * The bar is the same `MiniBar` the desk shows while browsing — one object for "what is
       * playing, wherever you are" rather than two that drift apart. It sits directly on the nav,
       * and it is the only way up to the player, which is what makes the player a *place*.
       */}
      {phone && playerOpen && (
        <div className="cx-player-sheet">
          <MobileStage
            cur={cur}
            artKey={artKey}
            currentLeaderId={leaderOf(zone, zones)?.id ?? null}
            onOpenRooms={() => setSheet('rooms')}
            onOpenQueue={() => setSheet('queue')}
            onBrowse={() => {
              setPlayerOpen(false);
              openBrowse();
            }}
            /* The reading is a view under the player layer, so the layer goes first. */
            onSignal={() => {
              setPlayerOpen(false);
              openSignal();
            }}
            upNextTotal={upNextTotal}
            onDismiss={() => setPlayerOpen(false)}
          />
        </div>
      )}

      {phone && !playerOpen && leader && cur.hasTrack && view.kind !== 'signal' && (
        <MiniBar cur={cur} onOpen={() => setPlayerOpen(true)} />
      )}

      {/*
        --- phone nav ---

        Every tab puts the player away first. The bar sits *under* the player layer and stays
        pressable there on purpose — that is what makes the player a place rather than a trap — but
        a tab that navigated without dismissing left the new destination hidden behind the sleeve,
        with only the lit tab to say anything had happened.
      */}
      {phone && (
        <nav className="cx-bnav">
          <NavTab
            label="home"
            on={view.kind === 'home' && !playerOpen}
            onClick={() => {
              setPlayerOpen(false);
              goHome();
            }}
          >
            <HomeGlyph size={19} />
          </NavTab>
          <NavTab
            label="music"
            on={view.kind === 'browse' && !playerOpen}
            onClick={() => {
              setPlayerOpen(false);
              openBrowse();
            }}
          >
            <GridGlyph size={19} />
          </NavTab>
          {/*
           * No queue tab. The queue belongs to the record — it is one swipe up from the player and the
           * `up next` in the player's foot — and a fifth tab for it put a list of tracks at the same
           * level as the house. Four: where you start, what there is, where it plays, the rest.
           */}
          <NavTab label="rooms" on={sheet === 'rooms'} onClick={() => setSheet('rooms')}>
            <RoomsGlyph size={19} />
          </NavTab>
          <NavTab label="more" on={sheet === 'more'} onClick={() => setSheet('more')}>
            <MoreGlyph size={19} />
          </NavTab>
        </nav>
      )}

      {/* --- sheets --- */}
      <Sheet
        open={sheet === 'rooms'}
        title="Rooms"
        onClose={() => setSheet(null)}
        wide
        desk
        aside={<span className="cx-sheet-tab-static mono">{houseCount(channels)}</span>}
      >
        <RoomsSheet zones={zones} channels={channels} selectedId={zoneId} phone={phone} onSelect={select} drag={drag} />
      </Sheet>

      {/* The queue's head names the *room*; the sheet reads top to bottom — see `QueueSheet`. */}
      <Sheet
        open={sheet === 'queue'}
        title={cur.name || 'This room'}
        onClose={() => setSheet(null)}
        aside={
          upNextTotal > 0 ? <span className="cx-sheet-tab-static mono">{upNextTotal} to come</span> : undefined
        }
      >
        {zone && (
          <QueueSheet
            zone={zone}
            cur={cur}
            queue={queue}
            recents={recents}
            onBrowse={() => {
              setSheet(null);
              setPlayerOpen(false);
              openBrowse();
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'more'} title="Player" onClose={() => setSheet(null)}>
        <div className="cx-more">
          {/*
           * Shuffle and repeat, on the one screen where they had nowhere else to be.
           *
           * The desktop transport carries them either side of the play button; the phone's does not, on
           * the argument that five equal targets under a full-bleed sleeve is a remote control rather than
           * a player (see `Transport`). That argument is right about the transport and left the two modes
           * unreachable on a phone entirely — this sheet is where a mode set once a month belongs.
           */}
          {leader && hasQueue && (
            <>
              <button
                type="button"
                className="cx-more-row"
                onClick={() => void api.setShuffle(leader.id, !cur.shuffle)}
              >
                <span className="cx-more-name">Shuffle</span>
                <span className="cx-more-sub mono">play the queue out of order</span>
                <span className="cx-more-state mono" data-on={cur.shuffle || undefined}>
                  {cur.shuffle ? 'on' : 'off'}
                </span>
              </button>
              <button
                type="button"
                className="cx-more-row"
                onClick={() => void api.setRepeat(leader.id, cur.repeat ? 'off' : 'all')}
              >
                <span className="cx-more-name">Repeat</span>
                <span className="cx-more-sub mono">start again at the end</span>
                <span className="cx-more-state mono" data-on={cur.repeat || undefined}>
                  {cur.repeat ? 'on' : 'off'}
                </span>
              </button>
            </>
          )}

          <button type="button" className="cx-more-row" onClick={() => { setSheet(null); setView({ kind: 'inputs' }); }}>
            <span className="cx-more-name">Inputs</span>
            <span className="cx-more-sub mono">line-in, turntable, anything wired</span>
            <span className="cx-more-go">
              <ForwardGlyph size={15} />
            </span>
          </button>
          {/*
           * The reading, on a phone too.
           *
           * This door could not exist while the technical side was a *face*: that player was a shell
           * with a nav rail, a browser and a queue, and the one-column version of it was a different
           * app rather than the same one in a narrow coat. As a view of one record it is a stack of
           * instruments, which is exactly what a phone can hold — so the squeeze the old note was
           * protecting against is not what is on offer any more.
           */}
          {cur.hasTrack && (
            <button
              type="button"
              className="cx-more-row"
              onClick={() => {
                setSheet(null);
                setPlayerOpen(false);
                openSignal();
              }}
            >
              <span className="cx-more-name">Signal</span>
              <span className="cx-more-sub mono">what happened to the audio on its way here</span>
              <span className="cx-more-go">
                <ForwardGlyph size={15} />
              </span>
            </button>
          )}
          {/*
           * The console, which this face's corner cannot offer on a phone.
           *
           * `shell/FaceSwitch` carries both doors on a desk, and drops the whole cluster below 980px so it
           * is not floating on somebody's album cover — which took the way to the console with it. This
           * sheet is where the corner's contents go on a phone, so it takes that too. An `<a href>` rather
           * than a button, for the same reason the corner uses one: a real navigation is what lets the
           * mark fly across.
           */}
          <a className="cx-more-row" href="/admin/">
            <span className="cx-more-name">Admin</span>
            <span className="cx-more-sub mono">rooms, services, the house itself</span>
            <span className="cx-more-go">
              <ForwardGlyph size={15} />
            </span>
          </a>
          <p className="cx-more-foot mono">
            {zones.length} room{zones.length === 1 ? '' : 's'} · {status === 'open' ? 'connected' : 'reconnecting'}
          </p>
        </div>
      </Sheet>
    </div>
  );
}

/** `3 rooms · 1 group` — the desk's one fact, for the sheet's head. */
function houseCount(channels: Channel[]): string {
  const rooms = channels.reduce((sum, channel) => sum + channel.members.length, 0);
  const groups = channels.filter((channel) => channel.members.length > 1).length;
  return `${rooms} room${rooms === 1 ? '' : 's'}${groups ? ` · ${groups} group${groups === 1 ? '' : 's'}` : ''}`;
}

function NavTab({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="cx-bnav-tab" data-on={on || undefined} onClick={onClick}>
      {children}
      <span className="mono">{label}</span>
    </button>
  );
}

/**
 * A sheet: bottom-anchored on a phone, a centred modal on a desk (see `art.css`).
 *
 * Always mounted and moved with a transform rather than mounted on open, so it slides in and out
 * instead of appearing. `inert`-by-visibility is handled in CSS; the escape key is handled here
 * because a modal you cannot dismiss from the keyboard is a trap on a desktop.
 *
 * The head does not scroll and the body does, which is what lets the body be *masked* at both ends
 * rather than cut: a list that fades into the sheet's edge reads as a longer list continuing past the
 * lid, and a hard cut at a rounded corner reads as a bug. `aside` is for the one thing a sheet's head
 * may carry besides its name — the queue's two tabs, which were a second header row under the first.
 */
function Sheet({
  open,
  title,
  onClose,
  wide = false,
  desk = false,
  aside,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  /** The desk needs the width of a row of strips — see `.cx-sheet[data-desk]`. */
  desk?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className="cx-scrim" data-open={open || undefined} role="presentation" onClick={onClose} />
      <div
        className="cx-sheet"
        data-open={open || undefined}
        data-wide={wide || undefined}
        data-desk={desk || undefined}
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
      >
        <span className="cx-sheet-handle" aria-hidden="true" />
        <div className="cx-sheet-head">
          <span className="cx-sec-lbl mono">{title}</span>
          <span className="cx-sec-rule" />
          {aside}
        </div>
        <div className="cx-sheet-body">{children}</div>
      </div>
    </>
  );
}

/**
 * Home.
 *
 * On a desk this is the quiet-house screen and nothing else — the stage has the room when there is
 * music. On a phone it is the screen you open the app onto, every time, playing or not: the first
 * question a phone gets asked is almost always *what shall I put on*, and the record you already
 * chose lives in the bar along the bottom.
 *
 * Which is why the greeting states what is true rather than what would be pretty. `The house is
 * quiet` under a bar showing a playing record is the kind of small lie a home screen cannot afford
 * — it is the one screen someone reads without looking for anything.
 *
 * Everything below the greeting is a shelf, and the shelves are the same object browsing uses:
 * they bleed past the page's margin so the row is *visibly* cut by the window rather than ending
 * at a tidy edge, which is the oldest way to say "keep going" and costs no chrome to say it.
 */
function Welcome({
  greetingText,
  rooms,
  playing,
  services,
  onBrowse,
  onInputs,
  scenes,
  recents,
  favorites = [],
  house = [],
}: {
  greetingText: string;
  rooms: number;
  /** How many rooms have music loaded — the difference between a home and a waiting room. */
  playing: number;
  services: ContentService[];
  onBrowse: (node?: BrowseNode) => void;
  onInputs: () => void;
  /** Saved moments, drawn exactly like the recents: a scene is also a record on the shelf. */
  scenes: Array<{ key: string; title: string; cover: string; play: () => void }>;
  recents: Array<{ key: string; title: string; cover: string; play: () => void }>;
  favorites?: Array<{ key: string; title: string; cover: string; play: () => void }>;
  /** Every room, for the shelf that is this product rather than this genre of app. */
  house?: Array<{
    key: string;
    name: string;
    title: string;
    cover: string | undefined;
    playing: boolean;
    current: boolean;
    /** How far into its record the room is, 0–100, or null when there is nothing to measure. */
    pct: number | null;
    off: boolean;
    open: () => void;
  }>;
}) {
  return (
    <div className="cx-welcome">
      {/* The day, above the greeting, in the eyebrow's voice: a home screen is also the thing on the
          wall you glance at in the morning. */}
      <span className="cx-welcome-date mono">{todayLabel()}</span>
      <h1 className="disp cx-welcome-greet">{greetingText}.</h1>

      {/* Once, quietly, on the screen the app opens onto — see `InstallHint`. */}
      <InstallHint />

      {/*
       * The house, first.
       *
       * This is the shelf no other music app has: every room as a poster of what is on in it — the
       * sleeve filling the tile, the name and the record over its foot, a hairline of how far along it
       * is. A quiet room shows its tile dark with the name; a room that is off says so with the power
       * glyph. The room you are in leads. Pressing a room stands you in it, and opens the player when
       * it has something on.
       */}
      {house.length > 1 && (
        <section className="cx-hsec">
          <HomeSec label="the house" right={`${playing} of ${rooms} playing`} />
          <div className="cx-welcome-recents-row cx-rooms-row">
            {house.map((room) => (
              <button
                type="button"
                className="cx-roomcard"
                key={room.key}
                data-current={room.current || undefined}
                data-quiet={!room.title || undefined}
                data-on={room.playing || undefined}
                onClick={room.open}
              >
                {room.cover && <span className="cx-roomcard-cov" style={{ backgroundImage: room.cover }} aria-hidden="true" />}
                <span className="cx-roomcard-txt">
                  <span className="cx-roomcard-name mono">
                    {room.playing && <i className="cx-roomcard-dot" aria-hidden="true" />}
                    {room.name}
                  </span>
                  <span className="cx-roomcard-track">{room.title || (room.off ? 'off' : 'quiet')}</span>
                  {room.pct !== null && (
                    <span className="cx-roomcard-prog" aria-hidden="true">
                      <i style={{ width: `${room.pct}%` }} />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* The ways in, as words. On a desk with a quiet house this is the whole point of the screen; on a
          phone it is the shortcut row under the greeting. */}
      <div className="cx-welcome-shortcuts mono">
        {services.map((service) => (
          <button type="button" key={service.id} onClick={() => onBrowse({ id: service.rootId, label: service.name })}>
            {service.name}
          </button>
        ))}
        <button type="button" onClick={onInputs}>
          inputs
        </button>
      </div>

      {favorites.length > 0 && (
        <section className="cx-hsec">
          <HomeSec label="favourites" />
          <div className="cx-welcome-recents-row">
            {favorites.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/*
        Scenes before recents, because they are the stronger promise: a recent needs a room to be
        selected to land anywhere, a scene brings its own rooms and volumes with it.
      */}
      {scenes.length > 0 && (
        <section className="cx-hsec">
          <HomeSec label="set the scene" />
          <div className="cx-welcome-recents-row">
            {scenes.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recents.length > 0 && (
        <section className="cx-hsec">
          <HomeSec label="pick up where you left off" />
          <div className="cx-welcome-recents-row">
            {recents.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A section's head: the label, a hairline running out to the right, and one optional fact. */
function HomeSec({ label, right }: { label: string; right?: string }) {
  return (
    <div className="cx-hsec-head">
      <span className="cx-hsec-lbl mono">{label}</span>
      <span className="cx-hsec-rule" aria-hidden="true" />
      {right && <span className="cx-hsec-right mono">{right}</span>}
    </div>
  );
}

/** `Thursday 10 September` — the day, the way it is said, not the way it is stored. */
function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
