/**
 * The prepared shape of the current track, when the server has one.
 *
 * `useLoudnessHistory` records the envelope of what has been *listened to*, which is honest and half a
 * picture: open a track at 2:00 and the first two minutes stay a flat line for as long as it plays.
 * The server can scan a file end to end in under a second, so for anything backed by a file the whole
 * shape is available before a note is heard — and the timeline stops being a drawing in progress.
 *
 * Three rules, all of them about not making a fuss over a picture:
 *
 *  - **Cached per track, including the misses.** A track with no shape (every streaming service) must
 *    not be asked again each time it comes round in the queue, so `null` is remembered too.
 *  - **Exactly one retry.** The first request for a file is what *starts* the decode server-side and
 *    answers null; a second one a beat later gets the bytes. Retrying forever would poll a streaming
 *    track that can never have one.
 *  - **Never blocks anything.** No loading state is exposed: until it resolves, the caller keeps
 *    drawing what it already has.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { preparedBarHeights } from '@/lib/waveformScale';
import type { ApiZoneState } from '@/api/types';

/** Levels in 0…1, or null for "no prepared shape". Shared across every display of a track. */
const cache = new Map<string, number[] | null>();

/** How long to wait before the one retry — long enough for a whole-file decode to land. */
const RETRY_MS = 1500;

/**
 * Bytes on the wire to bar heights.
 *
 * Each byte is the bucket's level as a position in the analysis dB window — the same scale the live
 * loudness stream uses, which is what lets one component draw either source. `waveformScale` owns the
 * conversion to a height, and why it is not the identity function.
 */
function toLevels(buckets: number[]): number[] {
  return preparedBarHeights(buckets.map((v) => Math.max(0, Math.min(1, v / 255))));
}

export function useTrackWaveform(zone: ApiZoneState | null): number[] | null {
  const api = useApi();
  const uri = zone?.source?.id ?? '';
  const [levels, setLevels] = useState<number[] | null>(() => cache.get(uri) ?? null);

  useEffect(() => {
    if (!uri) {
      setLevels(null);
      return undefined;
    }
    if (cache.has(uri)) {
      setLevels(cache.get(uri) ?? null);
      return undefined;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const take = (buckets: number[] | null, final: boolean): void => {
      if (cancelled) {
        return;
      }
      if (buckets && buckets.length > 0) {
        const mapped = toLevels(buckets);
        cache.set(uri, mapped);
        setLevels(mapped);
        return;
      }
      if (final) {
        // Remembered as "none", so this track is not asked about again.
        cache.set(uri, null);
        setLevels(null);
      }
    };

    void api.waveform(uri).then((first) => {
      take(first, false);
      if (!cancelled && !first) {
        retry = setTimeout(() => {
          void api.waveform(uri).then((second) => take(second, true));
        }, RETRY_MS);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [api, uri]);

  return levels;
}
