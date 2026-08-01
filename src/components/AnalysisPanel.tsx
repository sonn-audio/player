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
import { useState } from 'react';
import {
  useAnalysis,
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
        `data-settling` while the music is not running.
        The stream closes on pause, the bins go empty and every bar is asked to become zero — which at
        the live transition speed is a display being switched off. Marked here and slowed in CSS, the
        same zero reads as the sound decaying out of the room, which is what actually just happened.
      */}
      <div
        className="spectrum"
        aria-label="Spectrum"
        data-eq={showEq || undefined}
        data-settling={!active || undefined}
      >
        {bars.map((bin, index) => (
          <i
            key={index}
            style={
              {
                '--h': `${toHeight(bin) * 100}%`,
                '--p': `${(analysis.peaks[index] ?? 0) * 100}%`,
              } as React.CSSProperties
            }
          >
            {/*
              The lit column is a child rather than a pseudo-element, so that `::before` is free to be
              the unlit grid — and the grid is the one layer that has to be *masked* to fade out. A mask
              on the column itself would take the lit fill and the peak cap with it, since those would
              be its own children.
            */}
            <span />
          </i>
        ))}
        {showEq && <EqOverlay zoneId={zoneId} />}
      </div>

      {/* Loudness, as a hairline under the spectrum rather than a bar above it: it is one number,
          and it belongs to the whole display instead of competing with it. */}
      <div className="analysis-meter" style={{ '--level': `${level}%` } as React.CSSProperties}>
        <span />
      </div>

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
