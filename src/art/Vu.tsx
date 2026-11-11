/**
 * The meters: two needles on a lit scale, left and right.
 *
 * The reading has a bar meter, a spectrum, a loudness history and a goniometer — instruments you read.
 * This is the one you *watch*: a VU pair, because nothing says "this is the signal" to someone who
 * has ever owned an amplifier the way two needles moving together do. It is drawn as the thing it is —
 * a warm backlit scale from −20 to +3 with its red zone, a black needle, a hub — and nothing about it
 * is decoration: the needles follow the room's own left and right levels off the analysis stream.
 *
 * 0 VU is set at −18 dBFS, the alignment a studio uses, so a full modern master sits around zero and
 * touches the red on its peaks instead of pinning the needle. The ballistics are a VU meter's: about
 * 300 ms to rise and to fall, which is what makes it read loudness rather than peaks.
 */
import { useEffect, useRef } from 'react';
import { toDb, useAnalysis } from '@/state/useAnalysis';

const VU_MIN = -20;
const VU_MAX = 3;
/** dBFS at which the needle sits on 0. */
const ALIGN_DBFS = -18;
/** Degrees either side of straight up. */
const SWEEP = 48;
const CX = 190;
const CY = 232;
const R = 180;

const angleOf = (vu: number): number => -SWEEP + ((Math.max(VU_MIN, Math.min(VU_MAX, vu)) - VU_MIN) / (VU_MAX - VU_MIN)) * SWEEP * 2;

function polar(vu: number, radius: number): [number, number] {
  const a = ((angleOf(vu) - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

const TICKS: [number, string][] = [
  [-20, '20'],
  [-10, '10'],
  [-7, '7'],
  [-5, '5'],
  [-3, '3'],
  [-1, '1'],
  [0, '0'],
  [1, ''],
  [2, ''],
  [3, '3'],
];

function arc(from: number, to: number): string {
  const [x0, y0] = polar(from, R);
  const [x1, y1] = polar(to, R);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function Face({ side, needle }: { side: 'Left' | 'Right'; needle: React.RefObject<SVGLineElement> }) {
  const id = `cx-vu-${side}`;
  return (
    <svg className="cx-vu-face" viewBox="0 0 380 230" role="img" aria-label={`${side} level`}>
      <defs>
        <radialGradient id={id} cx="50%" cy="100%" r="95%">
          <stop offset="0" stopColor="#fff3d0" />
          <stop offset="0.55" stopColor="#f1d9a6" />
          <stop offset="1" stopColor="#c9a866" />
        </radialGradient>
      </defs>
      <rect width="380" height="230" fill={`url(#${id})`} />
      <path d={arc(VU_MIN, 0)} fill="none" stroke="#1a1712" strokeWidth="1.4" />
      <path d={arc(0, VU_MAX)} fill="none" stroke="#b3261e" strokeWidth="4" />
      {TICKS.map(([vu, text]) => {
        const [x1, y1] = polar(vu, R);
        const [x2, y2] = polar(vu, R - 12);
        const [xt, yt] = polar(vu, R + 15);
        const colour = vu > 0 ? '#b3261e' : '#1a1712';
        return (
          <g key={vu}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colour} strokeWidth={text ? 1.6 : 1} />
            {text && (
              <text x={xt} y={yt + 4} textAnchor="middle" fontSize="11" fill={colour} className="cx-vu-num">
                {text}
              </text>
            )}
          </g>
        );
      })}
      <text x="190" y="150" textAnchor="middle" fontSize="13" letterSpacing="4" fill="#1a1712">
        VU
      </text>
      <text x="26" y="214" fontSize="10" fontWeight="600" letterSpacing="3" fill="#3a3326">
        {side.toUpperCase()}
      </text>
      <text x="354" y="214" textAnchor="end" fontSize="10" fill="#3a3326" className="cx-vu-num">
        dB
      </text>
      <line ref={needle} x1={CX} y1={CY} x2={CX} y2={CY - R + 4} stroke="#0c0b09" strokeWidth="1.6" className="cx-vu-needle" />
      <circle cx={CX} cy={CY} r="26" fill="#0c0b09" />
    </svg>
  );
}

export function VuPair({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const left = useRef<SVGLineElement>(null);
  const right = useRef<SVGLineElement>(null);
  const shown = useRef({ l: VU_MIN, r: VU_MIN, at: 0 });

  /* Every frame the stream sends: ease each needle toward its level, write the angle straight to the
     element. No dependency list on purpose — the hook re-renders per frame but hands back one object. */
  useEffect(() => {
    const now = performance.now();
    const dt = Math.min(0.25, shown.current.at ? (now - shown.current.at) / 1000 : 0.033);
    shown.current.at = now;
    /* A VU's 300 ms: the fraction of the remaining distance covered in `dt`. */
    const k = 1 - Math.exp(-dt / 0.13);
    const mono = analysis.left === null || analysis.right === null;
    const target = (sample: number): number => (active && sample > 0 ? toDb(sample) - ALIGN_DBFS : VU_MIN - 4);
    const tl = target(mono ? analysis.loudness : analysis.left!);
    const tr = target(mono ? analysis.loudness : analysis.right!);
    shown.current.l += (tl - shown.current.l) * k;
    shown.current.r += (tr - shown.current.r) * k;
    left.current?.setAttribute('transform', `rotate(${angleOf(shown.current.l).toFixed(2)} ${CX} ${CY})`);
    right.current?.setAttribute('transform', `rotate(${angleOf(shown.current.r).toFixed(2)} ${CX} ${CY})`);
  });

  return (
    <div className="cx-vu">
      <div className="cx-vu-well">
        <Face side="Left" needle={left} />
      </div>
      <div className="cx-vu-well">
        <Face side="Right" needle={right} />
      </div>
    </div>
  );
}
