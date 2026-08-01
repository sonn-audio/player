/**
 * One volume gesture, shared by every slider in the art player.
 *
 * There are four of them — the stage's, the phone's, the mini bar's, and one per room in both the
 * strip and the rooms sheet — and they all have to behave identically in the one way that is easy to
 * get wrong: **the thumb follows the finger, not the server.**
 *
 * A zone reports the level it has *reached*, which lags the gesture by a round trip and, on a device
 * with fading, by the fade itself. Echoing that on every frame makes the thumb stutter backwards
 * under the finger. So the dragged value is held locally while dragging and for a moment after
 * release, and then the zone takes over again — the same trade the technical player's `Volume`
 * makes, extracted here because five copies of it would drift.
 *
 * The scale runs to `volumeLimits.max`, never to 100: a capped zone would otherwise let you drag
 * into a range where the thumb springs back, since the server lands a too-high write *on* the cap
 * rather than refusing it.
 */
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { horizontalDrag, verticalDrag } from '@/art/drag';
import type { ApiZoneState } from '@/api/types';

/** How long the dragged value survives release, so it does not flick back to a stale report. */
const SETTLE_MS = 400;

export type VolumeControl = {
  /** What to display — the drag while dragging, the zone otherwise. */
  value: number;
  /** The same as a percentage of the zone's own maximum, for a `width` or a `left`. */
  pct: string;
  /** True during a gesture: what the readout bubble and the thicker rail key off. */
  active: boolean;
  /** Attach to a horizontal rail (stage, phone, mini bar, room rows). */
  onPointerDownH: (event: React.PointerEvent) => void;
  /** Attach to a vertical fader (the channel strip). */
  onPointerDownV: (event: React.PointerEvent) => void;
};

export function useVolumeControl(zone: ApiZoneState | null): VolumeControl {
  const api = useApi();
  const [dragging, setDragging] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(settle.current), []);

  const max = zone?.volumeLimits.max ?? 100;
  const value = dragging ?? Math.min(zone?.volume ?? 0, max);

  const write = (fraction: number): void => {
    if (!zone) {
      return;
    }
    const next = Math.round(fraction * max);
    setDragging(next);
    void api.setVolume(zone.id, next);
  };

  const end = (): void => {
    setActive(false);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setDragging(null), SETTLE_MS);
  };

  return {
    value,
    pct: `${max > 0 ? (value / max) * 100 : 0}%`,
    active,
    onPointerDownH: horizontalDrag(write, () => setActive(true), end),
    onPointerDownV: verticalDrag(write, () => setActive(true), end),
  };
}
