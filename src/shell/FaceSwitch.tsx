/**
 * The corner that says where else you can be: **admin | technical**, or **admin | art**.
 *
 * The same argument as `Brand`, at the other end of the same bar. Each face used to draw its own way to
 * the other one: the technical player as a hairline box reading `Art mode`, the art player as a bare
 * label reading `technical`. Same corner, same job, two constructions — so switching face made the one
 * control that is *about* switching face blink and change shape underneath the cursor that had just
 * pressed it. It belongs to the frame now: it does not move, does not fade, and is not kept in step in
 * two stylesheets.
 *
 * The console sits beside it because it is the third surface of the same product and had only one way in
 * — the wordmark in the opposite corner, which is an affordance you have to already know about. Naming
 * it here makes the three places one row: two of them are ways of listening and swap in place, the third
 * is a different kind of place and is a real navigation.
 *
 * That is also why they are different elements. `admin` is an `<a href>` so the browser performs a real
 * navigation and `@view-transition` can animate the mark across it (see `shell.css`); the face is a
 * button because nothing is being navigated to — the same document simply starts drawing itself the
 * other way.
 *
 * Bare labels rather than boxes, because it is the construction that survives on both surfaces: the
 * technical player is made of edges and can carry one more, the art player boxes nothing. A control that
 * has to sit on both can only be the quieter of the two.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronGlyph } from '@/art/glyphs';
import type { Face } from '@/shell/useFace';

/** What each face points at, and what it says when it does. */
const OTHER: Record<Face, { face: Face; label: string; title: string }> = {
  art: {
    face: 'technical',
    label: 'technical',
    title: 'Same rooms, with the signal path and the spectrum',
  },
  technical: {
    face: 'art',
    label: 'art',
    title: 'Same rooms, artwork first',
  },
};

export function FaceSwitch({ face, onSwitch }: { face: Face; onSwitch: (face: Face) => void }) {
  const target = OTHER[face];

  /*
   * The word crossfades; the button does not.
   *
   * Swapping the text outright would make the one element that is supposed to be continuous flicker at
   * exactly the moment it is being looked at. `swapping` runs for one animation's length after the label
   * changes and drives a fade-out/in on the word alone — the arrow, the hit area and the focus ring stay
   * put throughout.
   */
  const [swapping, setSwapping] = useState(false);
  const previous = useRef(target.label);

  useEffect(() => {
    if (previous.current === target.label) {
      return undefined;
    }
    previous.current = target.label;
    setSwapping(true);
    const timer = window.setTimeout(() => setSwapping(false), 420);
    return () => window.clearTimeout(timer);
  }, [target.label]);

  return (
    <div
      className="face-switch mono"
      /*
       * Which face is *showing*, not which one it points at.
       *
       * The narrow rule in `shell.css` has to tell the two apart: the art player drops its whole bar on a
       * phone and this would be floating on somebody's album cover, while the technical player keeps its
       * bar at every width and would otherwise have no way out of itself at all.
       */
      data-face={face}
    >
      <a className="face-switch-go" href="/admin/" title="Set the house up">
        admin
      </a>

      <span className="face-switch-sep" aria-hidden="true" />

      <button type="button" className="face-switch-go" onClick={() => onSwitch(target.face)} title={target.title}>
        <span className="face-switch-label" data-swapping={swapping || undefined} key={target.label}>
          {target.label}
        </span>
        <ChevronGlyph size={13} className="face-switch-arrow" />
      </button>
    </div>
  );
}
