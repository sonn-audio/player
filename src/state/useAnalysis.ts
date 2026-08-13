/**
 * The live audio analysis stream, and the maths for drawing it.
 *
 * `GET /zones/{id}/analysis` is an SSE feed. The subscription is **refcounted per zone** rather than
 * owned by a component: there is one stream per room no matter how many things watch it, and the
 * peak-hold decay is advanced in one place, so two displays of the same audio cannot disagree about
 * it. `useLocalPlayback` shares the one audio socket the same way.
 *
 * Today the spectrum in the now-playing view is the only subscriber — an earlier attempt drew a
 * second copy behind the equalizer, which is why this was extracted, and the equalizer is now an
 * overlay on the first one instead. What the equalizer still uses from here is the frequency maths:
 * `spectrumPosition` is how its handles land on the right part of the display, and the constants below
 * are the only statement anywhere of what geometry the stream actually carries.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';

/**
 * How a held peak behaves: hang, then fall.
 *
 * It used to lose 0.022 of the height *per painted frame*, which at 60 fps is 1.3 of a 0-1 scale every
 * second — a full-scale peak gone in three quarters of a second, and in practice the marker glued to
 * the top of its own bar. Measured live before this: the held value sat 2% above the current one, so
 * the display had a peak-hold that never held anything.
 *
 * Hardware analysers hang the marker still for a moment and then let it sink slowly, which is what
 * makes a transient readable after the bar under it has dropped. Both numbers are in wall-clock time
 * rather than in frames, so the behaviour does not change with the paint rate.
 */
const PEAK_HOLD_MS = 700;
const PEAK_FALL_PER_SEC = 0.45;

/**
 * Meter ballistics: how the drawn level chases the measured one.
 *
 * The wire delivers a discrete reading every 30–100 ms, whatever the device's rate allows, and a
 * display that simply steps to each one is a slideshow of a meter — the slower the device, the
 * worse the flipbook. Hardware meters never had this problem because a needle has mass: it leaps
 * toward a transient and *falls* with weight. These two time constants are that mass, applied
 * every animation frame between events: rise fast enough to feel instant without arriving as a
 * step, fall slow enough that a drumbeat leaves a wake instead of a blink. Wall-clock based, so a
 * 30 fps panel and a 144 Hz monitor draw the same motion.
 */
const RISE_TAU_MS = 35;
const FALL_TAU_MS = 190;

/**
 * When a chasing value is allowed to arrive, as a fraction of full scale.
 *
 * An exponential approach never quite lands; below this distance it is snapped to its target so a
 * silent display truly goes quiet — and, more to the point, so the loop can stop publishing.
 * Renders happen only while something is visibly moving; a room playing silence costs nothing.
 */
const SETTLE_FRACTION = 0.002;

/**
 * The longest a sample may be held back to line it up with the audio.
 *
 * On the presentation timeline an event's stamp says when its audio will be *heard*, which for
 * Sendspin is about 250 ms ahead of when the event arrives — so drawing on arrival puts the meter a
 * quarter of a second in front of the music. Holding each sample until its moment fixes that, but
 * the delay is only ever as trustworthy as the clock estimate behind it. Past this bound something
 * is wrong (a server that restarted and reset its monotonic origin, a sleeping tab, a zone whose
 * renderer buffers seconds), and a display that is late by seconds is worse than one that is early
 * by a fraction: beyond this the sample is drawn immediately.
 */
const MAX_ALIGN_DELAY_MS = 1500;

/**
 * The geometry `/zones/{id}/analysis` bins and scales by.
 *
 * Read off the stream: `analysis.ready` states `spectrum` (the same `f_min`/`f_max`/`scale` the
 * server binned by), `floorDb` and `fullScale`. These values are the fallback for the moment
 * before that first event arrives, and they are the *only* place a number is assumed.
 *
 * They used to be the whole story — copied from the server by hand, because the stream did not
 * announce its own shape. That is a drift waiting to happen, and one already had: reading the axis
 * off `output.capabilities.visualizer.spectrum` (`mel, 20–20000`, which describes what a Sendspin
 * client's own visualizer gets, not this stream) put 1 kHz at 26% of the width where it belongs at
 * 54%. Now the stream says, and this follows.
 */
const DEFAULT_GEOMETRY = { fMin: 40, fMax: 16000, floorDb: -60, fullScale: 65535 };

let geometry = { ...DEFAULT_GEOMETRY };

/** What the live stream says it is sending. Call at render time; it changes when a stream re-arms. */
export function spectrumGeometry(): typeof DEFAULT_GEOMETRY {
  return geometry;
}

function adoptGeometry(event: Record<string, unknown>): void {
  const spectrum = event.spectrum as { f_min?: unknown; f_max?: unknown } | null | undefined;
  const next = { ...DEFAULT_GEOMETRY };
  if (typeof spectrum?.f_min === 'number' && spectrum.f_min > 0) next.fMin = spectrum.f_min;
  if (typeof spectrum?.f_max === 'number' && spectrum.f_max > next.fMin) next.fMax = spectrum.f_max;
  if (typeof event.floorDb === 'number' && event.floorDb < 0) next.floorDb = event.floorDb;
  if (typeof event.fullScale === 'number' && event.fullScale > 0) next.fullScale = event.fullScale;
  geometry = next;
}

/**
 * Bars to ask for, and to draw.
 *
 * The endpoint clamps to 4–256 and uses what it is given. Exported because an idle display has no
 * samples to count and still has to show the right number of unlit segments — a grid that changes
 * width when the music stops would read as the display resizing rather than going quiet.
 */
/**
 * How many bands the display resolves.
 *
 * 64 was a pass at "more density" and it bought the wrong kind: a band is a *column*, so more of
 * them makes every column narrower, and a field of narrow columns is a picket fence the eye counts
 * rather than a surface it reads. The density that was actually wanted lives in the cells each
 * column is chopped into — that texture is free of the band count. So this is back at the figure
 * the display was designed around, where a column is wide enough to be a block.
 */
export const SPECTRUM_BARS = 48;

/**
 * One sample to a 0–1 height.
 *
 * The wire value is **already logarithmic**: the stream sends the sample's position in the
 * `floorDb`…0 dB window, linear in dB, as 0…`fullScale` (the sendspin visualizer@v1 encoding, and
 * `analysis.ready` states both ends of it). So the height is that position, unchanged.
 *
 * This used to read the value as a linear amplitude and take `20·log10` of it — a second logarithm
 * on top of the server's. It is not a subtle error: it maps a true −20 dBFS to 94% of the height and
 * reports it as −3.5 dBFS, so every bar piles up against the ceiling and a solo voice draws the same
 * flat wall as a full mix. Found by disbelieving a readout: −2.2 dBFS is louder than a full-scale
 * sine (−3.0 dB), which no music is.
 */
export function toHeight(sample: number): number {
  return Math.max(0, Math.min(1, sample / geometry.fullScale));
}

/** The same value as dB, for a readout. The inverse of the server's encoding, nothing more. */
export function toDb(sample: number): number {
  const { floorDb, fullScale } = geometry;
  return floorDb + Math.max(0, Math.min(1, sample / fullScale)) * -floorDb;
}

/**
 * Where a frequency falls across the width of the spectrum, 0–1.
 *
 * The bins are equally wide, so a frequency's position is its position *in the scale the stream
 * binned by*: log spacing puts 1 kHz just past halfway. Null when the frequency is outside the
 * streamed range — 32 Hz is, which is why the equalizer's own axis starts lower than the
 * spectrum's and insets it.
 */
export function spectrumPosition(hz: number): number | null {
  const { fMin, fMax } = geometry;
  if (hz < fMin || hz > fMax) {
    return null;
  }
  const lo = Math.log10(fMin);
  const hi = Math.log10(fMax);
  return (Math.log10(hz) - lo) / (hi - lo);
}

/**
 * The inverse: which frequency sits at a fraction of the display's width.
 *
 * What a pointer over the spectrum is asking. Same log scale as `spectrumPosition`, so the two
 * functions agree about every pixel between them.
 */
export function spectrumFrequency(fraction: number): number {
  const { fMin, fMax } = geometry;
  const lo = Math.log10(fMin);
  const hi = Math.log10(fMax);
  return 10 ** (lo + Math.max(0, Math.min(1, fraction)) * (hi - lo));
}

function pitchName(midiQ88: number): string {
  const midi = Math.round(midiQ88 / 256);
  if (!Number.isFinite(midi) || midi <= 0) return '';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export type Analysis = {
  /** 0–65535. */
  loudness: number;
  /** Raw amplitudes, one per bar. Run through `toHeight` to draw. */
  bins: number[];
  /** Note name, or empty when none was detected. */
  pitch: string;
  peak: number;
  /** Held peaks, already in 0–1 height space. */
  peaks: number[];
  /**
   * Front left/right levels, 0–65535 — the stereo meter's two sides. Null until the stream has
   * sent one, which is also what an older server without the event looks like: the meter falls
   * back to mono rather than showing a dead channel.
   */
  left: number | null;
  right: number | null;
  /** Held peaks per side, wire scale — the meter bridge's ticks, same hold-then-fall as the caps. */
  leftPeak: number;
  rightPeak: number;
};

const EMPTY: Analysis = {
  loudness: 0,
  bins: [],
  pitch: '',
  peak: 0,
  peaks: [],
  left: null,
  right: null,
  leftPeak: 0,
  rightPeak: 0,
};

type Entry = {
  refs: number;
  source: EventSource;
  /** What components read: the *drawn* values, ballistics applied. */
  state: Analysis;
  /** The latest wire values — the targets the drawn values chase. */
  pending: Analysis;
  /** The ballistics loop's rAF handle. Runs for the life of the entry. */
  frame: number | null;
  listeners: Set<() => void>;
  /** When each bar's held peak was last set, for the hold-then-fall behaviour. */
  peakAt: number[];
  /** The previous paint's timestamp, so the fall is per second rather than per frame. */
  paintedAt: number;
  /** The chasing values, raw wire scale. Separate from `state` so a publish is a decision. */
  shownBins: number[];
  shownLoudness: number;
  shownLeft: number;
  shownRight: number;
  /** When each side's held peak was last set — the bridge's own hold-then-fall clock. */
  leftPeakAt: number;
  rightPeakAt: number;
  /** Set by an arriving event; makes the next frame publish even if nothing numeric moved. */
  dirty: boolean;
  /**
   * What the stream's `timestampUs` means. `presentation` = when the audio will be heard, so the
   * sample is worth holding until then; `capture` = when it was measured, which is already past.
   */
  timeline: 'presentation' | 'capture';
  /**
   * `localMs - serverUs/1000`, or null before the first reading.
   *
   * Kept as the *smallest* value seen rather than the latest. Each reading is inflated by however
   * long that message spent in flight, so the minimum is the one that travelled fastest and sits
   * closest to the true offset — the same reason a time sync keeps its best round trip instead of
   * averaging them all.
   */
  clockOffsetMs: number | null;
  /** Samples waiting for their moment, in arrival order (which is timestamp order). */
  queue: Array<{ dueMs: number; event: Record<string, unknown> }>;
};

/**
 * Fold one reading of the server's audio clock into the entry's estimate.
 *
 * The stream states the clock twice over: once at `analysis.ready`, then on every keep-alive. One
 * reading is enough to line samples up; the repeats are what keep them lined up, since two clocks
 * never tick at quite the same rate.
 */
function noteClock(entry: Entry, serverNowUs: unknown): void {
  if (typeof serverNowUs !== 'number' || !Number.isFinite(serverNowUs)) {
    return;
  }
  const offset = performance.now() - serverNowUs / 1000;
  entry.clockOffsetMs =
    entry.clockOffsetMs === null ? offset : Math.min(entry.clockOffsetMs, offset);
}

/**
 * When to draw a sample, in local rAF time — or null to draw it now.
 *
 * Null covers every case where holding it would be a guess dressed up as precision: no clock
 * estimate yet, no usable timestamp, a moment that has already passed, or a delay so long
 * (`MAX_ALIGN_DELAY_MS`) that the estimate cannot be believed.
 */
function dueAt(entry: Entry, timestampUs: unknown): number | null {
  if (entry.clockOffsetMs === null || typeof timestampUs !== 'number' || !Number.isFinite(timestampUs)) {
    return null;
  }
  const dueMs = timestampUs / 1000 + entry.clockOffsetMs;
  const delay = dueMs - performance.now();
  if (delay <= 0 || delay > MAX_ALIGN_DELAY_MS) {
    return null;
  }
  return dueMs;
}

/** One entry per zone being watched, keyed by id. */
const entries = new Map<number, Entry>();

function publish(entry: Entry): void {
  for (const notify of entry.listeners) {
    notify();
  }
}

function open(base: string, zoneId: number, rate: number): Entry {
  const source = new EventSource(
    `${base}/zones/${zoneId}/analysis?types=loudness,spectrum,peak,pitch,stereo&rate=${rate}&bins=${SPECTRUM_BARS}`,
  );
  const entry: Entry = {
    refs: 0,
    source,
    state: EMPTY,
    pending: EMPTY,
    frame: null,
    listeners: new Set(),
    peakAt: [],
    paintedAt: 0,
    shownBins: [],
    shownLoudness: 0,
    shownLeft: 0,
    shownRight: 0,
    leftPeakAt: 0,
    rightPeakAt: 0,
    dirty: false,
    timeline: 'capture',
    clockOffsetMs: null,
    queue: [],
  };

  /** Move the targets from one sample. The ballistics loop is what turns them into pixels. */
  const applyEvent = (event: Record<string, unknown>): void => {
    if (event.type === 'loudness' && typeof event.value === 'number') {
      entry.pending = { ...entry.pending, loudness: event.value };
    }
    if (event.type === 'spectrum' && Array.isArray(event.bins)) {
      entry.pending = { ...entry.pending, bins: event.bins as number[] };
    }
    if (event.type === 'peak' && typeof event.strength === 'number') {
      entry.pending = { ...entry.pending, peak: event.strength };
    }
    if (event.type === 'pitch' && typeof event.midiQ88 === 'number') {
      entry.pending = { ...entry.pending, pitch: pitchName(event.midiQ88) };
    }
    if (event.type === 'stereo' && typeof event.left === 'number' && typeof event.right === 'number') {
      entry.pending = { ...entry.pending, left: event.left, right: event.right };
    }
    // Events only move the targets; the ballistics loop is the one thing that ever publishes.
    entry.dirty = true;
  };

  /*
   * The ballistics loop: every frame, the drawn values chase the wire's latest.
   *
   * This used to be a flush scheduled per event, which tied the display's motion to the stream's
   * rate — smooth at 30 events a second, a flipbook at 10. Now the wire only moves the *targets*
   * and this loop, running at the paint rate, gives the meter its mass: `1 − e^(−dt/τ)` per frame
   * is the classic exponential approach, `τ` split by direction so a transient leaps and a decay
   * falls (see `RISE_TAU_MS`). Publishing is gated: a frame where nothing visibly moved — silence,
   * a paused pipeline, values settled onto their targets — re-renders nobody.
   */
  const step = (now: number): void => {
    entry.frame = requestAnimationFrame(step);
    // Release whatever is due before the chase runs, so a sample lands on the first frame at or
    // after its moment. `now` is a rAF timestamp, the same clock the due times were computed on.
    while (entry.queue.length && entry.queue[0]!.dueMs <= now) {
      applyEvent(entry.queue.shift()!.event);
    }
    // Clamped: a backgrounded tab stops painting, and an hour-long `dt` on return should snap to
    // the present rather than integrate an hour of fall.
    const dt = entry.paintedAt ? Math.min(100, now - entry.paintedAt) : 16;
    entry.paintedAt = now;
    const riseK = 1 - Math.exp(-dt / RISE_TAU_MS);
    const fallK = 1 - Math.exp(-dt / FALL_TAU_MS);
    const settleAt = geometry.fullScale * SETTLE_FRACTION;
    let moving = entry.dirty;

    const chase = (shown: number, target: number): number => {
      const next = shown + (target - shown) * (target >= shown ? riseK : fallK);
      return Math.abs(next - target) < settleAt ? target : next;
    };

    const targets = entry.pending.bins;
    const bins = targets.map((target, index) => {
      const next = chase(entry.shownBins[index] ?? 0, target);
      if (next !== (entry.shownBins[index] ?? 0)) {
        moving = true;
      }
      return next;
    });
    entry.shownBins = bins;

    const loudness = chase(entry.shownLoudness, entry.pending.loudness);
    if (loudness !== entry.shownLoudness) {
      moving = true;
    }
    entry.shownLoudness = loudness;

    // The two sides of the stereo meter, on the same ballistics as everything else.
    const left = chase(entry.shownLeft, entry.pending.left ?? 0);
    const right = chase(entry.shownRight, entry.pending.right ?? 0);
    if (left !== entry.shownLeft || right !== entry.shownRight) {
      moving = true;
    }
    entry.shownLeft = left;
    entry.shownRight = right;

    /*
     * The bridge's held peaks — same rules as the spectrum caps, measured against the wire values
     * rather than the chased ones, so the tick marks the transient itself. Wire scale throughout;
     * `PEAK_FALL_PER_SEC` is stated in height space, so the fall converts through `fullScale`.
     */
    const holdSide = (held: number, target: number, atKey: 'leftPeakAt' | 'rightPeakAt'): number => {
      if (target >= held) {
        entry[atKey] = now;
        return target;
      }
      if (now - entry[atKey] < PEAK_HOLD_MS) {
        return held;
      }
      return Math.max(target, held - (dt / 1000) * PEAK_FALL_PER_SEC * geometry.fullScale);
    };
    const leftPeak = holdSide(entry.state.leftPeak, entry.pending.left ?? 0, 'leftPeakAt');
    const rightPeak = holdSide(entry.state.rightPeak, entry.pending.right ?? 0, 'rightPeakAt');
    if (leftPeak !== entry.state.leftPeak || rightPeak !== entry.state.rightPeak) {
      moving = true;
    }

    /*
     * Peak-hold: a new high is taken immediately and then held still for `PEAK_HOLD_MS` before it
     * starts sinking at `PEAK_FALL_PER_SEC`. Measured against the *wire* values, not the chased
     * ones — the cap marks the transient itself, and a cap that waited for the bar to catch up
     * would remember something slightly less than what happened.
     */
    const elapsed = dt / 1000;
    const held = entry.state.peaks;
    const peaks = targets.map((bin, index) => {
      const height = toHeight(bin);
      const previous = held[index] ?? 0;
      if (height >= previous) {
        entry.peakAt[index] = now;
        return height;
      }
      if (now - (entry.peakAt[index] ?? 0) < PEAK_HOLD_MS) {
        return previous;
      }
      const fallen = Math.max(height, previous - elapsed * PEAK_FALL_PER_SEC);
      return fallen;
    });
    if (!moving && peaks.some((peak, index) => peak !== (held[index] ?? 0))) {
      moving = true;
    }

    if (!moving) {
      return;
    }
    entry.dirty = false;
    entry.state = {
      loudness,
      bins,
      pitch: entry.pending.pitch,
      peak: entry.pending.peak,
      peaks,
      // Null until the wire has spoken, so a server without the event keeps the mono meter.
      left: entry.pending.left === null ? null : left,
      right: entry.pending.right === null ? null : right,
      leftPeak,
      rightPeak,
    };
    publish(entry);
  };
  entry.frame = requestAnimationFrame(step);

  source.onmessage = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as Record<string, unknown>;
      if (event.type === 'analysis.ready') {
        // Sent again whenever the server re-arms the analyzer, which it does when the zone's
        // PCM format changes mid-stream. The geometry can change with it.
        adoptGeometry(event);
        entry.timeline = event.timeline === 'presentation' ? 'presentation' : 'capture';
        /*
         * Start the clock estimate over, rather than folding this reading into the old one.
         *
         * The audio timeline is monotonic from the server *process* start, so a server that
         * restarted has a new origin — usually a much smaller number. Keeping the old minimum
         * across that would peg every sample as long overdue and the alignment would silently stop
         * working. A fresh `analysis.ready` is the one moment we know a re-estimate is safe.
         */
        entry.clockOffsetMs = null;
        entry.queue.length = 0;
        noteClock(entry, event.serverNowUs);
        return;
      }
      if (event.type === 'analysis.clock') {
        noteClock(entry, event.serverNowUs);
        return;
      }
      // On the presentation timeline the sample belongs to a moment that has not arrived yet.
      if (entry.timeline === 'presentation') {
        const dueMs = dueAt(entry, event.timestampUs);
        if (dueMs !== null) {
          entry.queue.push({ dueMs, event });
          return;
        }
      }
      applyEvent(event);
    } catch {
      // A malformed realtime sample must not take down the player.
    }
  };

  return entry;
}

/**
 * Subscribe to a zone's analysis while `active`.
 *
 * `rate` is the device's own `rateMax` where it reports one: it is a ceiling, not a suggestion, and
 * this used to request 60 from a player advertising 30. Only the first subscriber's rate opens the
 * stream — later ones join what is already running rather than reopening it, which is right for two
 * displays of the same zone and would be wrong if they ever needed different rates.
 */
export function useAnalysis(zoneId: number, active: boolean, rate = 30): Analysis {
  const api = useApi();
  const [, bump] = useState(0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let entry = entries.get(zoneId);
    if (!entry) {
      entry = open(api.base, zoneId, rate);
      entries.set(zoneId, entry);
    }
    entry.refs += 1;
    const notify = (): void => bump((value) => value + 1);
    entry.listeners.add(notify);
    // A late joiner should render whatever has already arrived rather than a frame of silence.
    notify();

    return () => {
      const current = entries.get(zoneId);
      if (!current) {
        return;
      }
      current.listeners.delete(notify);
      current.refs -= 1;
      if (current.refs > 0) {
        return;
      }
      current.source.close();
      if (current.frame !== null) {
        cancelAnimationFrame(current.frame);
      }
      entries.delete(zoneId);
    };
  }, [api.base, zoneId, active, rate]);

  return active ? (entries.get(zoneId)?.state ?? EMPTY) : EMPTY;
}
