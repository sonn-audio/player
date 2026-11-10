/**
 * Light that listens.
 *
 * The rest, when nobody is at the panel: not a picture of the record but the light it throws. A field
 * of the record's own colours — the server reads them off the sleeve — breathing on the room's own
 * audio: the house's analysis stream drives the field, so the low end swells the ground and the top
 * end lifts the highlights, and a thin line along the bottom is the spectrum itself, drawn as a
 * contour rather than bars. A lamp in the room, lit by what is playing in it.
 *
 * Where the analysis is not there (an older server, a room whose output the server cannot hear) the
 * field breathes on its own, slowly, and the line stays flat. Under reduced motion it holds still.
 */
import { useEffect, useRef } from 'react';
import { toHeight, useAnalysis } from '@/state/useAnalysis';
import { zoneCoverCss } from '@/art/cover';
import { useApi } from '@/state/ServerContext';
import { mainTitle } from '@/lib/title';
import type { Cur } from '@/art/useCur';

/** How far each band's energy reaches into the field: a swell, not a strobe. */
const EASE = 0.12;

function clockLine(now = new Date()): { time: string; day: string } {
  return {
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    day: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

/** A smooth path through the bins, across the width: the spectrum as a contour. */
function contour(bins: number[], width: number, height: number, base: number): string {
  if (bins.length < 2) {
    return `M0 ${base} L${width} ${base}`;
  }
  const step = width / (bins.length - 1);
  const points = bins.map((sample, index) => [index * step, base - toHeight(sample) * height] as const);
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const cx = (x0 + x1) / 2;
    d += ` C${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

export function Light({ cur, onWake }: { cur: Cur; onWake: () => void }) {
  const api = useApi();
  const leader = cur.leader;
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const analysis = useAnalysis(leader?.id ?? 0, Boolean(leader) && cur.isPlaying && !still, 20);
  const field = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const smooth = useRef({ low: 0, mid: 0, high: 0, bins: [] as number[] });
  const [clock, setClock] = [useRef(clockLine()).current, (next: { time: string; day: string }) => Object.assign(clock, next)];

  /* The field follows the sound: three bands, each eased, each driving a layer's scale and opacity.
     Written straight to the element — this runs at the analysis rate and must not re-render the tree. */
  useEffect(() => {
    const node = field.current;
    if (!node) {
      return;
    }
    const bins = analysis.bins;
    const third = Math.max(1, Math.floor(bins.length / 3));
    const band = (from: number, to: number): number => {
      const slice = bins.slice(from, to);
      return slice.length ? slice.reduce((sum, sample) => sum + toHeight(sample), 0) / slice.length : 0;
    };
    const target = bins.length
      ? { low: band(0, third), mid: band(third, third * 2), high: band(third * 2, bins.length) }
      : { low: 0.35, mid: 0.3, high: 0.25 };
    const s = smooth.current;
    s.low += (target.low - s.low) * EASE;
    s.mid += (target.mid - s.mid) * EASE;
    s.high += (target.high - s.high) * EASE;
    node.style.setProperty('--low', s.low.toFixed(3));
    node.style.setProperty('--mid', s.mid.toFixed(3));
    node.style.setProperty('--high', s.high.toFixed(3));
    if (line.current) {
      if (s.bins.length !== bins.length) {
        s.bins = bins.slice();
      } else {
        for (let i = 0; i < bins.length; i += 1) {
          s.bins[i] = s.bins[i]! + (bins[i]! - s.bins[i]!) * 0.25;
        }
      }
      line.current.setAttribute('d', contour(s.bins, 1440, 170, 200));
    }
    /* No dependency list on purpose: the analysis hook re-renders on every frame it receives but hands
       back the same object, so the field has to follow every render rather than the object's identity. */
  });

  /* The clock, once a minute. */
  useEffect(() => {
    const tick = (): void => {
      setClock(clockLine());
      const node = field.current?.parentElement?.querySelector<HTMLElement>('.cx-light-time');
      const day = field.current?.parentElement?.querySelector<HTMLElement>('.cx-light-day');
      if (node) node.textContent = clock.time;
      if (day) day.textContent = clock.day;
    };
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  });

  const cover = zoneCoverCss(api, leader, 320);
  return (
    <div className="cx-light" data-live={analysis.bins.length > 0 || undefined} data-still={still || undefined} onClick={onWake}>
      <div className="cx-light-field" ref={field}>
        <span className="cx-light-blob" data-n="1" />
        <span className="cx-light-blob" data-n="2" />
        <span className="cx-light-blob" data-n="3" />
        <span className="cx-light-blob" data-n="4" />
        <span className="cx-light-blob" data-n="5" />
        <span className="cx-light-grain" />
        <svg className="cx-light-wave" viewBox="0 0 1440 260" preserveAspectRatio="none" aria-hidden="true">
          <path ref={line} d="M0 200 L1440 200" />
        </svg>
      </div>
      <div className="cx-light-ui">
        <div className="cx-light-row">
          <span className="cx-light-clock">
            <span className="cx-light-time disp">{clock.time}</span>
            <span className="cx-light-day">{clock.day}</span>
          </span>
        </div>
        {cur.hasTrack && (
          <div className="cx-light-np">
            <span className="cx-light-cov" style={cover ? { backgroundImage: cover } : undefined} aria-hidden="true" />
            <span className="cx-light-txt">
              <span className="disp cx-light-title">{mainTitle(cur.title)}</span>
              <span className="cx-light-artist">{[cur.artist, cur.album].filter(Boolean).join(' · ')}</span>
              <span className="cx-light-room">
                <i aria-hidden="true" />
                {cur.name}
                {leader?.format?.bitPerfect ? ' · Bit-perfect' : ''}
              </span>
            </span>
          </div>
        )}
      </div>
      <span className="cx-light-hush">touch to wake</span>
    </div>
  );
}
