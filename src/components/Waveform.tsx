/**
 * The timeline, as the envelope of what has played.
 *
 * Two sources, in order of preference. A **prepared** shape (`useTrackWaveform`) is the whole track,
 * scanned from the file before a note is played, so the timeline arrives complete and the playhead
 * moves across a waveform instead of drawing one. Where there is none — every streaming service, whose
 * audio only exists while it plays — it falls back to the **recorded** envelope of what has been
 * listened to (`useLoudnessHistory`): honest, and half a picture, since opening a track at 2:00 leaves
 * the first two minutes flat.
 *
 * Two states below the ideal, both deliberate:
 *
 *  - **No measurement.** A server whose analysis stream is silent, or a zone whose output does not
 *    carry a visualiser, leaves this a flat hairline that still scrubs. A slim bar is a worse picture
 *    and a perfectly good control; a *fabricated* waveform would be a better picture and a lie.
 *  - **No duration.** Live radio has a position that climbs and no end, so there is nothing to divide
 *    into buckets and nothing to seek to. It says LIVE and shows the elapsed time.
 *
 * **It is also the scrubber.** It was drawn beside a slim bar for a while, on the theory that a picture
 * and a control should be separate things — but the picture's played half is green and grows to the
 * right, so it *was* a progress bar, and the two of them stacked read as the position drawn twice.
 * One element now: the envelope, the playhead, and the seek gesture.
 */
import { useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useLiveProgress } from '@/state/useLiveProgress';
import { useLoudnessHistory } from '@/state/useLoudnessHistory';
import { useTrackWaveform } from '@/state/useTrackWaveform';
import { formatTime, LIVE_LABEL } from '@/lib/format';
import type { ApiZoneState } from '@/api/types';

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
  // The envelope is recorded against the *server's* position, never the dragged one — a scrub should
  // not write samples at a place the audio has not reached.
  const { levels: recorded, measured } = useLoudnessHistory(zone, live);
  /*
   * The prepared shape wins where there is one, and there is no blend between the two: they are the
   * same measurement of the same audio, so mixing them would only make the seam between "scanned" and
   * "heard" visible for no gain. The recording keeps running underneath — it costs nothing and it is
   * what draws the track that has no file behind it.
   */
  const prepared = useTrackWaveform(zone);
  const levels = prepared ?? recorded;
  const hasShape = prepared !== null || measured;

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
