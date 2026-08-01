/**
 * The 10-band equalizer, laid over the spectrum it is shaping.
 *
 * There is one analyser on the page and the equalizer borrows it, rather than drawing a second
 * spectrum of its own behind a second set of bars. That was the first attempt and it was the same
 * display twice.
 *
 * ## Why the handles land in the right places
 *
 * The spectrum's bars are equal-width cells over a log frequency range, so the x-fraction of the
 * display maps linearly onto log(Hz) — which means a band centre at frequency *f* belongs at exactly
 * `spectrumPosition(f)` of the width. No cell arithmetic: these are points positioned on a scale, not
 * cells to be matched up with other cells.
 *
 * That works because ISO band centres are octave-spaced and octaves are equal steps on a log axis, so
 * the ten handles come out ~11.6% apart. It is worth knowing this was luck: had the stream binned the
 * way the device capability advertises (mel, 20 Hz–20 kHz) the bottom four bands would crowd into the
 * first 8% of the width and an overlay would be unusable.
 *
 * **32 Hz is the exception** — it is below the analyser's 40 Hz floor, so it has no position on this
 * scale at all. It is pinned to the left edge and marked, because a band you cannot reach is worse
 * than one drawn slightly outside the range it would occupy.
 *
 * Configuration rather than transport, which shows in two ways the contract calls out: it works on an
 * idle zone, and `PUT` answers 200 with the **applied** bands instead of 204. Values are clamped
 * server-side to −6…+6, so the reply can differ from the request — this renders what came back rather
 * than what was sent, which is the whole reason it answers with a body.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { spectrumPosition, spectrumGeometry } from '@/state/useAnalysis';

/** ISO band centres, low first — the order the API sends and expects. */
const BAND_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const GAIN_MIN = -6;
const GAIN_MAX = 6;

/**
 * Where each band sits across the display, 0–1, and whether that position is truthful.
 *
 * Computed once: the band list and the analyser's range are both constants, so this cannot change at
 * runtime and does not belong in a render.
 */
const BAND_POSITIONS = BAND_HZ.map((hz) => {
  const at = spectrumPosition(hz);
  // Below the analyser's floor there is no honest position, so it goes to the edge and says so.
  return at === null ? { at: 0, offScale: true } : { at, offScale: false };
});

export function EqOverlay({ zoneId }: { zoneId: number }) {
  const api = useApi();
  const [bands, setBands] = useState<number[] | null>(null);

  useEffect(() => {
    let current = true;
    api
      .getEqualizer(zoneId)
      .then((eq) => {
        if (current) setBands(eq.bands);
      })
      .catch(() => {
        if (current) setBands(null);
      });
    return () => {
      current = false;
    };
  }, [api, zoneId]);

  if (!bands) {
    return null;
  }

  const commit = (next: number[]) => {
    setBands(next);
    // The reply is authoritative: a clamped value comes back different from what we sent.
    void api.setEqualizer(zoneId, next).then(setBands).catch(() => undefined);
  };

  /** Gain to a 0–100 y, with 0 dB at the middle and +6 dB at the top. */
  const yOf = (gain: number): number => 50 - (gain / GAIN_MAX) * 50;

  return (
    <div className="eq-overlay">
      {/*
        The overlay's own strip, and the reason for it: "Flat" belongs with the bands it resets — one
        copy of that state rather than two that can disagree — but anywhere *inside* the field would
        sit on top of a slider and steal its +6 dB end. So the overlay reserves a row at the top for
        itself and the handles start below it.
      */}
      <div className="eq-toolbar">
        {bands.some((gain) => gain !== 0) && (
          <button
            type="button"
            className="text-button eq-flat"
            onClick={() => commit(bands.map(() => 0))}
          >
            Flat
          </button>
        )}
      </div>

      {/*
        The curve, under the handles.
        `preserveAspectRatio="none"` lets a 100×100 viewBox stretch to whatever the panel is, so the
        points can be written in percentages and need no measurement of the DOM. This is what turns
        ten sliders into something you read as a response.
      */}
      <svg className="eq-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          points={bands
            .map((gain, index) => `${BAND_POSITIONS[index]!.at * 100},${yOf(gain)}`)
            .join(' ')}
        />
      </svg>

      {bands.map((gain, index) => {
        const { at, offScale } = BAND_POSITIONS[index]!;
        return (
          <label
            key={BAND_LABELS[index]}
            className="eq-handle"
            style={
              {
                left: `${at * 100}%`,
                /*
                 * Centred on its own frequency, except at the ends where centring would hang half the
                 * control off the panel. Same rule as the frequency labels.
                 */
                '--pull': at < 0.04 ? '0%' : at > 0.96 ? '-100%' : '-50%',
              } as React.CSSProperties
            }
            data-set={gain !== 0 || undefined}
          >
            <input
              type="range"
              /* Vertical, and the only range in the player that keeps its native appearance — see the
                 note on `.eq-handle input` in styles.css. The class is what excludes it from the thin
                 horizontal styling. */
              className="native-range"
              min={GAIN_MIN}
              max={GAIN_MAX}
              step={1}
              value={gain}
              // Vertical is a CSS orientation; the value is not inverted.
              onChange={(event) => {
                const next = [...bands];
                next[index] = Number(event.target.value);
                setBands(next);
              }}
              onPointerUp={() => commit(bands)}
              onKeyUp={() => commit(bands)}
              aria-label={`${BAND_LABELS[index]} Hz`}
            />
            <span className="eq-handle-label">
              {BAND_LABELS[index]}
              {offScale && (
                <span
                  className="eq-handle-note"
                  title={`The analyser starts at ${spectrumGeometry().fMin} Hz, so this band sits off the left of the scale`}
                >
                  *
                </span>
              )}
            </span>
            {gain !== 0 && (
              <span className="eq-handle-value">{gain > 0 ? `+${gain}` : gain}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

