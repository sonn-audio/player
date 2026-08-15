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
import { useEffect, useMemo, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import { useSelectedZone } from '@/state/useSelectedZone';
import { useLocalPlayback } from '@/state/useLocalPlayback';
import { useMediaSession } from '@/state/useMediaSession';
import { useScenes } from '@/state/useScenes';
import { useWakeLock } from '@/state/useWakeLock';
import { Brand } from '@/shell/Brand';
import { Mark } from '@/components/Mark';
import { Stage, MobileStage, greeting } from '@/art/Stage';
import { RoomsSheet } from '@/art/Channels';
import { Dock } from '@/art/Dock';
import { Lane } from '@/art/Lane';
import { useEdges, useEscape } from '@/art/useEdges';
import { QueueSheet, QueueTabs, type QueueTab } from '@/art/Rail';
import { Crossfade } from '@/art/Crossfade';
import { Browse, MiniBar, Sources, type BrowseNode } from '@/art/Browse';
import { channelsOf, leaderOf, useCur } from '@/art/useCur';
import { useFavorites, useQueue, useRecents } from '@/art/useCollections';
import { accentOf, artKeyOf } from '@/art/accent';
import { useClock, useIdle } from '@/art/useIdle';
import { zoneCoverCss, itemCoverCss } from '@/art/cover';
import {
  ChevronGlyph,
  ForwardGlyph,
  GridGlyph,
  HomeGlyph,
  MoreGlyph,
  QueueGlyph,
  RoomsGlyph,
  SearchGlyph,
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

/** What the middle of the screen is showing. */
type View = { kind: 'home' } | { kind: 'browse'; node: BrowseNode } | { kind: 'inputs' };

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
  const [queueTab, setQueueTab] = useState<QueueTab>('queue');
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
  const idle = useIdle(IDLE_AFTER_MS, cur.isPlaying && view.kind === 'home' && sheet === null);
  const clock = useClock(idle);

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

  /** The entry after the one playing, for the stage's "next" line. */
  const nextUp = useMemo(() => {
    if (queue.currentIndex === null) {
      return null;
    }
    const next = queue.items[queue.currentIndex + 1];
    return next ? { title: next.title, artist: next.artist } : null;
  }, [queue]);

  const goHome = (): void => setView({ kind: 'home' });
  const openBrowse = (node: BrowseNode = {}): void => setView({ kind: 'browse', node });

  const browsing = view.kind !== 'home';

  return (
    <div className="cx-root" data-idle={idle || undefined} style={accent as React.CSSProperties}>
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

      {/* --- desktop chrome --- */}
      {!phone && (
        <header className="cx-top">
          {/* A hidden twin, holding the space the shell's shared copy floats over — see `shell/Brand`. */}
          <span className="cx-brand">
            <Brand placeholder />
          </span>

          <nav className="cx-nav mono">
            <button type="button" data-on={view.kind === 'home' || undefined} onClick={goHome}>
              home
            </button>
            {services.map((service) => (
              <button
                type="button"
                key={service.id}
                data-on={
                  (view.kind === 'browse' && view.node.id === service.rootId) || undefined
                }
                onClick={() => openBrowse({ id: service.rootId, label: service.name })}
              >
                {service.name}
              </button>
            ))}
            <button type="button" data-on={view.kind === 'inputs' || undefined} onClick={() => setView({ kind: 'inputs' })}>
              inputs
            </button>
            <button type="button" onClick={() => openBrowse()}>
              <SearchGlyph size={14} />
            </button>
          </nav>

          {/*
           * One control in this corner, and it is the way to the other player.
           *
           * It held three things: a `N PLAYING` count, the room name as a button, and a `…` for a sheet.
           * All three were answered better somewhere else on the same screen — the dock along the bottom
           * says which rooms are playing *and* which one you are in, the stage carries the door to
           * grouping beside the master volume, and the sheet's one unique item was this switch. Three
           * controls collapsing into the one that had nowhere else to be.
           *
           * The switch itself is not drawn here either — it belongs to the frame now (`shell/FaceSwitch`),
           * so it cannot blink or change shape underneath the cursor that just pressed it. What is left in
           * this corner is the one thing that is genuinely this face's own: whether its numbers are stale.
           */}
          <div className="cx-status">
            {/* Only when the stream is down, and only ever a dot. The numbers on this screen may be stale
                and that is worth saying; *why* they are stale is the other face's business. */}
            {status !== 'open' && (
              <span className="cx-stale" title="Not in touch with the house right now" />
            )}
          </div>
        </header>
      )}

      {/*
       * The phone header, absent exactly when the canvas is up.
       *
       * On the home screen with a record playing, the artwork runs to all four edges and carries the room
       * name itself (`.cx-mroom`) — so a 54px strip above it holding a logo and a second copy of that name
       * is 54px of sleeve, spent twice. Everywhere else (browsing, a quiet house) there is no canvas to
       * carry it and the header comes back.
       */}
      {phone && !(view.kind === 'home' && !houseQuiet && cur.hasTrack) && (
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
              {view.kind === 'browse' ? (
                <Browse
                  zone={zone}
                  root={view.node}
                  onExit={goHome}
                  // Remount on a different root so the internal path stack starts fresh rather than
                  // keeping the last service's trail.
                  key={view.node.id ?? 'root'}
                />
              ) : view.kind === 'inputs' ? (
                <Sources zone={zone} onDone={goHome} />
              ) : phone || houseQuiet ? (
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
                    cover: zoneCoverCss(api, channel.leader, 240),
                    playing: channel.playing && channel.hasTrack,
                    current: channel.leader.id === leaderOf(zone, zones)?.id,
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
              ) : (
                <Stage
                  cur={cur}
                  onOpenRooms={() => setSheet('rooms')}
                  onOpenQueue={() => setSheet('queue')}
                  onBrowse={() => openBrowse()}
                  nextUp={nextUp}
                  queueCount={queue.total}
                />
              )}
            </main>

            {/*
              The queue belongs to the player, not to the browser: while browsing, the listing gets the
              full width and the mini bar carries the playing room instead. And a live source has no queue
              at all, so the stage gets that width too — both conditions are known on the first frame, which
              is what keeps the composition from shifting once the queue lands.
            */}
            {!phone && !browsing && !houseQuiet && zone && hasQueue && cur.hasTrack && (
              <Lane
                zone={zone}
                queue={queue}
                open={edges.open === 'lane'}
                onOpen={() => edges.enter('lane')}
                onClose={() => edges.leave('lane')}
                onToggle={() => edges.toggle('lane')}
                touch={edges.touch}
              />
            )}
          </div>

          {!phone && browsing && leader && <MiniBar cur={cur} onOpen={goHome} />}
        </div>
      </div>

      {/*
       * The house, folded into one line along the bottom, opening into faders on intent.
       *
       * It was the full strip of faders, always, on every view — 150px of control surface under a screen
       * whose argument is that the sleeve should be the biggest thing on it. And it is absent while
       * browsing, where the mini bar carries the room: a listing needs its full height more than it
       * needs eight volume controls it did not ask for.
       */}
      {!phone && !browsing && (
        <Dock
          channels={channels}
          currentLeaderId={leaderOf(zone, zones)?.id ?? null}
          onSelect={select}
          open={edges.open === 'dock'}
          onEnter={() => edges.enter('dock')}
          onLeave={() => edges.leave('dock')}
          onToggle={() => edges.toggle('dock')}
          touch={edges.touch}
        />
      )}

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
            queueCount={queue.total}
            onDismiss={() => setPlayerOpen(false)}
          />
        </div>
      )}

      {phone && !playerOpen && leader && cur.hasTrack && (
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
           * Queue, where a second `search` tab used to be.
           *
           * That tab and `music` both called `openBrowse()` — the same destination twice out of five,
           * one of them under a magnifying glass, and the browse view has a search field of its own at
           * the top of it. The queue was the thing genuinely missing a way in from the phone.
           */}
          <NavTab label="queue" on={sheet === 'queue'} onClick={() => setSheet('queue')}>
            <QueueGlyph size={19} />
          </NavTab>
          <NavTab label="rooms" on={sheet === 'rooms'} onClick={() => setSheet('rooms')}>
            <RoomsGlyph size={19} />
          </NavTab>
          <NavTab label="more" on={sheet === 'more'} onClick={() => setSheet('more')}>
            <MoreGlyph size={19} />
          </NavTab>
        </nav>
      )}

      {/* --- sheets --- */}
      <Sheet open={sheet === 'rooms'} title="Rooms" onClose={() => setSheet(null)} wide>
        <RoomsSheet zones={zones} selectedId={zoneId} onSelect={select} />
      </Sheet>

      {/*
       * The queue's head names the *room*, and the two lists are tabs beside it.
       *
       * The tab state lives here rather than in the sheet's body because the tabs are now in the head,
       * and the head is the shell's — see `QueueTabs`.
       */}
      <Sheet
        open={sheet === 'queue'}
        title={cur.name || 'This room'}
        onClose={() => setSheet(null)}
        aside={
          <QueueTabs hasQueue={hasQueue} active={queueTab} total={queue.total} onPick={setQueueTab} />
        }
      >
        {zone && <QueueSheet zone={zone} queue={queue} recents={recents} tab={queueTab} />}
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
           * No way to the technical face from here any more.
           *
           * This sheet is phone-only, and a phone has one face (see `useFace`): that player is four
           * instruments read side by side, and the honest one-column version of it is a different
           * app rather than the same one in a narrow coat. Offering the door meant offering the
           * squeeze — this face *is* the phone product.
           */}
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
  aside,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
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
    open: () => void;
  }>;
}) {
  return (
    <div className="cx-welcome">
      <Mark className="cx-welcome-mark" />
      <h1 className="disp cx-welcome-greet">{greetingText}.</h1>
      <p className="cx-welcome-sub mono">
        {playing > 0
          ? `${playing} of ${rooms} room${rooms === 1 ? '' : 's'} playing`
          : `the house is quiet — ${rooms} room${rooms === 1 ? '' : 's'} ready`}
      </p>

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

      {/*
       * The house, on the home screen.
       *
       * This is the shelf no other music app has, and it was the thing this one kept in a sheet:
       * every room, what is on in it, and one press to stand in it. A phone home that led with
       * recents and favourites was a good *music* home and said nothing about the product — the
       * whole reason there is a server in the hall is that the music is in more than one place.
       *
       * The room you are in leads, marked; the rest follow in the house's own order. A room with
       * nothing on says so rather than being hidden, because "the kitchen is quiet" is an answer.
       */}
      {house.length > 1 && (
        <div className="cx-welcome-recents">
          <span className="cx-welcome-recents-lbl mono">the house</span>
          <div className="cx-welcome-recents-row cx-rooms-row">
            {house.map((room) => (
              <button
                type="button"
                className="cx-roomcard"
                key={room.key}
                data-current={room.current || undefined}
                data-quiet={!room.title || undefined}
                onClick={room.open}
              >
                <span className="cx-roomcard-cov" style={{ backgroundImage: room.cover }}>
                  {room.playing && <span className="cx-roomcard-dot" />}
                </span>
                <span className="cx-roomcard-name mono">{room.name}</span>
                <span className="cx-roomcard-track">{room.title || 'quiet'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {favorites.length > 0 && (
        <div className="cx-welcome-recents">
          <span className="cx-welcome-recents-lbl mono">favourites</span>
          <div className="cx-welcome-recents-row">
            {favorites.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/*
        Scenes before recents, because they are the stronger promise: a recent needs a room to be
        selected to land anywhere, a scene brings its own rooms and volumes with it. Same shelf,
        same records — what a scene *is* to the eye is the sleeve of the moment it saved.
      */}
      {scenes.length > 0 && (
        <div className="cx-welcome-recents">
          <span className="cx-welcome-recents-lbl mono">set the scene</span>
          <div className="cx-welcome-recents-row">
            {scenes.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {recents.length > 0 && (
        <div className="cx-welcome-recents">
          <span className="cx-welcome-recents-lbl mono">pick up where you left off</span>
          <div className="cx-welcome-recents-row">
            {recents.map((item) => (
              <button type="button" className="cx-welcome-recent" key={item.key} onClick={item.play}>
                <span className="cx-welcome-recent-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-welcome-recent-title">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
