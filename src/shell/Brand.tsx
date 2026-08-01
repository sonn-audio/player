/**
 * The wordmark, which belongs to neither player.
 *
 * It used to be drawn twice — once in the technical player's app bar, once in the art player's top bar —
 * and the two were 18px apart horizontally and 6px vertically, because each bar had picked its own height
 * and its own left inset. Switching face made the logo hop. Worse, it also *dipped*: the incoming face
 * fades in from zero (`.face[data-entered]`), and a child cannot opt out of its ancestor's opacity, so the
 * one element on screen that is the same in both faces was the one blinking.
 *
 * Both problems have the same cause and the same answer: the brand is not part of a view. It is the frame
 * the views hang in, so it is drawn once, here, above both of them — and then it does not move, does not
 * fade, and does not have to be kept in step in two stylesheets. During a switch it is simply the thing
 * that stays still while everything around it changes, which is the most a transition can ask of a logo.
 *
 * Desktop only. On a phone the art face hides its header entirely to give the artwork all four edges, so
 * a brand pinned to the top-left would be floating on someone's album cover; both faces keep their own
 * in-bar copy at that width (see `.brand-shared` in `shell.css`, and the `phone` prop below).
 */
import { Mark } from '@/components/Mark';

export function Brand({
  /**
   * True for a copy drawn inside a face's own bar.
   *
   * The bars still need something to reserve the space, or the art player's nav would slide left into the
   * gap the shared copy is floating over. A hidden twin costs one 11-rect SVG and no measurement, which is
   * the alternative to hard-coding the lockup's width in two places and breaking it the day the wordmark
   * changes.
   */
  placeholder = false,
  vt = false,
}: {
  placeholder?: boolean;
  /**
   * Whether this copy carries the cross-document `view-transition-name`.
   *
   * False while the splash is still up, because the splash is drawing its own mark and two elements holding
   * one name makes the browser skip the transition entirely. See `Root`.
   */
  vt?: boolean;
}) {
  const lockup = (
    <span className="brand">
      <Mark className="brand-mark" />
      sonn <span className="brand-light">player</span>
    </span>
  );

  if (placeholder) {
    return (
      <span className="brand-slot" aria-hidden="true">
        {lockup}
      </span>
    );
  }

  /*
   * The wrapper is not decoration.
   *
   * `.brand` aligns the mark to the wordmark's *baseline*, which is what stops a 30px glyph from floating
   * beside a 19px word. In a bar that works because the bar centres the whole lockup and the lockup handles
   * its own insides. Pinned to the viewport there is no bar to do the centring, so the wrapper is the bar:
   * a fixed 54px box that centres one baseline-aligned lockup, exactly as before. Without it the mark sits
   * 11px too high — the box's baseline lands at the top of a fixed-height flex container.
   */
  /*
   * The wordmark is the way to the console.
   *
   * A logo that goes to the root is the oldest affordance there is, and it is the only one available here
   * that costs no chrome: the top-right already belongs to the other player, and the console is a third
   * kind of place rather than a third way of listening. It is a real `<a href>` so the browser performs a
   * real navigation — which is what lets `@view-transition` animate across it (see `shell.css`).
   */
  return (
    <a className="brand-shared" href="/admin/" title="Set the house up" data-vt={vt || undefined}>
      {lockup}
    </a>
  );
}
