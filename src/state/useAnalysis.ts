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
};

const EMPTY: Analysis = { loudness: 0, bins: [], pitch: '', peak: 0, peaks: [] };

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
  /** Set by an arriving event; makes the next frame publish even if nothing numeric moved. */
  dirty: boolean;
};

/** One entry per zone being watched, keyed by id. */
const entries = new Map<number, Entry>();

function publish(entry: Entry): void {
  for (const notify of entry.listeners) {
    notify();
  }
}

function open(base: string, zoneId: number, rate: number): Entry {
  const source = new EventSource(
    `${base}/zones/${zoneId}/analysis?types=loudness,spectrum,peak,pitch&rate=${rate}&bins=${SPECTRUM_BARS}`,
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
    dirty: false,
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
      }
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
      // Events only move the targets; the ballistics loop is the one thing that ever publishes.
      entry.dirty = true;
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
