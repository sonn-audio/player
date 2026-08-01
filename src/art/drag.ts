/**
 * Pointer drags on a bar: the seek timeline, and every volume slider in this face.
 *
 * Native `<input type="range">` is what the technical player uses and it is the right call there —
 * it is keyboard-accessible for free and the browser paints the fill. This face draws its own 2px
 * rails with a 9px knob and a readout bubble that appears mid-gesture, none of which a native range
 * can be talked into, so the gesture is handled here instead. One helper, so the seek bar and the
 * four different volume sliders cannot end up with four subtly different drag behaviours.
 *
 * Three details that matter and are easy to miss:
 *
 *  - **Listeners go on the document**, not the element, so a drag that leaves the 2px rail (which is
 *    every drag) keeps tracking instead of stopping the moment the pointer moves off it.
 *  - **`pointercancel` ends it** as well as `pointerup`: on iOS a scroll gesture taking over fires
 *    only cancel, and without it the slider stays stuck in dragging state for good.
 *  - **The fraction is clamped**, because dragging past either end of the rail produces values
 *    outside 0–1 and a volume of 112 is a rejected request rather than a loud room.
 */

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Builds a `onPointerDown` handler that reports the drag position as a 0–1 fraction of the element
 * it is attached to.
 *
 * `onStart`/`onEnd` exist for the bubble and the thickened rail — the visual difference between
 * "showing a value" and "being dragged", which is the whole reason these sliders feel like faders.
 */
export function horizontalDrag(
  apply: (fraction: number) => void,
  onStart?: () => void,
  onEnd?: () => void,
): (event: React.PointerEvent) => void {
  return (event: React.PointerEvent) => {
    // Stops the browser from starting a text selection or a scroll from the same gesture.
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const at = (clientX: number): number => clamp((clientX - rect.left) / rect.width);
    onStart?.();
    apply(at(event.clientX));

    const move = (moved: PointerEvent): void => apply(at(moved.clientX));
    const up = (): void => {
      onEnd?.();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };
}

/**
 * The same, upwards — for the channel strip's faders, where 0 is at the bottom.
 *
 * A separate function rather than an axis flag: the inversion (`bottom - y`) is the entire
 * difference, and a boolean parameter at every call site reads worse than a name that says which way
 * is loud.
 */
export function verticalDrag(
  apply: (fraction: number) => void,
  onStart?: () => void,
  onEnd?: () => void,
): (event: React.PointerEvent) => void {
  return (event: React.PointerEvent) => {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    const at = (clientY: number): number => clamp((rect.bottom - clientY) / rect.height);
    onStart?.();
    apply(at(event.clientY));

    const move = (moved: PointerEvent): void => apply(at(moved.clientY));
    const up = (): void => {
      onEnd?.();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };
}
