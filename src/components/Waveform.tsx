/**
 * The timeline, as the envelope of what has played.
 *
 * One source. A **prepared** shape (`useTrackWaveform`) is the whole track, scanned from the file
 * before a note is played, so the timeline arrives complete and the playhead moves across a waveform
 * instead of drawing one. That needs a file, which every streaming service is not: their audio only
 * exists while it plays.
 *
 * Two states below the ideal, both deliberate:
 *
 *  - **No shape.** Streaming, or a file the server could not read, leaves this a flat hairline that
 *    still scrubs. A slim bar is a worse picture and a perfectly good control; a *fabricated*
 *    waveform, or half of a real one drawn as though it were whole, would be a better picture and a
 *    lie.
 *  - **No duration.** Live radio has a position that climbs and no end, so there is nothing to divide
 *    into buckets and nothing to seek to. It says LIVE and shows the elapsed time.
 *
 * **It is also the scrubber.** It was drawn beside a slim bar for a while, on the theory that a picture
 * and a control should be separate things — but the picture's played half is green and grows to the
 * right, so it *was* a progress bar, and the two of them stacked read as the position drawn twice.
 * One element now: the envelope, the playhead, and the seek gesture.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useLiveProgress } from '@/state/useLiveProgress';
import { useTrackWaveform } from '@/state/useTrackWaveform';
import { formatTime, LIVE_LABEL } from '@/lib/format';
import { fitLevels } from '@/lib/waveformScale';
import type { ApiZoneState } from '@/api/types';

/**
 * Horizontal space per bar, including the 1px gap between them.
 *
 * Three pixels is where a waveform stops reading as a bar chart, which is the number both level
 * sources were originally written around — each guessing at the width it would be drawn in, and
 * disagreeing (400 buckets assumed ~1200px, 220 assumed ~660px). The strip is measured now, so this
 * is the only place a pixel figure appears and it is a density rather than a width.
 */
const BAR_PITCH_PX = 3;

export function Waveform({ zone }: { zone: ApiZoneState }) {
  const api = useApi();
  const live = useLiveProgress(zone);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  /*
   * Where the pointer is over the timeline, as a fraction — the scope's cursor.
   *
   * An instrument answers before you commit: hovering the envelope shows a hairline and the time
   * it would seek to, so scrubbing starts as a measurement instead of a guess. Mouse only — under
   * a finger the cursor would sit exactly where the finger is hiding it, and touch already gets
   * its answer from the drag itself (`wave-time` follows the scrub).
   */
  const [hover, setHover] = useState<number | null>(null);

  const seekable = zone.source?.seekable === true && zone.duration > 0;
  // While a drag is in flight the display follows the finger, not the server: the zone reports where
  // playback actually is, which lags the gesture, and the playhead would jump backwards under it.
  const position = scrubbing ?? live;
  const fraction = zone.duration > 0 ? Math.min(1, position / zone.duration) : 0;
  /*
   * A shape, or a progress bar. Nothing in between.
   *
   * There used to be a fallback: where no file could be scanned, the display drew the envelope of what
   * had been *listened to* instead. It was honest and it was half a picture — nothing ahead of the
   * playhead, because nothing has measured the future — and on a streaming track that is most of the
   * bar. Read as a picture it looks like a waveform that has broken rather than one that cannot exist,
   * which is the wrong thing for a display whose whole point is not claiming measurements it does not
   * have.
   *
   * So the rule is the one the server can actually honour: a track backed by a file gets its shape,
   * everything else gets the slim bar, and the slim bar was always a perfectly good scrubber.
   */
  const prepared = useTrackWaveform(zone);
  const source = prepared ?? [];
  const hasShape = prepared !== null;

  /*
   * How many bars fit, measured rather than assumed.
   *
   * The playhead and the played line are positioned as a percentage of this element, so the bars have
   * to span exactly this element too or the picture and the position drift apart. Measured
   * synchronously on mount as well as observed, so the first paint is already right instead of showing
   * one frame at the data's own density.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [barCount, setBarCount] = useState(0);
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) {
      return undefined;
    }
    const fit = (width: number): void => {
      setBarCount(width > 0 ? Math.max(1, Math.floor(width / BAR_PITCH_PX)) : 0);
    };
    fit(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      fit(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const levels = barCount > 0 ? fitLevels(source, barCount) : source;

  return (
    <div className="wave" data-measured={hasShape || undefined} data-seekable={seekable || undefined}>
      <span className="wave-time">{formatTime(position)}</span>

      {/*
        A continuous baseline, with bars on top of it.

        The baseline is drawn by CSS across the whole body, so an unmeasured bucket renders *nothing*
        and the line shows through. Rendering those buckets as short hairlines instead turned the
        un-played part of every track into a dotted rule, which read as a broken waveform rather than
        as one that has not been recorded yet — and that is the normal state for the first seconds of
        anything and for the whole of a track on an output with no visualiser.
      */}
      <div
        className="wave-body"
        ref={bodyRef}
        onPointerMove={(event) => {
          if (!seekable || event.pointerType !== 'mouse') {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* The played part of the baseline, as one line rather than as a tick per unmeasured bucket.
            Opening the player mid-track means most of what has played was never measured here, and
            drawing those as dim green dots made the honest gap read as noise. */}
        <span className="wave-played" style={{ width: `${fraction * 100}%` }} aria-hidden="true" />

        <div className="wave-bars" aria-hidden="true">
          {Array.from(levels, (level, index) => {
            const at = (index + 0.5) / levels.length;
            return (
              <i
                key={index}
                data-played={at <= fraction || undefined}
                data-void={level < 0 || undefined}
                style={{ '--h': `${Math.max(6, level * 100)}%` } as React.CSSProperties}
              />
            );
          })}
        </div>

        {/* The playhead, so the boundary between played and unplayed is a *position* rather than only a
            colour change — which matters most at the start of a track, where there is barely any
            colour to change. */}
        <span className="wave-head" style={{ left: `${fraction * 100}%` }} aria-hidden="true" />

        {/* The cursor: the hairline and the time it would seek to. Suppressed mid-scrub, where the
            elapsed readout is already following the finger and a second time would disagree with it. */}
        {hover !== null && scrubbing === null && (
          <>
            <span className="wave-cursor" style={{ left: `${hover * 100}%` }} aria-hidden="true" />
            <span className="wave-cursor-time" style={{ left: `${hover * 100}%` }} aria-hidden="true">
              {formatTime(hover * zone.duration)}
            </span>
          </>
        )}

        {seekable && (
          <input
            type="range"
            min={0}
            max={zone.duration}
            step={1}
            value={position}
            aria-label="Position"
            onChange={(event) => setScrubbing(Number(event.target.value))}
            onPointerUp={(event) => {
              const target = Number((event.target as HTMLInputElement).value);
              setScrubbing(null);
              void api.seek(zone.id, target);
            }}
          />
        )}
      </div>

      {/*
        Remaining and total, in that order: "how much longer" is the question people actually have,
        and the total is the reference that makes it meaningful. A live stream has neither.
      */}
      {zone.duration > 0 ? (
        <span className="wave-time wave-time-end">
          <span className="wave-remain">-{formatTime(Math.max(0, zone.duration - position))}</span>
          <span className="wave-total">{formatTime(zone.duration)}</span>
        </span>
      ) : (
        <span className="wave-time wave-time-end">
          <span className="wave-live">{LIVE_LABEL}</span>
        </span>
      )}
    </div>
  );
}
