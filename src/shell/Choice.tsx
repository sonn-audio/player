/**
 * The ask: which player is this browser going to be?
 *
 * Shown once, ever — see `useFace` for when (a browser with no remembered face and a url that
 * names none) and for the history: an earlier version of this screen was removed as a toll booth,
 * and this one is shaped by that removal. It does not describe features, show live state, or ask
 * for a decision that matters, because the footer's sentence is true: the other player stays one
 * press away, always. What it does is make the second layer *exist* — the one thing the corner
 * switch, at 10px in a corner nobody has looked at yet, cannot guarantee.
 *
 * The two halves say the two stances in the README's own words — `what the music is`, `what the
 * audio is` — because that distinction is the whole product and it fits in four words per side.
 * Anything longer is the old screen's mistake again: one player described twice.
 *
 * It sits *under* the splash (`z-index`), so the intro's black layer dissolves into it rather than
 * handing off through a flash of player. Picking calls `go`, which stores the answer exactly as a
 * corner press would — this screen has no state of its own to remember. The leave is a fade
 * (`data-leaving`), timed by `Root`, over the face that has been mounted and live underneath all
 * along; the music never waited on the question.
 */
import type { Face } from '@/shell/useFace';

export function Choice({ leaving, onPick }: { leaving: boolean; onPick: (face: Face) => void }) {
  return (
    <div className="choice" data-leaving={leaving || undefined} role="dialog" aria-label="Choose a player">
      <p className="choice-kicker mono">one house · two players</p>

      <div className="choice-split">
        <button type="button" className="choice-half" onClick={() => onPick('art')}>
          <span className="choice-lbl mono">art player</span>
          <span className="choice-name disp">the music</span>
          <span className="choice-sub mono">artwork large · controls quiet</span>
        </button>

        <span className="choice-rule" aria-hidden="true" />

        <button type="button" className="choice-half" onClick={() => onPick('technical')}>
          <span className="choice-lbl mono">technical player</span>
          <span className="choice-name disp">the audio</span>
          <span className="choice-sub mono">signal path · formats · spectrum</span>
        </button>
      </div>

      {/* The sentence that makes the choice weightless. Without it this is a decision; with it,
          a door held open. */}
      <p className="choice-foot mono">switch any time, top right — the choice is one press deep</p>
    </div>
  );
}
