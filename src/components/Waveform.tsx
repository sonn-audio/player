/**
 * The position, as a line.
 *
 * This drew the track's own envelope — a scanned waveform for anything backed by a file, the playhead
 * moving across it — and it was the second moving picture on a face that already has one. Two of them
 * on one panel is what made the display impossible to make big: whatever the layout, the type and the
 * numbers had to share a surface with a spectrum *and* a waveform, and something always ended up
 * printed over something else. Given the choice, the reading of the audio is the one worth keeping —
 * that is what this face is for — so the timeline gives up its picture and becomes what it always was
 * underneath: a groove, the part that has played, a lit point where the music is, and the two numbers
 * that matter.
 *
 * What goes with it: the shape request (`useTrackWaveform`), the bar-density measurement and its
 * observer, and the `fitLevels` resampling. The art face keeps its own wave — one moving picture is
 * exactly what that face has room for.
 *
 * `-0:41` before `5:18`, in that order: "how much longer" is the question people actually have, and
 * the total is the reference that makes it meaningful. A live stream has neither.
 */
import { useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useLiveProgress } from '@/state/useLiveProgress';
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
  return (
    <div className="wave" data-seekable={seekable || undefined}>
      <span className="wave-time">{formatTime(position)}</span>

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
        {/* What has played, in the groove. */}
        <span className="wave-played" style={{ width: `${fraction * 100}%` }} aria-hidden="true" />

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

      {zone.duration > 0 ? (
        <span className="wave-time wave-time-end">
          <span className="wave-remain">-{formatTime(Math.max(0, zone.duration - position))}</span>
          <span className="wave-total">{formatTime(zone.duration)}</span>
        </span>
      ) : zone.track ? (
        /* No end in sight *and something playing* is a live stream. An idle zone also has no
           duration, and calling silence LIVE was this label lying with confidence. */
        <span className="wave-time wave-time-end">
          <span className="wave-live">{LIVE_LABEL}</span>
        </span>
      ) : null}
    </div>
  );
}
