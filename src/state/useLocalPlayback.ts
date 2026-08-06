/**
 * Playing audio in this tab.
 *
 * The documented flow, in three steps: `POST /destinations/local` registers the tab and returns
 * a `clientId` and a `streamUrl`; a Sendspin client connects to that url announcing that id;
 * `POST /destinations/{id}/play` then starts audio, which arrives as frames on the socket. The
 * Sendspin protocol handles format negotiation, clock sync and grouping — this only has to hold
 * the registration and the socket together.
 *
 * **A local destination is a zone you cannot look up.** Every zone route works on it — it is a
 * zone underneath — but it is absent from `GET /zones` and from the event stream, because a
 * browser tab is not a room and would otherwise appear in everyone's list. That is a visibility
 * rule, not a difference in kind.
 *
 * So the two things a listing would have provided are reconstructed here: `GET /destinations`
 * with an `X-Sonn-Client-Id` header is how the tab finds itself, and the audio socket's
 * `server/state` is what it is playing. `zone` then presents both as an ordinary `ApiZoneState`,
 * which is what lets the browser be **selected and controlled** through the same components as
 * the hardware rooms instead of a read-only lookalike.
 *
 * Four things make it more than a `new SendspinPlayer()` call:
 *
 *  - **`clientId` must be reclaimed across reloads.** Registering fresh on every refresh leaves
 *    an orphan destination behind until it times out, and those are visible to everyone else
 *    reading the destination list. It is persisted so a reload reclaims its own.
 *  - **A user gesture is needed once, for the audio context.** `unlock()` is only
 *    `new AudioContext()` + `resume()`, and the library already does both itself when
 *    `stream/start` arrives — so it is not the audio path that needs us. It is the browser: a
 *    `resume()` provoked by an incoming network message has no gesture behind it and is refused.
 *
 *    So a gesture is required, but not a *particular* one. Connecting happens on the first
 *    pointerdown or keydown anywhere on the page, which covers pressing play, clicking a search
 *    result, tapping a favourite, and any route added later. Tying it to the play button meant
 *    the browse path reported `playing` and stayed silent.
 *  - **The registration has to be released.** `DELETE /destinations/local/{id}` on teardown, so
 *    closing the tab does not leave a phantom speaker in the list.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SendspinPlayer } from '@sendspin/sendspin-js';
import { useApi } from '@/state/ServerContext';
import { ApiError } from '@/api/client';
import type { ApiAudioFormat, ApiLocalDestination, ApiZoneState } from '@/api/types';

/** Where the reclaimable client id lives. Per browser, which is the right scope for "this tab". */
const CLIENT_ID_KEY = 'sonn.player.localClientId';

/**
 * What this destination is called in everyone else's list, when the user gives no name.
 *
 * Named for the *device*, not the software: in a rooms list alongside "Kitchen" and "Study",
 * "This phone" says what will make the sound, and "This browser" is only right where that word
 * means something — a desk. The art face's phone breakpoint (979px) is the same line drawn here,
 * read once at module load: a registration keeps its name for its lifetime, and a window resized
 * across the boundary mid-session is a desk being narrowed, not a phone appearing.
 */
const DEFAULT_NAME = window.matchMedia?.('(max-width: 979px)').matches ? 'This phone' : 'This browser';

/** How long to wait for the audio socket before calling it a failure. */
const CONNECT_TIMEOUT_MS = 8000;

/**
 * How long a teardown waits before actually releasing the registration.
 *
 * Long enough for a synchronous remount (StrictMode, a hot reload) to re-claim the reference,
 * short enough that a genuinely closed tab does not linger in anyone's destination list. The
 * server also expires a registration once its socket closes, so this is belt-and-braces.
 */
const RELEASE_GRACE_MS = 1000;

/**
 * `ws://host:7090/sendspin` -> `http://host:7090`.
 *
 * The registration hands back the socket url; the Sendspin client wants the http origin it will
 * append `/sendspin` to itself. Converting the server's own answer keeps this right behind a
 * dev proxy or on a different host, where deriving it from `window.location` would not be.
 */
function streamUrlToBaseUrl(streamUrl: string): string {
  const url = new URL(streamUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  return url.toString().replace(/\/+$/, '');
}

/** Rejects if `promise` has not settled in time, so a dead socket cannot hang the UI. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What this browser is playing, as the Sendspin socket reports it.
 *
 * Deliberately *not* an `ApiZoneState`: a local destination is absent from `/zones` and from the
 * event stream by design, so there is no zone object to read. The socket already carries title,
 * artist, album, artwork and progress as `server/state`, and that is the one source that cannot
 * disagree with the audio it is delivering.
 */
export type LocalNowPlaying = {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  /** Seconds. */
  position: number;
  /** Seconds; 0 when open-ended or unknown. */
  duration: number;
  state: 'playing' | 'paused' | 'stopped';
};

/**
 * The local destination as an `ApiZoneState`, so the rest of the app can treat it as a room.
 *
 * It genuinely is one: *"every zone route still works on a local destination — because it is a
 * zone underneath"*. It is only missing from the **listings**, which is a visibility rule rather
 * than a difference in kind. So rather than building a second set of components that can only
 * display it, the one thing the listing would have given us is reconstructed here and the zone is
 * selectable, controllable and browsable-to exactly like the hardware rooms.
 *
 * The fields that a real zone event would carry and this cannot know are set to honest defaults,
 * not invented values: no group (a tab does not group), and volume from the socket's `server/state`
 * controller field — the server's zone volume, not the client's output gain, which is a different
 * number that never moves. `output.protocol` is `sendspin` because that is what carries the audio.
 */
export function toLocalZone(
  destination: ApiLocalDestination,
  np: LocalNowPlaying | null,
  volume: number,
  format: ApiAudioFormat | null,
): ApiZoneState {
  return {
    // The destination id *is* the zone id, which is what makes every zone route work on it.
    id: Number(destination.id),
    name: destination.name,
    state: np?.state ?? 'stopped',
    powerState: { power: 'on', target: 'on', managed: false, idleTimeoutMs: null },
    position: np?.position ?? 0,
    duration: np?.duration ?? 0,
    volume,
    // A browser has no configured cap; the server applies none to a local destination.
    volumeLimits: { max: 100, default: volume, step: 5 },
    repeat: 'off',
    shuffle: false,
    track: np?.title
      ? { title: np.title, artist: np.artist, album: np.album, coverUrl: np.coverUrl, colors: null }
      : null,
    // No `source`: the socket reports what is playing but not an opaque provider id for it, and
    // inventing one would break the "hand it back to play" contract that id carries.
    source: null,
    group: null,
    output: { protocol: 'sendspin', name: destination.name },
    // The real negotiated format, read off the player rather than assumed — this is exactly the
    // "what is this device actually receiving" question the field exists to answer, and here the
    // device is the browser.
    format,
  };
}

/** Projects the Sendspin payloads onto the shape the UI renders. */
function toNowPlaying(
  serverState: { metadata?: { title?: string | null; artist?: string | null; album?: string | null; artwork_url?: string | null; progress?: { track_progress: number; track_duration: number } | null } } | undefined,
  groupState: { playback_state?: string } | undefined,
  isPlaying: boolean,
  trackProgress: { positionMs: number; durationMs: number } | null,
): LocalNowPlaying | null {
  const meta = serverState?.metadata;
  const playback = groupState?.playback_state;
  const state: LocalNowPlaying['state'] =
    isPlaying ? 'playing' : playback === 'paused' ? 'paused' : 'stopped';
  if (!meta?.title && state === 'stopped') {
    return null;
  }
  // The player calculates real-time progress from the synchronized stream anchors. The metadata
  // progress is only a server snapshot and can be absent for a local browser destination, so use
  // the player value first and retain the metadata value as a fallback.
  const progress = trackProgress
    ? { positionMs: trackProgress.positionMs, durationMs: trackProgress.durationMs }
    : meta?.progress
      ? { positionMs: meta.progress.track_progress, durationMs: meta.progress.track_duration }
      : null;
  return {
    title: meta?.title ?? '',
    artist: meta?.artist ?? '',
    album: meta?.album ?? '',
    coverUrl: meta?.artwork_url ?? '',
    position: progress ? Math.round(progress.positionMs / 1000) : 0,
    duration: progress ? Math.round(progress.durationMs / 1000) : 0,
    state,
  };
}

/**
 * What this hook exposes: one zone, and nothing else.
 *
 * Deliberately narrow. There is no enable button, no local volume slider and no connection badge,
 * because the browser is a *room* — so the ordinary zone UI already controls it. Volume in
 * particular is the server's: `PUT /zones/{id}/volume` works on a local destination and the server
 * relays it to the client over the socket, so the player's own slider is the one that matters and a
 * second one beside it would be two controls for one thing.
 *
 * Connecting is not exposed either; it happens on the first user gesture anywhere on the page.
 */
export type LocalPlaybackState = {
  /**
   * This browser as an ordinary zone, once registered. Null before that.
   *
   * Merge it into the zone list and every existing component works on it — see `toLocalZone`.
   */
  zone: ApiZoneState | null;
};

/**
 * The one in-flight registration, shared by every mount of this hook.
 *
 * Module scope rather than a ref, because the whole point is to survive a component being torn
 * down and re-created — which is exactly what StrictMode and a hot reload do. There is only ever
 * one browser to register, so one registration is the correct cardinality.
 */
let registration: Promise<ApiLocalDestination> | null = null;
let registrationRefs = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The live playback state, shared by every mount.
 *
 * There is one browser and one audio socket, so there is one state — but this hook is called from
 * more than one component (`App` for the room list, `Transport` for the play press). Per-component
 * `useState` gave each its own copy: `Transport` connected the socket and `App` never heard about
 * it, so the room stayed "Available here" while audio played. A tiny module-level store with
 * subscribers is the honest shape for something genuinely global.
 */
type LiveState = {
  connected: boolean;
  playing: boolean;
  volume: number;
  busy: boolean;
  error: string | null;
  nowPlaying: LocalNowPlaying | null;
  format: ApiAudioFormat | null;
  destination: ApiLocalDestination | null;
};

/** The connected player, module-level for the same reason `live` is: there is only one socket. */
let activePlayer: SendspinPlayer | null = null;

let live: LiveState = {
  connected: false,
  playing: false,
  volume: 100,
  busy: false,
  error: null,
  nowPlaying: null,
  format: null,
  destination: null,
};

const liveListeners = new Set<() => void>();

function subscribeLive(notify: () => void): () => void {
  liveListeners.add(notify);
  return () => liveListeners.delete(notify);
}

function getLive(): LiveState {
  return live;
}

function setLive(patch: Partial<LiveState>): void {
  live = { ...live, ...patch };
  for (const notify of liveListeners) {
    notify();
  }
}

function readStoredClientId(): string | undefined {
  try {
    return window.localStorage.getItem(CLIENT_ID_KEY) ?? undefined;
  } catch {
    // Private-mode Safari throws. A fresh registration still works; it just orphans one.
    return undefined;
  }
}

function storeClientId(clientId: string): void {
  try {
    window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  } catch {
    // Not persisting only costs an orphan on the next reload.
  }
}

export function useLocalPlayback(): LocalPlaybackState {
  const api = useApi();
  // One shared snapshot, so `App` and `Transport` see the same socket rather than two copies.
  const snapshot = useSyncExternalStore(subscribeLive, getLive, getLive);
  const { volume, nowPlaying, format } = snapshot;

  /**
   * The registration and the un-connected player, prepared on mount.
   *
   * Everything that needs the network happens here so that `enable()` — which runs inside a
   * click — can reach `unlock()` without awaiting anything first. `ready` is what the button
   * waits for; until it resolves there is nothing to unlock.
   */
  const [ready, setReady] = useState<{
    player: SendspinPlayer;
    registered: ApiLocalDestination;
  } | null>(null);

  /**
   * Holds the latest `enable`, so the gesture listener below does not have to be re-registered
   * every time that closure changes — re-registering a `once` listener is how you end up
   * consuming the gesture on a stale one.
   */
  const enableRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Connect on the **first user gesture anywhere on the page**, whatever it was.
   *
   * `unlock()` is only two calls — create the AudioContext and `resume()` it — and the library
   * already does both itself when `stream/start` arrives. The reason it cannot be left to that is
   * narrow: a `resume()` triggered by an incoming network message has no gesture behind it, and
   * the browser refuses it. So a gesture is needed, but it does not have to be a *particular*
   * gesture.
   *
   * Tying it to the play button was the bug: clicking a search result is also a gesture, and that
   * path never connected — the server reported `playing` while the tab stayed silent. Listening
   * once at the document covers every route into playback, including ones not written yet.
   */
  useEffect(() => {
    if (live.connected || live.busy) {
      return;
    }
    const onGesture = (): void => {
      void enableRef.current?.();
    };
    // `once` on each: the first gesture is all that is needed, and pointerdown fires before the
    // click that may follow it.
    document.addEventListener('pointerdown', onGesture, { once: true });
    document.addEventListener('keydown', onGesture, { once: true });
    return () => {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, [snapshot.connected, snapshot.busy]);

  useEffect(() => {
    let cancelled = false;
    let created: { player: SendspinPlayer; registered: ApiLocalDestination } | null = null;

    // One registration, shared by every mount rather than made per mount.
    //
    // StrictMode mounts each effect twice, and both attempts reclaim the same stored `clientId`
    // and so are handed the *same* destination id — after which the first cleanup deletes what
    // the second is using and the destination disappears. A hot reload does the same. Sharing the
    // in-flight promise is half the fix; the deferred release below is the other half.
    registrationRefs += 1;
    registration ??= api.registerLocalDestination(DEFAULT_NAME, readStoredClientId());

    void (async () => {
      try {
        // The server issues the authoritative id; a stored one is only a request to reclaim it.
        const registered = await registration;
        storeClientId(registered.clientId);
        if (cancelled) {
          return;
        }
        const player = new SendspinPlayer({
          // From the registration, not locally invented: the server expects exactly this id in
          // the Sendspin `client/hello`.
          playerId: registered.clientId,
          clientName: registered.name,
          // `streamUrl` is a ws:// address for the socket itself, while the library wants an
          // http(s) origin it appends `/sendspin` to. Converting the server's answer rather than
          // deriving one from our own origin is what keeps this right behind a dev proxy or on
          // another host — the server built that url from the address our request arrived on.
          baseUrl: streamUrlToBaseUrl(registered.streamUrl),

          // PCM only. Opus decoding in the browser is ~250KB of WASM and stutters under load —
          // the same conclusion the previous player reached independently — while PCM goes
          // straight to the AudioContext with no decode step at all.
          //
          // The Opus chunks are still *built* (the library imports them statically), but they are
          // lazy and verified never to be requested at runtime with this set, so the decode cost
          // is gone even though the bundle size is not.
          codecs: ['pcm'],

          // `quality-local` rather than the default `sync`. `sync` exists to keep several
          // devices in step and pays for it with continuous ±0.5% playback-rate corrections; a
          // lone browser has nothing to stay in step *with*, so that machinery is all cost.
          correctionMode: 'quality-local',

          // A browser is a hostile place to schedule audio: the tab competes with rendering, GC
          // and every other tab, and the default 250ms of jitter buffer is thin enough that one
          // scheduling hiccup underruns it. A second of buffer trades latency — which nobody
          // notices on a single unsynced player — for not stuttering.
          requiredLeadTimeMs: 500,
          minBufferMs: 1000,

          // Room for that buffer to actually exist. In `direct` output mode (what a desktop
          // browser gets) the library defaults to 1.5MB, and a second of 44.1kHz/16-bit stereo
          // PCM is ~176KB — fine on paper, but the ceiling also has to absorb bursts, and a
          // 192kHz/24-bit stream is ~1.1MB/s, where 1.5MB is barely over a second in total.
          bufferCapacity: 6 * 1024 * 1024,

          onStateChange: (state) => {
            // Volume comes from the socket's controller field, not from `state.volume` — that
            // second one is the client's own gain, which nothing sets and which sits at 1.0, so
            // reading it pinned the slider to 100 while the zone was at 30.
            //
            // It is still not wholly reliable: the server does not relay every volume change to a
            // sendspin client, so the slider can lag the API. Taking
            // whatever the socket last said is the best a client can do, since a local destination
            // gets no `zone.changed` to cross-check against.
            const serverVolume = state.serverState?.controller?.volume;
            setLive({
              playing: state.isPlaying,
              ...(typeof serverVolume === 'number' ? { volume: Math.round(serverVolume) } : {}),
            });
            // What is playing comes from the Sendspin socket, not from the event stream — a
            // local destination is deliberately absent from `/zones` and from events, and this
            // socket is the source that cannot be out of step with the sound it is carrying.
            setLive({
              nowPlaying: toNowPlaying(
                state.serverState,
                state.groupState,
                state.isPlaying,
                player.trackProgress,
              ),
            });
            // `currentFormat` is what `stream/start` negotiated for this socket.
            const f = player?.currentFormat ?? null;
            setLive({ format:
              f
                ? {
                    // Sendspin's wire shape is snake_case; the HTTP API's is camelCase, and the
                    // UI speaks the latter.
                    bitPerfect: false,
                    dspApplied: false,
                    source: null,
                    output: {
                      codec: f.codec,
                      sampleRate: f.sample_rate,
                      bitDepth: f.bit_depth ?? 16,
                      channels: f.channels,
                      bitrate: null,
                      highRes: f.sample_rate > 48000 || (f.bit_depth ?? 16) > 16,
                    },
                  }
                : null });
          },
        });
        created = { player, registered };
        setReady(created);
      } catch (err) {
        if (!cancelled) {
          setLive({ error: err instanceof ApiError ? err.code : (err as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
      created?.player.disconnect();
      registrationRefs -= 1;

      // Released on a delay, not immediately.
      //
      // Refcounting alone cannot work here: StrictMode tears down and re-mounts *sequentially*,
      // so the count legitimately touches zero in between and an eager release would delete the
      // registration the next mount is about to adopt. Deferring lets that remount re-claim the
      // reference first; only a teardown that is still at zero when the timer fires is a real
      // unmount. `keepalive` is not an option — this is not a page-unload path.
      if (releaseTimer !== undefined) {
        clearTimeout(releaseTimer);
      }
      releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        if (registrationRefs > 0) {
          return;
        }
        const pending = registration;
        registration = null;
        void pending
          ?.then((registered) => api.unregisterLocalDestination(registered.id))
          .catch(() => undefined);
      }, RELEASE_GRACE_MS);
    };
  }, [api]);

  /**
   * Starts playing here. **Must be called straight from a click handler.**
   *
   * `unlock()` is the first awaited call, which is the whole point of the split above: a browser
   * honours the gesture only until the handler awaits something else, so a registration fetch in
   * front of it produces a connected player that receives frames and makes no sound.
   */
  const enable = useCallback(async () => {
    if (activePlayer || !ready) {
      return;
    }
    setLive({ busy: true });
    setLive({ error: null });
    try {
      await ready.player.unlock();
      // Bounded: a socket that never answers (a missing proxy, a firewalled port) would
      // otherwise leave this stuck on "Connecting…" with no way back.
      await withTimeout(ready.player.connect(), CONNECT_TIMEOUT_MS, 'sendspin-connect-timeout');
      activePlayer = ready.player;
      setLive({ destination: ready.registered, connected: ready.player.isConnected });
    } catch (err) {
      setLive({ error: err instanceof ApiError ? err.code : (err as Error).message });
    } finally {
      setLive({ busy: false });
    }
  }, [ready]);

  // Keep the gesture listener pointed at the current closure.
  enableRef.current = enable;

  // Release on unmount. Without this a hot reload or a navigation leaves a phantom speaker in
  // everyone else's destination list until it times out.
  useEffect(() => {
    return () => {
      activePlayer?.disconnect();
      activePlayer = null;
    };
  }, []);

  return {
    zone:
      // Present from registration, not from connection. The registration happens on mount, so the
      // browser appears among the rooms with no click at all — and `enable()` is what a play
      // gesture triggers on it, rather than a separate setup step the user has to find.
      ready?.registered
        ? toLocalZone(ready.registered, nowPlaying, volume, format)
        : null,
  };
}
