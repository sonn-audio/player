/**
 * When nobody has touched it for a while.
 *
 * This face spends most of its life on a wall panel or a spare tablet, not being used — and *that*
 * state is the one worth designing, because it is the one the room actually looks at. So after a
 * minute of nothing, the chrome leaves and the record stays: the sleeve, the title, the room, the
 * time. See `.cx-root[data-idle]` in `art.css` for what that looks like.
 *
 * Only while something is playing. Dimming a screen that says "the house is quiet — 4 rooms ready"
 * hides the one thing on it that was any use, and a panel that goes blank when the music stops looks
 * broken rather than restful.
 *
 * `pointermove` is deliberately *not* in the list on its own terms — it is, but with a movement
 * threshold, because a mouse resting on a desk emits jitter from the sensor and a bus rumbling past a
 * tablet emits it from the digitiser. Without the threshold the dim never arrives on exactly the
 * machines it exists for.
 */
import { useEffect, useState } from 'react';

/** How far a pointer has to actually travel before it counts as someone being there. */
const MOVE_THRESHOLD_PX = 8;

export function useIdle(afterMs: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return undefined;
    }

    let timer = window.setTimeout(() => setIdle(true), afterMs);
    let lastX = 0;
    let lastY = 0;

    const wake = (): void => {
      window.clearTimeout(timer);
      // Reading state in a setter rather than closing over `idle`, so this effect does not have to be
      // torn down and rebuilt on every wake — which would restart the timer from the listener and make
      // the dim arrive late by however long the last interaction took.
      setIdle((was) => (was ? false : was));
      timer = window.setTimeout(() => setIdle(true), afterMs);
    };

    const onMove = (event: PointerEvent): void => {
      if (Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) < MOVE_THRESHOLD_PX) {
        return;
      }
      lastX = event.clientX;
      lastY = event.clientY;
      wake();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', wake);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('wheel', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [afterMs, enabled]);

  return idle;
}

/** `21:04` — the one readout the dimmed screen carries, because a panel on a wall is also a clock. */
export function useClock(active: boolean): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, [active]);

  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
