/**
 * The sleeve flies between the two faces.
 *
 * Both players show the same artwork — a 340px hero in the technical one, a half-window sleeve in the
 * art one, a 44px thumbnail in the bar along the bottom — and that is the one thing on screen that is
 * *the same object* before and after a switch. So it should move, and everything else should merely
 * change: a transition earns its keep when it says "this became that", and it is decoration when it
 * says "something happened".
 *
 * **It flies as a clone, not as either face's own element.** The obvious implementation — measure the
 * old cover, then FLIP the new one from that rect — cannot work here, because the incoming face fades
 * in as a whole (`.face[data-entered]`, see `shell.css`) and a child cannot opt out of an ancestor's
 * opacity. Animating a detached copy above both faces sidesteps that completely: neither face has to
 * know a transition is happening, neither one's own entrance is touched, and the flight is a single
 * composited layer that cannot be interfered with by a reflow in the tree underneath.
 *
 * The clone carries the *computed* look of what it left — image, radius, shadow — so at the first frame
 * it is pixel-identical to the cover that was there, and at the last it is pixel-identical to the one
 * that has arrived. In between it is the only thing moving.
 */

import { useCallback } from 'react';

/** What was on screen when the switch was pressed. */
type Capture = {
  rect: DOMRect;
  image: string;
  radius: string;
  shadow: string;
  /** When it was taken, so a stale capture cannot fire a flight into an unrelated navigation. */
  at: number;
};

/**
 * How long a capture stays usable.
 *
 * The gap between pressing the switch and the new face's cover mounting is one or two frames in
 * practice. A whole second is generous on purpose — a cold first paint of the art face on a slow panel
 * has to fetch a stylesheet — but bounded, because a capture that never expires means a face reached by
 * a *later* reload would animate a sleeve in from wherever the pointer once was.
 */
const FRESH_MS = 1000;

/**
 * How long the flight takes.
 *
 * 760ms, which is slow for an interface and right for this: the sleeve is the only thing on screen that
 * exists before *and* after, so it is the thread the eye holds while everything else is replaced. Rushed,
 * it reads as a glitch between two screens; given the time, it reads as one room rearranging itself. The
 * rest of the face is timed against it — see `.face[data-morph]` in `shell.css`.
 */
const FLIGHT_MS = 760;

/** The fold curve: leaves at once, arrives almost imperceptibly. Nothing should *stop*, it should settle. */
const EASE = 'cubic-bezier(0.22, 0.9, 0.24, 1)';

let pending: Capture | null = null;

/**
 * Marks the biggest cover on screen for the flight.
 *
 * Biggest rather than first, because both faces can have two at once — the technical player shows a
 * hero *and* a 44px thumbnail in the bottom bar, and the one the eye is on is the one that should move.
 * Area, not width: a cover clipped to a sliver by a scrolled container should lose to a full one.
 */
export function captureCover(): boolean {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-morph="cover"]'));
  let best: HTMLElement | null = null;
  let bestArea = 0;

  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    // A hidden or unpainted cover measures zero and must not win by being first.
    if (area > bestArea && rect.width > 24) {
      best = element;
      bestArea = area;
    }
  }

  if (!best) {
    pending = null;
    return false;
  }

  const style = getComputedStyle(best);
  /*
   * Three ways a cover carries its picture, because the two faces draw them differently and both are
   * right where they are: the art face paints `background-image` on the element itself (it needs the
   * same picture cropped, blurred and tinted in five places, none of which is an image element), while
   * the technical player wraps a real `<img>` in a clipping box so a failed fetch can fall back to a
   * second url. `currentSrc` rather than `src` — it is the one the browser actually loaded, so the clone
   * cannot start a second download of a slightly different address.
   */
  const inner = best.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
  const image =
    style.backgroundImage !== 'none'
      ? style.backgroundImage
      : best instanceof HTMLImageElement && best.currentSrc
        ? `url("${best.currentSrc}")`
        : inner instanceof HTMLImageElement && inner.currentSrc
          ? `url("${inner.currentSrc}")`
          : inner instanceof HTMLVideoElement && inner.poster
            ? `url("${inner.poster}")`
            : '';

  if (!image) {
    pending = null;
    return false;
  }

  pending = {
    rect: best.getBoundingClientRect(),
    image,
    radius: style.borderRadius,
    shadow: style.boxShadow === 'none' ? '' : style.boxShadow,
    at: Date.now(),
  };
  return true;
}

/**
 * Flies the pending capture to where `element` now is.
 *
 * **The arriving face must not be mid-transform when this runs.** `getBoundingClientRect()` reports the
 * *rendered* box, so a face still holding the first frame of its `scale: 0.985` entrance measured 453px
 * where the sleeve was really 460px — the flight then landed 1.5% short and settled with a visible
 * seven-pixel jump. `Root` suppresses the scale for a switch that carries a sleeve (`data-morph` on
 * `.face`, see `shell.css`); the flight *is* the transition in that case, and a whole page zooming
 * behind a shared element was two motions arguing anyway.
 *
 * Call it from a layout effect on the arriving cover. Returns silently when there is nothing pending,
 * which is the common case: a reload, a deep link, or a switch made from a screen that had no artwork
 * on it all end up here and get the plain crossfade, correctly — there was no shared object to carry.
 */
export function flyTo(element: HTMLElement): void {
  const from = pending;
  pending = null;

  if (!from || Date.now() - from.at > FRESH_MS) {
    return;
  }
  if (typeof element.animate !== 'function') {
    return;
  }

  const to = element.getBoundingClientRect();
  if (to.width < 24 || from.rect.width < 24) {
    return;
  }

  /*
   * Centre-based FLIP.
   *
   * Mapping one rect onto another from their centres rather than their top-left corners means the
   * clone needs no `transform-origin` of its own — which matters because `transform-origin: 0 0` is
   * the kind of thing that silently breaks the moment something else in the stack sets a transform.
   */
  const dx = from.rect.left + from.rect.width / 2 - (to.left + to.width / 2);
  const dy = from.rect.top + from.rect.height / 2 - (to.top + to.height / 2);
  const sx = from.rect.width / to.width;
  const sy = from.rect.height / to.height;

  const clone = document.createElement('div');
  const toStyle = getComputedStyle(element);
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    backgroundImage: from.image,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    borderRadius: from.radius,
    boxShadow: from.shadow,
    // Above both faces and the splash's fade-out, below nothing: it is the transition.
    zIndex: '400',
    pointerEvents: 'none',
    willChange: 'transform',
  } satisfies Partial<CSSStyleDeclaration>);

  document.body.appendChild(clone);

  const animation = clone.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        borderRadius: from.radius,
        offset: 0,
      },
      { transform: 'none', borderRadius: toStyle.borderRadius, offset: 1 },
    ],
    { duration: FLIGHT_MS, easing: EASE, fill: 'both' },
  );

  /*
   * Removed when the flight ends *or* when it never does.
   *
   * `finished` rejects if the animation is cancelled and never settles if the tab is backgrounded
   * mid-flight, and a clone left behind is a dead sleeve pinned over the player. The timeout is the
   * one that actually has to be right.
   */
  const drop = (): void => clone.remove();
  animation.finished.then(drop).catch(drop);
  window.setTimeout(drop, FLIGHT_MS + 400);
}

/**
 * Marks a cover as the anchor: measured when leaving, flown to when arriving.
 *
 * A ref callback rather than an effect, because it has to run in the commit that inserted the element
 * and before the browser paints — an effect is one frame too late and the sleeve would appear at its
 * destination for a frame before flying in from behind itself. `useCallback` with no dependencies keeps
 * the identity stable so this fires exactly once per mount, and `flyTo` consumes the capture, so a
 * second cover mounting in the same commit gets nothing rather than a second flight.
 *
 * Spread onto the element together with `data-morph="cover"`, which is what `captureCover` looks for on
 * the way out. Both halves are needed and they are two different moments.
 */
export function useCoverAnchor(): { ref: (element: HTMLElement | null) => void; 'data-morph': 'cover' } {
  const ref = useCallback((element: HTMLElement | null) => {
    if (element) {
      flyTo(element);
    }
  }, []);
  return { ref, 'data-morph': 'cover' };
}
