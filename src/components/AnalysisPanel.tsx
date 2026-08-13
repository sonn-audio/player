/**
 * What the audio is doing right now, drawn as a segmented LED display.
 *
 * The subscription and the frequency maths live in `useAnalysis`; what is left here is the drawing,
 * plus hosting the equalizer, which is overlaid on this display rather than given one of its own.
 *
 * Two decisions in the drawing worth keeping:
 *
 *  - **Segments, not bars.** One repeating gradient is used twice — as each column's own faint
 *    background and as a mask over its lit fill — so the unlit LEDs show at rest and the lit ones are
 *    always in register with them. See `.spectrum` in styles.css.
 *  - **Peaks are held and fall slowly.** The detail that makes a spectrum readable rather than a
 *    blur, and what analyser hardware has always done.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import {
  useAnalysis,
  spectrumFrequency,
  spectrumGeometry,
  SPECTRUM_BARS,
  spectrumPosition,
  toDb,
  toHeight,
} from '@/state/useAnalysis';
import { EqOverlay } from '@/components/EqOverlay';
import { Icon } from '@/components/Icon';
import type { ApiOutputCapabilities } from '@/api/types';

/** Frequencies to label under the spectrum. Three decades, enough to read it by. */
const AXIS_TICKS = [100, 1000, 10000];

/** Hz → the label a person expects to see. */
function tickLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

/** Hz → the probe's readout: `240 Hz`, `2.4 kHz` — a measurement, so it keeps its unit. */
function probeHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

/**
 * How much of its slot a bar fills, and the seam it may never give up.
 *
 * Wide ink, narrow seams: the display went 0.44 → 0.66 → 0.78 → here, and every step got
 * *calmer* rather than busier, which is the opposite of what the first cut assumed. A field of
 * thin columns is a picket fence — the eye counts the gaps — while wide ones read as one surface
 * with texture in it, the way the original wall did. What keeps that mass from congealing back
 * into a slab is not the seams any more; it is the silver (a reading that does not shout) and the
 * cells that chop every column horizontally.
 *
 * The seam has a floor in pixels as well as a share of the pitch, so a narrow window keeps its
 * columns countable instead of fusing them at the point where the fraction alone would round to
 * nothing.
 */
const BAR_FRACTION = 0.86;
const MIN_SEAM_PX = 2.5;

/**
 * Loudness as dBFS, which is the unit this reading actually has.
 *
 * The percentage it replaced was a percentage *of full-scale amplitude*, so 50% was −6 dB and the
 * bottom two thirds of the scale were squeezed into the first fifth of the number — a readout that
 * barely moved through everything you can hear. dB is what the bars are already drawn in
 * (`toHeight`), so the number and the display finally agree.
 *
 * The conversion is `toDb` — the plain inverse of the stream's encoding. It used to take
 * `20·log10` of a value the server had already put in dB, which read −20 dBFS as −3.5 and made
 * every level look like it was clipping.
 */
function dbfs(loudness: number): string {
  return toDb(loudness).toFixed(1);
}

export function AnalysisPanel({
  zoneId,
  active,
  capabilities,
}: {
  zoneId: number;
  active: boolean;
  /** The output's reported visualizer limits, when it has any. */
  capabilities?: ApiOutputCapabilities | null | undefined;
}) {
  // `rateMax` is a ceiling the device published; asking above it is asking for trouble.
  const analysis = useAnalysis(zoneId, active, capabilities?.visualizer?.rateMax ?? 30);
  /*
   * The equalizer is off by default and overlaid on demand.
   *
   * It shares this display rather than getting one of its own: the spectrum *is* what an equalizer
   * acts on, and a second copy of it behind a second set of bars was the same thing twice. Off by
   * default because this panel is a read-out during listening, and a screen full of grabbable handles
   * invites changing a setting when you meant to watch one.
   */
  const [showEq, setShowEq] = useState(false);

  /*
   * The probe: pointing at the display measures it.
   *
   * A hairline under the cursor and the two numbers of the place it stands on — the frequency
   * there, and the level in that bin right now. The same gesture the timeline already answers
   * (hover shows the time it would seek to), extended to the axis this display actually has.
   * Mouse only: under a finger the readout would sit exactly where the finger is hiding it.
   * Suppressed while the equalizer is overlaid (its handles own the surface) and while idle
   * (measuring silence reads `-60 dB` everywhere, which is a number pretending to be a fact).
   */
  const [probe, setProbe] = useState<{ at: number; hz: number; db: number } | null>(null);

  /*
   * The display's box, measured — the curve is drawn in pixel space.
   *
   * A percentage viewBox stretched with `preserveAspectRatio: none` warps every stroke (1.5px
   * horizontal, 4px vertical); a viewBox that *is* the box keeps the geometry honest and lets the
   * glow filter run in screen space. Same pattern the waveform uses to size its bars.
   */
  const canvas = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) {
      return undefined;
    }
    const fit = (): void => {
      const rect = node.getBoundingClientRect();
      setDims((prev) =>
        Math.round(rect.width) !== prev.w || Math.round(rect.height) !== prev.h
          ? { w: Math.round(rect.width), h: Math.round(rect.height) }
          : prev,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /*
   * Always drawn, playing or not.
   *
   * A display that disappears when the music stops leaves a hole in the layout and makes the room look
   * broken rather than quiet — and it took the equalizer with it, which is exactly backwards: the
   * contract has the equalizer working on an **idle** zone, so a stopped room is a perfectly good time
   * to set one. Idle means the same grid with nothing lit, which is what a piece of audio equipment
   * does when it is powered and silent.
   *
   * The stream itself is still only open while playing — `useAnalysis` sees `active` — so an idle
   * display costs no traffic.
   */
  const bars = analysis.bins.length > 0 ? analysis.bins : new Array(SPECTRUM_BARS).fill(0);
  const level = Math.min(100, analysis.loudness / (spectrumGeometry().fullScale / 100));
  const ticks = AXIS_TICKS.map((hz) => ({ hz, at: spectrumPosition(hz) })).filter(
    (tick): tick is { hz: number; at: number } => tick.at !== null,
  );

  /*
   * The bars' shared geometry, in pixel space. The ballistics in `useAnalysis` drive every height
   * per frame; nothing here transitions.
   */
  const pitch = bars.length > 0 ? dims.w / bars.length : 0;
  const barW = Math.max(2, Math.min(pitch * BAR_FRACTION, pitch - MIN_SEAM_PX));
  const barR = Math.min(4, barW / 2);
  const dimId = `spectrum-dim-${zoneId}`;

  /*
   * The reading in silver, the memory in green.
   *
   * The display tried a saturated green wall (a slab), a frequency-coloured ramp (beautiful, and
   * shouting over everything else on the page) — and landed on the rule the rest of the product
   * already lives by: a control surface is silver when it is not saying anything, and the accent
   * is spent on the one thing that *is* saying something. The bars are the reading — quiet,
   * near-monochrome, mass without volume. The peak caps are the statement: where the music just
   * was, in the product's own green, floating over a silver field. (The polychrome ramp lives one
   * commit back if the pendulum swings again.)
   */
  const BAR_INK = 'rgb(255 255 255 / 20%)';

  /*
   * The cells are back — in silver, where they never were the problem.
   *
   * The original display's LED chop read as 1992 because it was a chop through *saturated green*;
   * on a quiet silver field the same segmentation is texture, the way a dot-matrix reads as craft
   * where a green wall reads as retro. One mask of horizontal rows, built from the floor up so the
   * cells stand on the bridge, chops every bar at once; the caps live outside it and stay whole.
   */
  const SEG_H = 6;
  const SEG_GAP = 3;
  const segRows: number[] = [];
  for (let y = dims.h; y > -SEG_H; y -= SEG_H + SEG_GAP) {
    segRows.push(y - SEG_H);
  }

  return (
    <section className="analysis-panel">
      <div className="analysis-heading">
        <span>Spectrum</span>
        {/* The note being played and how hard — the two numbers worth a glance. Pitch leads because
            it changes meaningfully; the level is already drawn by the meter below. */}
        <span className="analysis-readout">
          {/* Idle says so, rather than showing a pitch of nothing and a level of zero as though it
              had measured them. */}
          {active ? (
            <>
              {/* A peak lamp, as on the equipment this borrows from: lit while the loudest bin is
                  inside the top of the scale, which is the only moment the number below is worth
                  reacting to. */}
              <span
                className="analysis-lamp"
                data-lit={level > 92 || undefined}
                title="Approaching full scale"
                aria-hidden="true"
              />
              {analysis.pitch && <span className="analysis-pitch">{analysis.pitch}</span>}
              <span className="analysis-level">
                {dbfs(analysis.loudness)}
                <i>dBFS</i>
              </span>
            </>
          ) : (
            <span className="analysis-level">idle</span>
          )}
          <button
            type="button"
            className="text-button analysis-eq-toggle"
            data-active={showEq || undefined}
            onClick={() => setShowEq((value) => !value)}
            title="Adjust the equalizer on this display"
          >
            <Icon name="sliders" /> EQ
          </button>
        </span>
      </div>

      {/* The spectrum, and the equalizer over it when asked for. `position: relative` on this makes
          the overlay's percentages resolve against the display rather than the panel. */}
      {/*
        `data-settling` while the music is not running: the ballistics fall the curve to the floor,
        and the baseline it comes to rest on dims — a device that is on and silent, not one that
        is drawing nothing.
      */}
      <div
        ref={canvas}
        className="spectrum"
        aria-label="Spectrum"
        data-eq={showEq || undefined}
        data-settling={!active || undefined}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse' || showEq || !active) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const at = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          const index = Math.min(bars.length - 1, Math.floor(at * bars.length));
          setProbe({ at, hz: spectrumFrequency(at), db: toDb(bars[index] ?? 0) });
        }}
        onPointerLeave={() => setProbe(null)}
      >
        {dims.w > 0 && (
          <svg
            className="spectrum-curve"
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            width={dims.w}
            height={dims.h}
            aria-hidden="true"
          >
            <defs>
              {/*
                The absolute-level dimming, as one wash over the whole display: near the floor every
                bar is dim, near full scale every bar is bright — what the LED wall's gradient stops
                used to say, now said once instead of per bar so each bar can keep its own hue.
                Over the page's own black it is invisible; it only ever takes light away from bars.
              */}
              {/* Softer than it was: the colour ramp now carries depth of its own, and two full
                  encodings of "low" stacked up read as mud in the bass corner. */}
              <linearGradient id={dimId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={dims.h}>
                <stop offset="0%" stopColor="rgb(10 12 16 / 0%)" />
                <stop offset="55%" stopColor="rgb(10 12 16 / 16%)" />
                <stop offset="100%" stopColor="rgb(10 12 16 / 40%)" />
              </linearGradient>
              <mask id={`spectrum-seg-${zoneId}`} maskUnits="userSpaceOnUse" x="0" y="0" width={dims.w} height={dims.h}>
                {segRows.map((y, index) => (
                  <rect key={index} x="0" y={y} width={dims.w} height={SEG_H} fill="#fff" />
                ))}
              </mask>
            </defs>
            <g className="spectrum-bars" mask={`url(#spectrum-seg-${zoneId})`}>
              {bars.map((bin, index) => {
                const height = Math.max(2, toHeight(bin) * (dims.h - 2));
                return (
                  <rect
                    key={index}
                    x={(index + 0.5) * pitch - barW / 2}
                    y={dims.h - 1 - height}
                    /* Extended past the floor by the corner radius, which the svg clips off: a
                       rounded top and a *flat* foot. A bar standing on the baseline with a rounded
                       bottom is a floating pill; meters stand on their bridge. */
                    width={barW}
                    height={height + barR}
                    rx={barR}
                    fill={BAR_INK}
                  />
                );
              })}
            </g>
            <rect x="0" y="0" width={dims.w} height={dims.h} fill={`url(#${dimId})`} pointerEvents="none" />
            {/* The memory: a rounded tick floating where each band last peaked — held, then
                sinking (`analysis.peaks`). Its band's own hue, lifted toward white: brighter than
                the bar it remembers, and drawn above the dimming wash so it stays the one bright
                element over the reading. */}
            <g className="spectrum-peaks">
              {analysis.peaks.map((peak, index) =>
                peak > 0.02 ? (
                  <rect
                    key={index}
                    x={(index + 0.5) * pitch - barW / 2}
                    y={1 + (dims.h - 2) * (1 - peak) - 1}
                    width={barW}
                    height={2}
                    rx={1}
                  />
                ) : null,
              )}
            </g>
          </svg>
        )}
        {probe && !showEq && active && (
          <>
            <span className="spectrum-cursor" style={{ left: `${probe.at * 100}%` }} aria-hidden="true" />
            <span
              className="spectrum-readout"
              style={{ left: `${Math.min(0.93, Math.max(0.07, probe.at)) * 100}%` }}
              aria-hidden="true"
            >
              {probeHz(probe.hz)} <i>{probe.db.toFixed(0)} dB</i>
            </span>
          </>
        )}
        {showEq && <EqOverlay zoneId={zoneId} />}
      </div>

      {/* Loudness, as hairlines under the spectrum rather than a bar above it. Two of them where
          the stream reports the channels apart (`stereo`): a left and a right rail, each with its
          own tiny nameplate — the stereo image as two lines breathing against each other. One
          mono hairline against an older server, which is honest rather than a dead R channel. */}
      {analysis.left !== null && analysis.right !== null ? (
        /* The bridge speaks the display's own grammar: the level is silver (a reading), and the
           held peak is the green tick (a statement) — the same hold-then-fall as the caps above. */
        <div className="analysis-meter-stereo">
          <span className="analysis-meter-ch">L</span>
          <div
            className="analysis-meter"
            style={
              {
                '--level': `${Math.min(100, analysis.left / (spectrumGeometry().fullScale / 100))}%`,
                '--held': `${Math.min(100, analysis.leftPeak / (spectrumGeometry().fullScale / 100))}%`,
              } as React.CSSProperties
            }
          >
            <span />
            <i aria-hidden="true" />
          </div>
          <span className="analysis-meter-ch">R</span>
          <div
            className="analysis-meter"
            style={
              {
                '--level': `${Math.min(100, analysis.right / (spectrumGeometry().fullScale / 100))}%`,
                '--held': `${Math.min(100, analysis.rightPeak / (spectrumGeometry().fullScale / 100))}%`,
              } as React.CSSProperties
            }
          >
            <span />
            <i aria-hidden="true" />
          </div>
        </div>
      ) : (
        <div className="analysis-meter" style={{ '--level': `${level}%` } as React.CSSProperties}>
          <span />
        </div>
      )}

      <div className="analysis-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick.hz}
            style={
              {
                left: `${tick.at * 100}%`,
                /*
                 * Centred on its own frequency, except at the ends where centring would hang half
                 * the label off the panel. Those align inward instead.
                 */
                '--pull': tick.at < 0.06 ? '0%' : tick.at > 0.94 ? '-100%' : '-50%',
              } as React.CSSProperties
            }
          >
            {tickLabel(tick.hz)}
          </span>
        ))}
      </div>
    </section>
  );
}
