/**
 * The position bar.
 *
 * Seekability comes from `source.seekable`, not from `duration > 0`. Inferring it works
 * today but the contract explicitly says not to repeat that assumption — a live stream has
 * no position to seek to, and the server is the one that knows.
 *
 * A non-seekable source still shows elapsed time: live radio has a position that climbs,
 * it just has no end and no target to jump to. Rendering it as a bar with no total is
 * honest; showing `0:00 / 0:00` would not be.
 */
import { useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useLiveProgress } from '@/state/useLiveProgress';
import { formatTime, LIVE_LABEL } from '@/lib/format';
import type { ApiZoneState } from '@/api/types';

export function ProgressBar({
  zone,
  /**
   * The bar alone: no times, and the playhead always drawn.
   *
   * For the now-playing block, where the waveform above it already states elapsed, remaining and
   * total — so a second pair of times would be the same three numbers twice. The visible playhead is
   * what makes this read as the control while the waveform beside it reads as the picture.
   */
  slim = false,
}: {
  zone: ApiZoneState;
  slim?: boolean;
}) {
  const api = useApi();
  const live = useLiveProgress(zone);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const seekable = zone.source?.seekable === true && zone.duration > 0;
  const position = scrubbing ?? live;
  const fraction = zone.duration > 0 ? Math.min(1, position / zone.duration) : 0;

  return (
    <div className="progress" data-seekable={seekable || undefined} data-slim={slim || undefined}>
      {!slim && <span className="progress-time">{formatTime(position)}</span>}

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${fraction * 100}%` }} />
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

      {!slim && (
        <span className="progress-time">
          {zone.duration > 0 ? formatTime(zone.duration) : LIVE_LABEL}
        </span>
      )}
    </div>
  );
}
