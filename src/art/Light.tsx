/**
 * The rest: the ground, with the frame stepped away.
 *
 * Left alone for a minute the panel stops being an app and becomes the light the record throws — which
 * is the ground every other screen already stands on (`Ground`), now with nothing in front of it and
 * moving on the room's own audio. What this draws is only what is left on top: the hour, the record in
 * a corner, and the spectrum as one thin contour along the bottom.
 *
 * Where the analysis is not there, there is no line. Any touch wakes the frame.
 */
import { useEffect, useRef, useState } from 'react';
import { toHeight, useAnalysis } from '@/state/useAnalysis';
import { zoneCoverCss } from '@/art/cover';
import { useApi } from '@/state/ServerContext';
import { mainTitle } from '@/lib/title';
import type { Cur } from '@/art/useCur';

function clockOf(now = new Date()): { time: string; day: string } {
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
  const line = useRef<SVGPathElement>(null);
  const smooth = useRef<number[]>([]);
  const [clock, setClock] = useState(clockOf);

  /* The contour follows every frame the stream sends; written straight to the path. No dependency
     list on purpose: the analysis hook re-renders per frame but hands back the same object. */
  useEffect(() => {
    const bins = analysis.bins;
    if (!line.current) {
      return;
    }
    if (smooth.current.length !== bins.length) {
      smooth.current = bins.slice();
    } else {
      for (let i = 0; i < bins.length; i += 1) {
        smooth.current[i] = smooth.current[i]! + (bins[i]! - smooth.current[i]!) * 0.25;
      }
    }
    line.current.setAttribute('d', contour(smooth.current, 1440, 170, 200));
  });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockOf()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const cover = zoneCoverCss(api, leader, 320);
  return (
    <div className="cx-light" onClick={onWake}>
      <svg
        className="cx-light-wave"
        viewBox="0 0 1440 260"
        preserveAspectRatio="none"
        data-live={analysis.bins.length > 0 || undefined}
        aria-hidden="true"
      >
        <path ref={line} d="M0 200 L1440 200" />
      </svg>
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
    </div>
  );
}
