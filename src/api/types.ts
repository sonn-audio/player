/**
 * The `/api/v1` wire contract, as this client consumes it.
 *
 * A hand-kept mirror of the server's own `ApiZoneState` and friends. It is
 * duplicated rather than imported because the point of this player is to prove the
 * published contract is sufficient on its own: if a field only makes sense with the
 * server's source tree open next to you, that is a finding, not something to paper
 * over with a shared import.
 *
 * Two rules from the contract shape everything below:
 *
 *  - **Additive only.** New fields and new `kind`/`icon`/event `type` values are not
 *    breaking, so every union here is treated as open — see `ApiSourceKind`. A value we
 *    have never heard of must render as "something", never throw.
 *  - **`null` means absent.** The server uses `null` instead of empty-string sentinels,
 *    so `if (zone.track)` is the whole idle check.
 */

/** Playback state. */
export type ApiPlaybackState = 'playing' | 'paused' | 'stopped';

/** Repeat strategy. */
export type ApiRepeatMode = 'off' | 'one' | 'all';

/**
 * Where the audio comes from.
 *
 * `(string & {})` keeps the known values autocompleting while still accepting one the
 * server added after this file was written — the contract explicitly reserves the right
 * to add kinds, and `unknown` is its placeholder for clients that must not fail on them.
 */
export type ApiSourceKind =
  | 'track'
  | 'radio'
  | 'playlist'
  | 'linein'
  | 'airplay'
  | 'spotify'
  | 'bluetooth'
  | 'unknown'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** What is currently playing. `null` on the zone when nothing is loaded. */
export interface ApiTrack {
  title: string;
  artist: string;
  album: string;
  /** Absolute URL, or empty string when there is no artwork. */
  coverUrl: string;
  animatedCoverUrl?: string;
  colors: {
    primary: [number, number, number];
    accent: [number, number, number];
    backgroundDark: [number, number, number];
    backgroundLight: [number, number, number];
    onDark: [number, number, number];
    onLight: [number, number, number];
  } | null;
}

/** Which source the current audio came from. */
export interface ApiSource {
  kind: ApiSourceKind;
  /**
   * Whether `PUT /zones/{id}/position` does anything. False for a live stream.
   * Read this rather than inferring it from `duration === 0`.
   */
  seekable: boolean;
  /** Human-readable label: station name, service name, input name. */
  name: string;
  /**
   * Opaque provider-native id. Safe to store and hand back to `play`; never parse it.
   * Absent on sources that cannot be restarted by id.
   */
  id?: string;
}

/** What a zone's volume will actually accept. */
export interface ApiVolumeLimits {
  /** Highest volume this zone will go to. Render sliders against this, not 100. */
  max: number;
  /** Level the zone returns to when it powers on. */
  default: number;
  /** How far one remote-style step should move. */
  step: number;
}

/** Sync-group membership. `null` when the zone plays alone. */
export interface ApiGroup {
  leader: number;
  /** All members, leader first. */
  members: number[];
}

/** How a zone reaches its speakers. */
export interface ApiOutput {
  /** e.g. `sendspin`, `snapcast`, `googlecast`, `dlna`, `sonos`, `airplay`. Open set. */
  protocol: string;
  name?: string;
  /**
   * The specific device, when the protocol identifies one. Reported whether or not the
   * zone is playing and whether or not the device is reachable, so `connected` is the
   * live link state while `id` stays put.
   */
  device?: {
    id: string | null;
    name: string | null;
    connected: boolean;
  };
  capabilities?: ApiOutputCapabilities | null;
  /**
   * How this zone's audio is timed against the device, for protocols with a clock agreement.
   *
   * Null or absent means the protocol cannot say — **not** that it is out of sync. An output that
   * hands bytes to a renderer has no shared clock to report on.
   */
  sync?: ApiOutputSync | null;
}

/**
 * The timing relationship with the device.
 *
 * `state` and `delayMs` are the agreement — the device says whether it locked onto the shared
 * clock, and `delayMs` is the offset deliberately dialled in for it (settable via
 * `PUT /zones/{id}/output/delay`). The rest measures how well the server holds its end up, and is
 * null while nothing streams because it describes a stream in flight.
 *
 * Read `leadMs` against the **band** `[targetLeadMs, targetLeadMs + leadMarginMs]`. The sender fills
 * the band and then waits, so per-frame leads sweep all of it and a lead near the top is healthy —
 * comparing against the target alone makes a by-design 100 ms look like trouble. What says it is
 * *healthy* is `leadMinMs`, the floor: while it holds at or above the target the player never runs
 * out of audio. A `driftMs` that keeps growing is a slipping timeline.
 */
export interface ApiOutputSync {
  state: 'synchronized' | 'error' | 'external_source' | 'unknown';
  /**
   * Delay this device's chain adds *after* its audio output — an amp, an active speaker.
   * Raising it makes the room play **earlier**, because the client subtracts it from each timestamp.
   *
   * What the server asked for. `deviceDelayMs` is what the device last said it has.
   */
  delayMs: number;
  /**
   * The delay the device last declared, or null if it never has.
   *
   * Not a confirmation signal, and not worth showing as one: the device applies the command straight
   * away — that is how the protocol works — and simply does not mention the value until the next
   * state message it sends for some other reason. So this trails `delayMs` after every write, and a
   * display built on the difference tells you only that you just changed something.
   *
   * It is here because it is a different fact: a device configured elsewhere can hold a value nobody
   * asked it for (an installer's offset for the amplifier it is wired to). Whether a device accepts
   * the command at all is a separate question, answered by its advertised `supported_commands` rather
   * than by watching this number.
   */
  deviceDelayMs: number | null;
  /** The bottom of the band frames are scheduled in. */
  targetLeadMs: number;
  /** How far above it the sender may run before it backpressures. */
  leadMarginMs: number;
  leadMs: number | null;
  /** The lowest lead in the last couple of seconds. Healthy while it holds at or above the target. */
  leadMinMs: number | null;
  driftMs: number | null;
}

/**
 * What the device on the other end can do.
 *
 * Named rather than inline because a consumer needs to accept it on its own: the analysis display
 * takes `visualizer` to decide what to ask the stream for, instead of hardcoding a rate the device
 * may not support.
 */
export interface ApiOutputCapabilities {
  formats: Array<{ codec: string; sampleRate: number; bitDepth: number; channels: number }>;
  roles: string[];
  visualizer: {
    types: string[];
    /** Samples per second the device can sustain. A ceiling, not a suggestion. */
    rateMax: number;
    spectrum: { bins: number; scale: string; fMin: number; fMax: number } | null;
  } | null;
}

/**
 * What a zone is streaming right now.
 *
 * The audio **as it leaves the server**, not the file's own format: a zone whose output cannot
 * take 192 kHz gets it resampled, and this reports what the device actually receives. So two
 * zones playing the same track legitimately disagree — here a squeezelite zone gets
 * `flac/44100/16` while a sendspin one gets `pcm/48000/24`.
 */
export interface ApiStreamFormat {
  /** `pcm`, `flac`, `mp3` — the encoding on the wire to the device. */
  codec: string;
  /** Hz, e.g. 44100 or 192000. */
  sampleRate: number;
  /** Bits per sample, e.g. 16 or 24. */
  bitDepth: number;
  channels: number;
  /**
   * Bits per second, or null when there is nothing to report yet.
   *
   * Observed to be a **live measurement rather than a property**: it is null on the first
   * event of a stream and then moves every second as the encoder's output varies. Treat it as
   * a reading, not a spec — which is why the UI rounds it to kbps and does not animate it.
   */
  bitrate: number | null;
  highRes: boolean;
}

/**
 * Every way the server can alter the audio, named.
 *
 * `dspApplied` says *whether* something happened; this says what. Added to the contract for this
 * player: a chain that might have resampled, requantised, gained, delayed, equalised or re-encoded
 * reported as one boolean is exactly the vagueness a technical readout exists to remove.
 *
 * Produced server-side by the object that builds the ffmpeg command line, from the same inputs — so a
 * stage cannot claim to be absent while its filter is on the command line. `null` means the engine
 * cannot say (an older server, or a zone streaming nothing), which is *not* the same as an empty chain
 * and must not be rendered as "nothing happened".
 *
 * Deliberately absent: the zone's volume. That is applied at the device, not in this pipeline.
 */
export interface ApiProcessingChain {
  /** The resampler ran: rate, channels or depth changed, or a filter forced the path. */
  resampled: boolean;
  /** Which resampler and how it was configured, when it ran. */
  resampler: { name: string; precision: number; cutoff: number } | null;
  /** The sample depth changed — the source declared one and the output carries another. */
  requantised: boolean;
  /** The channel count changed: a downmix or an upmix. */
  channelsRemapped: boolean;
  /** The output codec re-encodes rather than carrying samples (`aac`, `mp3`, `opus`). */
  reencoded: boolean;
  /** The zone's 10-band equalizer, when any band is off zero. Gains in dB, low band first. */
  equalizer: { bands: number[] } | null;
  /** Gain in dB by origin: the source's own loudness normalisation and the output's fixed trim. */
  gainDb: { source: number; output: number } | null;
  /** Pre-delay in ms, for aligning this source against another output. */
  delayMs: number | null;
  /** True while a crossfade is blending, which requantises by definition. */
  crossfading: boolean;
}

export interface ApiAudioFormat {
  bitPerfect: boolean;
  dspApplied: boolean;
  source: ApiStreamFormat | null;
  output: ApiStreamFormat | null;
  /** What was done to the audio, stage by stage. Null when the server cannot say. */
  processing?: ApiProcessingChain | null;
}

/** A zone. The payload of `GET /zones`, and of every `zone.changed` event. */
export interface ApiZoneState {
  id: number;
  name: string;
  state: ApiPlaybackState;
  powerState: {
    power: 'on' | 'off';
    target: 'on' | 'off';
    managed: boolean;
    idleTimeoutMs: number | null;
  };
  /** Whole seconds into the current track. */
  position: number;
  /** Whole seconds; 0 when open-ended (live radio). */
  duration: number;
  volume: number;
  volumeLimits: ApiVolumeLimits;
  repeat: ApiRepeatMode;
  shuffle: boolean;
  track: ApiTrack | null;
  source: ApiSource | null;
  group: ApiGroup | null;
  output: ApiOutput | null;
  /** What is on the wire to the device, or null when the zone streams nothing. */
  format: ApiAudioFormat | null;
  /**
   * Why the last playback attempt failed, when it did. Absent on a healthy zone.
   *
   * This is what makes `play`'s `204` survivable. Resolution is asynchronous — the call is
   * accepted before anything has been looked up — so a synchronous error is impossible; the
   * failure instead arrives here on a `zone.changed`. Reasons are meaningful (`Sign-in
   * required`, `Output unavailable`), and it lands beside `track: null` rather than inside
   * `track.title`, so `if (zone.track)` stays a truthful idle check.
   */
  error?: string;
}

/** One entry in a zone's queue. `id` identifies the *entry*, not the track. */
export interface ApiQueueItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  coverUrl: string;
  animatedCoverUrl?: string;
  /** Opaque provider id, as on `ApiSource.id`. */
  source: string;
}

/** A page of a queue. `total` is the whole queue, so you know whether to ask for more. */
export interface ApiQueue {
  zoneId: number;
  items: ApiQueueItem[];
  start: number;
  total: number;
  /** Index of the entry playing now, or null. */
  currentIndex: number | null;
}

/** One of a zone's favourites. `id` is the handle for play/rename/reorder/remove. */
export interface ApiFavorite {
  id: number;
  name: string;
  source: string;
  coverUrl: string;
}

export interface ApiFavorites {
  zoneId: number;
  items: ApiFavorite[];
  start: number;
  total: number;
}

/**
 * Something a zone played before. Read-only apart from clearing — there is no handle
 * to rename or reorder, only enough to show it and play it again.
 */
export interface ApiRecentItem {
  source: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  /** Which service it came from; empty when local. */
  service: string;
}

export interface ApiRecents {
  zoneId: number;
  items: ApiRecentItem[];
  start: number;
  total: number;
}

/**
 * The result of a group change — 200 with a body, not 204, because what you asked for
 * is not always what you get: grouping needs matching output protocols unless the
 * server allows mixed groups, and a member that could not join says why.
 */
export interface ApiGroupResult {
  leader: number;
  members: number[];
  rejected: Array<{ id: number; reason: 'protocol-mismatch' | 'zone-not-found' }>;
}

/** A configured physical input any zone can be switched to. */
export interface ApiInput {
  /** Opaque. Hand back to `PUT /zones/{id}/input`; also what `source.id` reports. */
  id: string;
  name: string;
  /** Icon hint. Open set — never switch exhaustively on it. */
  icon: ApiInputIcon;
  /**
   * Whether this input answers transport commands once a zone is on it. False for a
   * turntable or bare jack, where selecting it is the whole interaction.
   */
  controllable: boolean;
  /** Whether the input reports what is playing, so `track` can be more than blank. */
  reportsMetadata: boolean;
}

export type ApiInputIcon =
  | 'line-in'
  | 'cd-player'
  | 'computer'
  | 'imac'
  | 'ipod'
  | 'mobile'
  | 'radio'
  | 'screen'
  | 'turntable'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/**
 * Somewhere audio can be sent.
 *
 * A zone is one kind, but the server does not require zones at all — and a client can be the
 * thing that plays, with no zone configured anywhere. A destination's `id` **is** its zone id
 * where it has one, so the two surfaces address the same thing.
 *
 * Transport (`play`, `pause`, `volume`, …) works identically on both. What only a configured
 * zone has — grouping, favourites, recents, the queue — stays on `/zones/…`, because a local
 * destination cannot honour it.
 */
export interface ApiDestination {
  id: string;
  name: string;
  /** `zone` for a configured zone, `local` for a client playing audio itself. Open set. */
  kind: 'zone' | 'local' | (string & {});
  protocol: string;
  available: boolean;
}

/**
 * A registered local destination — this tab, as somewhere audio can be sent.
 *
 * `clientId` is the handle to announce over Sendspin, and the value to pass back on a later
 * registration to **reclaim the same one**. Without that, every page reload leaves an orphan
 * behind until it times out.
 */
export interface ApiLocalDestination extends ApiDestination {
  kind: 'local';
  clientId: string;
  /** Built from the address the request arrived on, so it is reachable from where you are. */
  streamUrl: string;
}

/** A zone's 10-band equalizer, in dB per ISO band, low band first. */
export interface ApiZoneEqualizer {
  zoneId: number;
  bands: number[];
}

export interface ApiPlaylist {
  id: string;
  name: string;
  tracks: number;
  coverUrl?: string;
}

/** Kinds of interruption `POST /zones/{id}/alert` accepts. */
export type ApiAlertKind = 'tts' | 'bell' | 'alarm' | 'fire' | 'buzzer' | 'url';

export interface ApiAlertRequest {
  kind: ApiAlertKind;
  /** What to say. Required for `tts`. */
  text?: string;
  /** Language hint for `tts`, e.g. `nl`. Defaults to the server's. */
  language?: string;
  /** What to play. Required for `url`. */
  url?: string;
  /** Extra zones to announce in at the same time; the path zone leads. */
  zones?: number[];
  /** Overrides the zone's configured alert volume for this announcement only. */
  volume?: number;
}

export interface ApiHealthReport {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  /** Counts from when the server last became *ready*, not from process start. */
  uptimeSec: number;
  phase: string;
  /** Keyed by a stable `name`; branch on that, not on the prose `detail`. */
  checks: Array<{ name: string; status: 'ok' | 'degraded' | 'unhealthy'; detail?: string }>;
}

export interface ApiReadyReport {
  ready: boolean;
  phase: 'starting' | 'ready' | 'failed';
  error?: string;
}

// --- events -----------------------------------------------------------------

/** Opens every SSE connection, so a client can render before the first change. */
export interface ApiServerSnapshotEvent {
  type: 'server.snapshot';
  zones: ApiZoneState[];
}

/** Carries the **complete** zone, never a patch. */
export interface ApiZoneChangedEvent {
  type: 'zone.changed';
  zone: ApiZoneState;
}

/**
 * The one event that is not a whole zone: while a track plays and nothing but the clock
 * moved, only the position is sent. A client that ignores this stays correct — its
 * progress bar just updates a beat later.
 */
export interface ApiZoneProgressEvent {
  type: 'zone.progress';
  id: number;
  position: number;
}

/**
 * A zone's queue changed — someone appended, reordered, removed or cleared.
 *
 * Deliberately *not* the queue itself: a queue is paged and can hold thousands of entries, so
 * this says "yours is stale, and it now has `size` entries" and leaves the re-read to a client
 * that knows which page it is showing. `size` alone is enough to update a count without
 * fetching anything.
 */
export interface ApiQueueChangedEvent {
  type: 'queue.changed';
  /** Zone id. */
  id: number;
  /** Length of the whole queue after the change. */
  size: number;
}

/** A zone's favourites changed. Same reasoning as `queue.changed`. */
export interface ApiFavoritesChangedEvent {
  type: 'favorites.changed';
  id: number;
  count: number;
}

/** A zone's recently-played changed — something new started, or history was cleared. */
export interface ApiRecentsChangedEvent {
  type: 'recents.changed';
  id: number;
}

/**
 * An event `type` this build does not know. The contract says new types are additive, so
 * they arrive here and are ignored rather than crashing the reducer.
 */
export interface ApiUnknownEvent {
  type: string;
}

export type ApiEvent =
  | ApiServerSnapshotEvent
  | ApiZoneChangedEvent
  | ApiZoneProgressEvent
  | ApiQueueChangedEvent
  | ApiFavoritesChangedEvent
  | ApiRecentsChangedEvent
  | ApiUnknownEvent;
