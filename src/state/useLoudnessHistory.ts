/**
 * The waveform of what you have actually heard.
 *
 * A real waveform needs the whole file, which this API does not offer and this player will not
 * invent: the signal path refuses to draw stages the contract cannot support, and a decorative
 * waveform hashed from a track id would be exactly that mistake in a prettier shape.
 *
 * What the API *does* give is a live loudness reading (`GET /zones/{id}/analysis`), so this records
 * it against the position it was measured at. The result is honest and slightly unusual: the bars
 * behind the playhead are the envelope of the audio as it left the server, and there are no bars
 * ahead of it, because nothing has measured the future. A track played twice fills in twice.
 *
 * Kept in a module-level map rather than in component state for two reasons: it survives a view
 * switch (walk into the browser and back and the envelope is still there), and it is keyed by
 * *track*, so the display resets when the music changes rather than smearing two songs together.
 *
 * The analysis subscription itself is refcounted in `useAnalysis`, so this shares one stream with
 * the spectrum instead of opening a second.
 */
import { useEffect, useRef, useState } from 'react';
import { spectrumGeometry, useAnalysis } from '@/state/useAnalysis';
import { recordedBarHeight } from '@/lib/waveformScale';
import type { ApiZoneState } from '@/api/types';

/**
 * How many buckets a track is divided into.
 *
 * 220 is about one bar per 3px at the width this is drawn, which is where a waveform stops reading
 * as a bar chart. It is a *fixed* count rather than one per second: a 90-second interlude and a
 * 20-minute side of vinyl both get the same picture, so the display does not change density with
 * the track.
 */
const BUCKETS = 220;

/** How often to record. 8 Hz is finer than one bucket on anything under 27 seconds. */
const SAMPLE_MS = 125;

type Entry = {
  /** Which track this envelope belongs to. */
  key: string;
  /** 0–1 per bucket; -1 for "nothing measured here yet". */
  levels: Float32Array;
  listeners: Set<() => void>;
};

const entries = new Map<number, Entry>();

/** What identifies "the same track" for the purpose of keeping an envelope. */
function trackKey(zone: ApiZoneState | null): string {
  if (!zone?.track) {
    return '';
  }
  // `source.id` is the opaque provider id and the most stable handle; the title covers sources that
  // do not carry one (a bare stream), and the duration separates two tracks of the same name.
  return `${zone.source?.id ?? ''}|${zone.track.title}|${zone.duration}`;
}

function empty(): Float32Array {
  return new Float32Array(BUCKETS).fill(-1);
}

/**
 * The recorded envelope for a zone's current track, and whether anything is in it.
 *
 * `levels[i] < 0` means unmeasured, which the drawing renders as a hairline rather than as silence —
 * silence is a real reading and looks different.
 */
export function useLoudnessHistory(
  zone: ApiZoneState | null,
  position: number,
): { levels: Float32Array; measured: boolean } {
  const active = zone?.state === 'playing';
  const analysis = useAnalysis(zone?.id ?? -1, Boolean(active));
  const [, bump] = useState(0);

  const zoneId = zone?.id ?? -1;
  const key = trackKey(zone);

  // A new track gets a clean envelope. Also covers replaying the same track: the key includes the
  // duration and id, so a restart re-fills the same picture rather than starting a second one.
  useEffect(() => {
    if (zoneId < 0) {
      return;
    }
    const current = entries.get(zoneId);
    if (!current || current.key !== key) {
      entries.set(zoneId, { key, levels: empty(), listeners: current?.listeners ?? new Set() });
      bump((value) => value + 1);
    }
  }, [zoneId, key]);

  /*
   * What the timer below reads, kept in a ref rather than in its dependencies.
   *
   * This is the whole reason the recording works. `position` moves 30 times a second (it is
   * interpolated between server ticks) and `analysis` is a new object on every published frame, so
   * listing either as a dependency tore the interval down and rebuilt it every ~33 ms — an interval
   * with a 125 ms period that is recreated every 33 ms never fires once, and the envelope stayed
   * permanently empty. A ref updated on render gives the timer today's values while letting it live
   * as long as the track does.
   */
  const latest = useRef({ position, loudness: analysis.loudness, duration: zone?.duration ?? 0 });
  latest.current = { position, loudness: analysis.loudness, duration: zone?.duration ?? 0 };

  /*
   * Record on a timer rather than on every published frame.
   *
   * `useAnalysis` publishes at the paint rate, and re-rendering a 220-bar display 60 times a second
   * to change one bar is most of a CPU core for no visible gain. The timer reads whatever the latest
   * sample is, which is the same value the spectrum is drawing.
   */
  useEffect(() => {
    if (!active || zoneId < 0 || !key) {
      return undefined;
    }
    const timer = setInterval(() => {
      const entry = entries.get(zoneId);
      const { position: at, loudness, duration } = latest.current;
      if (!entry || duration <= 0) {
        return;
      }
      const bucket = Math.min(BUCKETS - 1, Math.floor((at / duration) * BUCKETS));
      if (bucket < 0) {
        return;
      }
      // A bar height, not a level: the reading is in dB and a waveform is a picture of amplitude.
      // `waveformScale` has the reasoning, and is shared with the prepared shape so the two match.
      const level = recordedBarHeight(loudness / spectrumGeometry().fullScale);
      // Keep the loudest reading in a bucket rather than the last: a bucket spans a few hundred
      // milliseconds, and a peak inside it is the thing a waveform is supposed to show.
      if (level > (entry.levels[bucket] ?? -1)) {
        entry.levels[bucket] = level;
        bump((value) => value + 1);
      }
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [active, zoneId, key]);

  const entry = entries.get(zoneId);
  const levels = entry && entry.key === key ? entry.levels : empty();
  let measured = false;
  for (let index = 0; index < levels.length; index += 1) {
    if ((levels[index] ?? -1) >= 0) {
      measured = true;
      break;
    }
  }
  return { levels, measured };
}

export const WAVEFORM_BUCKETS = BUCKETS;
