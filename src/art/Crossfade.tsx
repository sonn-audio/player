/**
 * Two slots, one dissolve — how every artwork-derived layer in this face changes.
 *
 * The wash behind the desktop page and the phone's background are both *the artwork*, blurred past
 * recognition. When the track changes they must dissolve, not cut: a hard swap of a full-window field is
 * the single most jarring thing a music player can do.
 *
 * A CSS transition cannot do it. A `background-image` does not interpolate — a `transition: background`
 * between two urls snaps at the halfway point. (The *accent* is a different problem with a different
 * answer: it is a single plain colour, so `@property` registration makes it interpolate on its own. See
 * `art.css`.)
 *
 * So: two elements that always exist, one showing and one hiding, swapping roles on every change.
 * Opacity is the one thing that always animates cheaply, and cross-dissolving two composited layers
 * is what a dissolve *is*.
 *
 * The flip happens in an effect rather than during render, which means the very first commit paints
 * slot 0 and the effect immediately promotes slot 1 to the front with identical content — a dissolve
 * between two copies of the same thing, i.e. nothing, which is exactly what an arrival should be.
 */
import { useEffect, useState, type ReactNode } from 'react';

/** What one layer draws from: the artwork, blurred past recognition. */
export type ArtSlot = {
  /** `url("…")`, ready for `background-image`. Undefined when the room is playing nothing. */
  cover: string | undefined;
};

export function Crossfade({
  artKey,
  cover,
  ms = 1900,
  render,
}: {
  /** Changes when the artwork changes — see `artKeyOf`. Drives the swap and nothing else. */
  artKey: string;
  cover: string | undefined;
  /** How long the dissolve takes. Slow on purpose: this is light in a room, not a transition. */
  ms?: number;
  render: (slot: ArtSlot, index: number) => ReactNode;
}) {
  const [state, setState] = useState<{ front: 0 | 1; slots: [ArtSlot, ArtSlot] }>(() => {
    const initial: ArtSlot = { cover };
    return { front: 0, slots: [initial, initial] };
  });

  useEffect(() => {
    setState((prev) => {
      const front: 0 | 1 = prev.front === 0 ? 1 : 0;
      const slots: [ArtSlot, ArtSlot] = [...prev.slots] as [ArtSlot, ArtSlot];
      slots[front] = { cover };
      return { front, slots };
    });
    // `artKey` alone: `cover` is derived from it, and listing it would swap the layers on every
    // re-render that happened to produce a new string — which is every second, because the position
    // ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey]);

  return (
    <>
      {state.slots.map((slot, index) => (
        <span
          // Two fixed slots, so the key is the position, not the content. Keying by content is what
          // would unmount the outgoing layer and turn the dissolve back into a cut.
          key={index}
          className="cx-xfade"
          data-front={index === state.front || undefined}
          style={{ transitionDuration: `${ms}ms` }}
          aria-hidden="true"
        >
          {render(slot, index)}
        </span>
      ))}
    </>
  );
}
