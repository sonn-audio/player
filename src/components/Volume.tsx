/**
 * A zone's volume.
 *
 * Two things the contract asks for, and both are easy to get wrong:
 *
 *  - **The slider runs to `volumeLimits.max`, not to 100.** A zone can be capped, and a
 *    write above the cap lands *on* the cap rather than erroring — so a 0-100 slider on a
 *    capped zone would let the user drag into a range where the thumb springs back.
 *  - **The step buttons send `delta`, not an absolute.** Read-then-write races another
 *    client stepping the same zone; `delta` is resolved server-side. `volumeLimits.step`
 *    is how far one press should move.
 *
 * The slider is locally controlled *while dragging* only. Volume is the one control where
 * echoing the server on every frame is wrong: the zone reports the level it has reached,
 * which lags the thumb, and the thumb would stutter backwards under the finger. On release
 * local state is dropped and the zone takes over again.
 */
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import type { ApiZoneState } from '@/api/types';
import { Icon } from '@/components/Icon';

/** How long to keep showing the dragged value after release, so it does not flick back. */
const SETTLE_MS = 400;

export function Volume({
  zone,
  /**
   * Drop the step buttons and tighten the row.
   *
   * For the places that carry one volume among many — a row per room in the rail, the corner of
   * the now-bar — where two extra buttons per instance is most of the visual weight on the screen
   * and the slider alone already does the job. The buttons are the *only* thing that goes: the
   * slider still writes through `setVolume` and still respects `volumeLimits.max`, so a compact
   * instance is not a weaker control, just a quieter one.
   */
  compact = false,
  /**
   * Show the level as a percentage.
   *
   * Only honest when the zone runs to 100: on a capped zone the number *is* the volume, not a
   * percentage of anything the user set, so `40%` on a zone capped at 70 would be a third wrong. The
   * suffix is therefore dropped for a capped room, where the read-out keeps its `40 / 70` form and the
   * tooltip says where the ceiling is.
   */
  percent = false,
}: {
  zone: ApiZoneState;
  compact?: boolean;
  percent?: boolean;
}) {
  const api = useApi();
  const [dragging, setDragging] = useState<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const max = zone.volumeLimits.max;
  const step = zone.volumeLimits.step || 1;
  const shown = dragging ?? Math.min(zone.volume, max);

  const commit = (value: number) => {
    setDragging(value);
    void api.setVolume(zone.id, value);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setDragging(null), SETTLE_MS);
  };

  return (
    <div className="volume" data-compact={compact || undefined}>
      {!compact && (
        <button
          type="button"
          className="icon-button small"
          title={`Down ${step}`}
          onClick={() => void api.nudgeVolume(zone.id, -step)}
        >
          <Icon name="volume-down" />
        </button>
      )}

      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={shown}
        aria-label="Volume"
        /*
         * The filled part of the track is a gradient stop, not a browser feature: `--fill` is what the
         * thin slider in styles.css paints up to. Percent of the zone's *own* maximum, so a room capped
         * at 70 still fills its slider at 70.
         */
        style={{ '--fill': `${max > 0 ? (shown / max) * 100 : 0}%` } as React.CSSProperties}
        onChange={(event) => setDragging(Number(event.target.value))}
        onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
      />

      {!compact && (
        <button
          type="button"
          className="icon-button small"
          title={`Up ${step}`}
          onClick={() => void api.nudgeVolume(zone.id, step)}
        >
          <Icon name="volume-up" />
        </button>
      )}

      <span className="volume-value" title={max < 100 ? `Capped at ${max}` : undefined}>
        {Math.round(shown)}
        {max < 100 ? <span className="volume-cap"> / {max}</span> : percent ? '%' : ''}
      </span>
    </div>
  );
}
