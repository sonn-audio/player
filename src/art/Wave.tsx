/**
 * The phone timeline, as the shape of the record.
 *
 * Where the server has scanned the track (`useTrackWaveform` — anything backed by a file), the
 * hairline under the canvas becomes the track's own envelope: the quiet intro, the chorus, the
 * outro, visible before they happen. That is a *musical* fact, not a technical one — no codec, no
 * numbers — so it belongs on this face, in this face's voice: soft rounded bars, low contrast,
 * the played part in the record's accent. The one thing the drawing must never be is a chart.
 *
 * Streaming tracks have no file to scan and keep the plain bar — the caller falls back — because
 * a fabricated envelope would be a better picture and a lie (the technical face's rule, and it
 * holds here).
 *
 * Seeking is the same gesture as the bar it replaces: `horizontalDrag`, commands per move, no
 * optimistic position — the fill follows the zone, which on a LAN answers inside the gesture.
 */
import { useMemo, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { horizontalDrag } from '@/art/drag';
import type { Cur } from '@/art/useCur';

/**
 * Bars across the width. Fewer than the technical face draws: at phone width more would be
 * texture, and the envelope is the point, not the resolution.
 */
const BARS = 56;

/**
 * Max-pooled rather than averaged, so a transient survives the downsample — the drum hit that
 * makes a chorus visible is exactly the sample averaging would smooth away.
 */
function condense(levels: number[], bars: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < bars; index += 1) {
    const from = Math.floor((index / bars) * levels.length);
    const to = Math.max(from + 1, Math.floor(((index + 1) / bars) * levels.length));
    let max = 0;
    for (let at = from; at < to; at += 1) {
      max = Math.max(max, levels[at] ?? 0);
    }
    out.push(max);
  }
  return out;
}

export function ArtWave({ cur, levels }: { cur: Cur; levels: number[] }) {
  const api = useApi();
  const [scrubbing, setScrubbing] = useState(false);
  const bars = useMemo(() => condense(levels, BARS), [levels]);
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

  const fraction = cur.durationSec > 0 ? Math.min(1, cur.elapsedSec / cur.durationSec) : 0;

  return (
    <div className="cx-wave" onPointerDown={seek} data-scrub={scrubbing || undefined} aria-label="Position">
      {bars.map((level, index) => (
        <i
          key={index}
          data-played={(index + 0.5) / bars.length <= fraction || undefined}
          style={{ '--h': `${Math.max(8, level * 100)}%` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
