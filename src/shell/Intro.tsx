/**
 * The splash.
 *
 * Brought back from the older player, where it was the best thing about the first second: the mark
 * draws its roofline, the bars breathe like a level meter, and the wordmark and tagline rise in
 * behind it. It is not decoration — it *is* the connecting phase. The event stream takes a beat to
 * open (`server.ready` carries the whole zone snapshot), and a player that shows an empty shell for
 * that beat looks broken in a way that a mark holding on a black field does not.
 *
 * Controlled in two steps by whoever owns it, which is what keeps the hand-off invisible:
 *  - `fading` fades the *contents* out while the black layer stays, so nothing pops.
 *  - `out` then fades the black layer itself away, revealing the app already rendered beneath.
 *
 * A minimum on-screen time is the caller's business (see `Root`): without one a fast local server
 * makes the whole thing a flash, which is worse than no splash at all.
 */
export function Intro({ fading, out, vt = false }: { fading: boolean; out: boolean; vt?: boolean }) {
  return (
    <div className="intro" data-fading={fading || undefined} data-out={out || undefined} data-vt={vt || undefined}>
      {/*
        The animated copy of the mark, not `<Mark>`: every bar has to be addressable by
        `:nth-child` so each gets its own delay, and the roofline is stroked with a dash offset it
        animates away. The static mark has neither, and giving it both would put animation
        machinery into the one drawing that is used in six calm places.
      */}
      {/*
        A wrapper, only so the rings have something to hang on: pseudo-elements do not render on an
        `<svg>` element, and the two expanding circles are `::before`/`::after`. Borrowed from the admin
        interface's own splash, where the mark pulses twice as it lands — the two products share a
        wordmark and an accent, so they may as well share the gesture.
      */}
      <div className="intro-glyph">
        <svg className="intro-mark" viewBox="8 12 84 68" aria-hidden="true">
          <rect x="20" y="63.1" width="2.17" height="5.78" rx="1.08" />
          <rect x="25.78" y="59.5" width="2.17" height="13.01" rx="1.08" />
          <rect x="31.57" y="61.66" width="2.17" height="8.67" rx="1.08" />
          <rect x="37.35" y="58.05" width="2.17" height="15.9" rx="1.08" />
          <rect x="46.03" y="56.6" width="2.89" height="18.8" rx="1.45" />
          <rect x="54.69" y="58.05" width="2.17" height="15.9" rx="1.08" />
          <rect x="60.48" y="60.94" width="2.17" height="10.12" rx="1.08" />
          <rect x="66.26" y="58.77" width="2.17" height="14.46" rx="1.08" />
          <rect x="72.05" y="62.38" width="2.17" height="7.23" rx="1.08" />
          <rect x="77.83" y="63.83" width="2.17" height="4.34" rx="1.08" />
          <path className="intro-roof" d="M14 46 L50 18 L86 46" />
        </svg>
      </div>

      <div className="intro-word disp">
        sonn <span className="intro-word-light mono">player</span>
      </div>
      <div className="intro-tag mono">Every room, one system</div>
    </div>
  );
}
