/**
 * The two edges of the player, and the rules they share.
 *
 * The queue runs down the right edge and the house along the bottom, and both live folded: a lane of bare
 * sleeves, a row of room names. Both unfold on intent. Because they are two halves of one idea they cannot
 * each own their own state — the rules are about the *pair*:
 *
 *  - **A pointer just arrives.** No delay: both sit against a window edge, so you cannot cross one on the
 *    way to something else. Leaving folds it again.
 *  - **A finger presses a grip**, and what it opens stays open — a wall panel has no hover, and nothing is
 *    worse than chrome that leaves while you are reaching for it.
 *  - **Only one at a time, on touch.** Opening the lane folds the dock and the other way round. Both open
 *    at once on a 10-inch panel leaves nothing in the middle, which is where the record is.
 *  - **Seven seconds.** A panel opened by a finger has no leave event to close it, so it closes itself.
 *    Long enough to set three rooms' levels, short enough that a panel left alone returns to the record.
 *
 * `hover: none` is watched rather than sniffed, because a Surface is both and the answer changes when a
 * keyboard is folded back. Whenever it flips, everything folds: the affordances just changed underneath
 * whatever was open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a finger-opened edge stays open with nothing further happening. */
const ARM_MS = 7000;

export type Edge = 'lane' | 'dock' | null;

export type Edges = {
  /** Which edge is unfolded, if either. */
  open: Edge;
  /** True when the device has no hover to give: grips appear, pointer handlers do not. */
  touch: boolean;
  /** For a pointer arriving. Does not arm the timer — a leave event will do the closing. */
  enter: (edge: Exclude<Edge, null>) => void;
  leave: (edge: Exclude<Edge, null>) => void;
  /** For a grip. Arms the seven seconds, and folds the other edge. */
  toggle: (edge: Exclude<Edge, null>) => void;
  /** Fold everything — the screensaver and the sheets both need it. */
  closeAll: () => void;
};

export function useEdges(): Edges {
  const [open, setOpen] = useState<Edge>(null);
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches,
  );
  const timer = useRef<number | undefined>(undefined);

  const disarm = useCallback(() => window.clearTimeout(timer.current), []);

  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(null), ARM_MS);
  }, []);

  useEffect(() => disarm, [disarm]);

  useEffect(() => {
    const media = window.matchMedia('(hover: none)');
    const onChange = (event: MediaQueryListEvent): void => {
      setTouch(event.matches);
      setOpen(null);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const closeAll = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(null);
  }, []);

  const enter = useCallback((edge: Exclude<Edge, null>) => setOpen(edge), []);

  const leave = useCallback(
    (edge: Exclude<Edge, null>) =>
      // Only fold the edge that was actually left: the pointer may already have arrived at the other one,
      // and a stale leave must not close what a fresh enter has just opened.
      setOpen((was) => (was === edge ? null : was)),
    [],
  );

  const toggle = useCallback(
    (edge: Exclude<Edge, null>) => {
      setOpen((was) => (was === edge ? null : edge));
      arm();
    },
    [arm],
  );

  // A toggle that turned out to be a *close* has nothing to time out; clearing it costs a render nothing
  // and leaves no stray timer to fold an edge somebody opened a second later with the pointer.
  useEffect(() => {
    if (open === null) {
      disarm();
    }
  }, [open, disarm]);

  return { open, touch, enter, leave, toggle, closeAll };
}

/** Escape folds whatever is open — the one shortcut a thing that covers content owes you. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
