/**
 * One room's alignment delay, and the rules for changing it.
 *
 * Extracted so the two places that offer this control cannot disagree about *how* a delay is
 * committed — the technical face's grouping screen and the art face's rooms sheet. What each of them
 * draws is their own business; when a write happens, and what the number reads while the server
 * catches up, is one decision and lives here.
 *
 * **The direction is the thing to understand, and it is not the intuitive one.** The value is how
 * much delay a speaker's own chain adds *after* our output — an amplifier, an active speaker — and
 * the player compensates by sending that much earlier. So you raise it on the room that arrives
 * *late*, never on the one that runs ahead. The protocol has no negative form and needs none: in any
 * pair there is always one that lags.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import type { ApiZoneState } from '@/api/types';

/**
 * The axis, and the nudge.
 *
 * The API accepts up to 10 s; speaker-to-speaker alignment lives in the tens of milliseconds, so a
 * 500 ms axis puts the useful travel across the whole width. 5 ms is roughly where a difference stops
 * being audible as a smear on transients — small enough to home in on, large enough that the buttons
 * get you somewhere.
 */
export const DELAY_MAX_MS = 500;
export const DELAY_NUDGE_MS = 5;

export type OutputDelay = {
  /** What to draw: the drag, then the unconfirmed write, then the server's own value. */
  delayMs: number;
  /** False for an output with no clock to align against — the control is meaningless there. */
  settable: boolean;
  /** The last write was refused. Cleared by the next one. */
  failed: boolean;
  /** While a finger is on the axis. Draws, does not write. */
  drag: (next: number) => void;
  /** Writes, clamped to the axis. */
  commit: (next: number) => void;
};

export function useOutputDelay(zone: ApiZoneState): OutputDelay {
  const api = useApi();
  const sync = zone.output?.sync;
  const [pending, setPending] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * The local value stands until the zone reports the same number back.
   *
   * The PUT's response and the `zone.changed` it triggers are two separate deliveries; dropping the
   * local value on the first one makes the control snap back to the old number for a frame.
   */
  useEffect(() => {
    if (pending !== null && sync?.delayMs === pending) {
      setPending(null);
    }
  }, [pending, sync?.delayMs]);

  return {
    delayMs: dragging ?? pending ?? sync?.delayMs ?? 0,
    settable: sync != null,
    failed,
    drag: setDragging,
    /*
     * The write happens on release, never per step: each commit is a config write plus a push to the
     * device, and a drag across the axis would be a hundred of them. A nudge commits immediately —
     * one 5 ms step is exactly the "try it" gesture this control is for.
     */
    commit: (next: number) => {
      const clamped = Math.max(0, Math.min(DELAY_MAX_MS, Math.round(next)));
      setDragging(null);
      setFailed(false);
      setPending(clamped);
      void api.setOutputDelay(zone.id, clamped).catch(() => {
        setPending(null);
        setFailed(true);
      });
    },
  };
}
