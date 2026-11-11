/**
 * The meters: two needles on a lit scale, left and right.
 *
 * The reading has a bar meter, a spectrum, a loudness history and a goniometer — instruments you read.
 * This is the one you *watch*: a VU pair, because nothing says "this is the signal" to someone who
 * has ever owned an amplifier the way two needles moving together do. It is drawn as the thing it is —
 * a bezel, a warm backlit face set back from it behind glass, a scale from −20 to +3 with its red zone,
 * a needle that casts a shadow, a hub, a lamp for an over — and nothing about it is decoration: the
 * needles follow the room's own left and right levels off the analysis stream.
 *
 * 0 VU is set at −12 dBFS. A studio aligns at −18, and at −18 a modern master — which sits near
 * −9 LUFS — holds both needles against the stop, where they say nothing. At −12 such a record sits
 * around zero and touches the red on its peaks, and a quiet, dynamic one still moves in the lower half.
 * The ballistics are a VU meter's: about 300 ms to rise and to fall, which is what makes it read
 * loudness rather than peaks. The lamp is the other half: it lights when the true peak passes full
 * scale, and holds for a second so an over that lasted a sample can be seen.
 */
import { useEffect, useRef } from 'react';
import { toDb, useAnalysis } from '@/state/useAnalysis';

const VU_MIN = -20;
const VU_MAX = 3;
/** dBFS at which the needle sits on 0. */
const ALIGN_DBFS = -12;
/** Degrees either side of straight up. */
const SWEEP = 48;
const W = 560;
const H = 340;
const CX = 280;
const CY = 330;
const R = 250;
/** How long the over lamp stays lit after the peak that lit it. */
const PEAK_HOLD_MS = 1200;

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
  [-2, ''],
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

type Hands = {
  needle: React.RefObject<SVGGElement>;
  shadow: React.RefObject<SVGGElement>;
  lamp: React.RefObject<SVGGElement>;
};

const INK = '#1c1810';
const RED = '#a3261c';
const PRINT = '#4a3f2c';

/*
 * One meter, back to front: the bezel, the well it is cut into, the lit face with its printing, the
 * needle's shadow on the face, the needle, the hub, then what the glass adds — the bezel's own shadow
 * falling along the top of the face, and a sheen from the upper left.
 */
function Face({ side, hands }: { side: 'Left' | 'Right'; hands: Hands }) {
  const id = `cx-vu-${side}`;
  const face = { x: 18, y: 18, width: W - 36, height: H - 36 };
  return (
    <svg className="cx-vu-face" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${side} level`}>
      <defs>
        <linearGradient id={`${id}-bezel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a2e" />
          <stop offset="0.5" stopColor="#151517" />
          <stop offset="1" stopColor="#0c0c0d" />
        </linearGradient>
        <radialGradient id={`${id}-face`} cx="50%" cy="108%" r="95%">
          <stop offset="0" stopColor="#fff1cf" />
          <stop offset="0.45" stopColor="#f1d9a2" />
          <stop offset="1" stopColor="#b98f4c" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.38" />
          <stop offset="0.16" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.32" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-hub`} cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="#3a3a3e" />
          <stop offset="0.6" stopColor="#121214" />
          <stop offset="1" stopColor="#050506" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <rect {...face} rx="5" />
        </clipPath>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <rect width={W} height={H} rx="12" fill={`url(#${id}-bezel)`} />
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12" fill="none" stroke="#fff" strokeOpacity="0.09" />
      <rect x="17" y="17" width={W - 34} height={H - 34} rx="6" fill="#050505" />

      <g clipPath={`url(#${id}-clip)`}>
        <rect {...face} fill={`url(#${id}-face)`} />
        <path d={arc(VU_MIN, 0)} fill="none" stroke={INK} strokeWidth="1.5" />
        <path d={arc(0, VU_MAX)} fill="none" stroke={RED} strokeWidth="5" />
        {TICKS.map(([vu, text]) => {
          const [x1, y1] = polar(vu, R);
          const [x2, y2] = polar(vu, R + (text ? 14 : 8));
          const [xt, yt] = polar(vu, R + 30);
          const colour = vu > 0 ? RED : INK;
          return (
            <g key={vu}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colour} strokeWidth={text ? 1.6 : 1} />
              {text && (
                <text x={xt} y={yt + 4} textAnchor="middle" fontSize="13" fill={colour} className="cx-vu-num">
                  {text}
                </text>
              )}
            </g>
          );
        })}
        <text x={CX} y="208" textAnchor="middle" fontSize="15" letterSpacing="5" fill="#2b241a">
          VU
        </text>
        <text x="44" y={H - 40} fontSize="10" letterSpacing="3" fill={PRINT} className="cx-vu-num">
          {side.toUpperCase()}
        </text>
        <text x={W - 44} y={H - 40} textAnchor="end" fontSize="10" letterSpacing="2" fill={PRINT} className="cx-vu-num">
          0 = {ALIGN_DBFS} dBFS
        </text>

        {/* The over lamp: dark until the true peak passes full scale. */}
        <g ref={hands.lamp} className="cx-vu-lamp">
          <circle cx={W - 52} cy="50" r="11" className="cx-vu-lamp-glow" />
          <circle cx={W - 52} cy="50" r="5" className="cx-vu-lamp-dot" />
        </g>
        <text x={W - 66} y="54" textAnchor="end" fontSize="9" letterSpacing="2" fill={PRINT} className="cx-vu-num">
          PEAK
        </text>

        {/* The shadow falls down and to the right of the needle, wherever the needle points. */}
        <g transform="translate(7 9)" opacity="0.35" filter={`url(#${id}-soft)`}>
          <g ref={hands.shadow}>
            <line x1={CX} y1={CY} x2={CX} y2={CY - R - 6} stroke="#000" strokeWidth="3" />
          </g>
        </g>
        <g ref={hands.needle}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R - 6} stroke="#141210" strokeWidth="2" />
        </g>
        <circle cx={CX} cy={CY + 6} r="46" fill={`url(#${id}-hub)`} />

        <rect {...face} fill={`url(#${id}-shade)`} />
        <rect {...face} fill={`url(#${id}-glass)`} />
      </g>
      <rect x="17.5" y="17.5" width={W - 35} height={H - 35} rx="5.5" fill="none" stroke="#000" strokeOpacity="0.8" />
    </svg>
  );
}

function useHands(): Hands {
  return { needle: useRef<SVGGElement>(null), shadow: useRef<SVGGElement>(null), lamp: useRef<SVGGElement>(null) };
}

export function VuPair({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const left = useHands();
  const right = useHands();
  const shown = useRef({ l: VU_MIN, r: VU_MIN, at: 0, overL: 0, overR: 0 });

  /* Every frame the stream sends: ease each needle toward its level, write the angle straight to the
     element. No dependency list on purpose — the hook re-renders per frame but hands back one object. */
  useEffect(() => {
    const now = performance.now();
    const state = shown.current;
    const dt = Math.min(0.25, state.at ? (now - state.at) / 1000 : 0.033);
    state.at = now;
    /* A VU's 300 ms: the fraction of the remaining distance covered in `dt`. */
    const k = 1 - Math.exp(-dt / 0.13);
    const mono = analysis.left === null || analysis.right === null;
    const target = (sample: number): number => (active && sample > 0 ? toDb(sample) - ALIGN_DBFS : VU_MIN - 4);
    state.l += (target(mono ? analysis.loudness : analysis.left!) - state.l) * k;
    state.r += (target(mono ? analysis.loudness : analysis.right!) - state.r) * k;
    if (active && (analysis.truePeakLeft ?? -Infinity) > 0) {
      state.overL = now;
    }
    if (active && (analysis.truePeakRight ?? -Infinity) > 0) {
      state.overR = now;
    }

    const set = (hands: Hands, vu: number, over: number): void => {
      const turn = `rotate(${angleOf(vu).toFixed(2)} ${CX} ${CY})`;
      hands.needle.current?.setAttribute('transform', turn);
      hands.shadow.current?.setAttribute('transform', turn);
      hands.lamp.current?.toggleAttribute('data-lit', over > 0 && now - over < PEAK_HOLD_MS);
    };
    set(left, state.l, state.overL);
    set(right, state.r, state.overR);
  });

  return (
    <div className="cx-vu">
      <Face side="Left" hands={left} />
      <Face side="Right" hands={right} />
    </div>
  );
}
