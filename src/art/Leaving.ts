/**
 * The line that is leaving.
 *
 * A track change was a cut dressed as a fade: the old words were unmounted the instant the new ones
 * arrived — keyed remounts, see `Stage` — and what you saw was a hole, and then new type rising into
 * it. A fade-in is not a fade. A dissolve is two things at once, and the old one has to still be
 * there to dissolve *from*.
 *
 * So the words that are leaving are kept for one more beat. This hook hands back the value that was
 * on screen before the current one, with the id it belonged to, and nothing else: the caller draws it
 * as a plain, unpressable copy of itself laid over the same spot, and lets it blur away while its
 * replacement rises through it. When the beat is over the copy is dropped, so the page is never left
 * holding an invisible second title.
 *
 * Keeping the *value* rather than a snapshot of the DOM is what makes the title work. The name's size
 * is measured into its box (see `useFitText`), so a copy of the outgoing name needs the size that was
 * measured for *that* name — and the hook holds the freshest value for as long as an id is on screen,
 * so what leaves is what was actually there rather than what first arrived.
 *
 * The change is *noticed* during render, where a value derived from props belongs, and *announced*
 * from a layout effect, before the browser paints. Announcing it during render looked equivalent and
 * was not: the extra pass React runs for a render-phase update produced the copy and then threw the
 * pass away, so the effect never fired and the copy was never committed. A layout effect lands in the
 * same frame and actually sticks.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type Leaving<T> = { id: string; value: T } | null;

/** Long enough for the copy to have gone; see `cx-word-out` in `art.css`. */
const BEAT_MS = 360;

export function useLeaving<T>(id: string, value: T): Leaving<T> {
  const onScreen = useRef<{ id: string; value: T } | null>(null);
  const pending = useRef<{ id: string; value: T } | null>(null);
  const [leaving, setLeaving] = useState<{ id: string; value: T } | null>(null);

  if (onScreen.current === null) {
    /* The first arrival has nothing to dissolve from, and should not pretend otherwise. */
    onScreen.current = { id, value };
  } else if (onScreen.current.id !== id) {
    pending.current = onScreen.current;
    onScreen.current = { id, value };
  } else {
    /* Same record, new render — the position ticks every second. Keep the freshest value so that
       whenever the change does come, what leaves is what was actually on screen. */
    onScreen.current.value = value;
  }

  useLayoutEffect(() => {
    if (pending.current !== null) {
      setLeaving(pending.current);
      pending.current = null;
    }
  });

  useEffect(() => {
    if (leaving === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      /* Only this copy: another change may have started a newer one while this was running out. */
      setLeaving((current) => (current === leaving ? null : current));
    }, BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return leaving;
}
