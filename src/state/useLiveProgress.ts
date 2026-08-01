/**
 * A progress value that moves between server ticks.
 *
 * `zone.progress` arrives once a second, which is correct but visibly steppy on a wide
 * progress bar. This interpolates from the last known position using the wall clock, and
 * re-anchors whenever the server speaks — so the bar is smooth, but the server is still
 * the only thing that decides where we are.
 *
 * Anchoring rather than counting is the important part: a client that incremented its own
 * counter would drift away from the zone and keep the drift across a pause, a seek, or a
 * track change.
 */
import { useEffect, useRef, useState } from 'react';
import type { ApiZoneState } from '@/api/types';

/** How often to repaint between ticks. ~30fps is smooth without being a busy loop. */
const PAINT_INTERVAL_MS = 33;

export function useLiveProgress(zone: ApiZoneState | null): number {
  const [position, setPosition] = useState(zone?.position ?? 0);
  const anchor = useRef({ at: 0, position: 0 });

  const serverPosition = zone?.position ?? 0;
  const playing = zone?.state === 'playing';

  // Re-anchor on every server position. Also covers seeks and track changes, which
  // arrive as an ordinary position change.
  useEffect(() => {
    anchor.current = { at: performance.now(), position: serverPosition };
    setPosition(serverPosition);
  }, [serverPosition, zone?.id]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = setInterval(() => {
      const elapsed = (performance.now() - anchor.current.at) / 1000;
      setPosition(anchor.current.position + elapsed);
    }, PAINT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing]);

  // A duration of 0 means open-ended (live radio), so there is nothing to clamp against.
  const duration = zone?.duration ?? 0;
  return duration > 0 ? Math.min(position, duration) : position;
}
