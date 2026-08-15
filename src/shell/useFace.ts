/**
 * Which face of the player is on screen, and how you get to the other one.
 *
 * There are two, over one API: a **technical** one (signal path, formats, spectrum) and an **art** one
 * (artwork, calm, phone-first). They are two views of one bundle rather than two apps, because
 * everything below the presentation is shared — the API client, the event stream, the zone store, the
 * selected room.
 *
 * **The screen that asks which one you want is back — once, ever.** It was removed with cause: the
 * old landing page stood in front of every visit, its two cards described one player twice, and the
 * live state it showed (`2 of 4 rooms playing`) was the thing you were being kept from — a toll booth.
 * What replaced it, the corner switch alone, quietly created the opposite problem: a browser that has
 * never been here lands in the art face and nothing on screen *says there is a second one*, so half
 * the product hangs on whether someone ever reads a 10px word in a corner. The toll booth and the
 * unread corner are both discoverability answered badly.
 *
 * So the ask returns, shaped by the old screen's failures: it appears only when this browser has no
 * remembered face **and** the url names none (`undecided`) — one press, answered where the splash was
 * already holding the door, never seen again. A deep link is already an answer, so it skips the ask;
 * so does every visit after the first, because the choice is stored exactly like a corner switch
 * would have stored it. Nothing is described twice and no state is withheld: the two halves say the
 * two stances (`what the music is` / `what the audio is`) and the footer says the truth that makes
 * the choice weightless — the other face stays one press away, always.
 *
 * **And a phone does not have two faces at all.** The two faces are a *desk* question: a desk has
 * the width for a spectrum beside a signal path, and a person at one may genuinely be either kind of
 * listener. A phone is one product — the full-screen player, the record's own colours, the thumb's
 * gestures — and asking it to choose between that and a rack instrument squeezed into one column is
 * asking a question with a right answer, which is not a question.
 *
 * For a while the answer to that was softer: the ask was skipped but the technical face stayed
 * reachable on a phone, through a row in the player sheet and through `#/technical`. Building that
 * one-column technical layout properly is what showed it was the wrong softness. The face is four
 * instruments read side by side; a phone can hold one of them at a time, so the honest phone version
 * of it is a *different app* — a tab bar over four screens — which is not the same product wearing a
 * narrow coat, it is a second product to design, ship and keep true. The art player already *is* the
 * phone product, made for exactly this hand.
 *
 * So below the phone line there is one face and it is the art player. The deep link does not
 * override it — it is answered with the face the device has, and the address bar is corrected to say
 * so rather than left lying. The technical face is a desk instrument, stated plainly, which is a
 * better promise than one that technically works and is nobody's favourite screen.
 *
 * A bare url thereafter opens the face you were last in. (Where storage is unwritable — private-mode
 * Safari — the ask would return each visit for the same reason the face itself cannot be remembered;
 * `undecided` therefore also requires that storage *works*, and such browsers keep the old behaviour:
 * straight into the art face.)
 *
 * Addressed by hash (`#/technical`, `#/art`) rather than by path, for a reason that is about deployment
 * and not taste: the audioserver serves this bundle from a static directory with no SPA fallback, so
 * `/player/art` would be a 404 from the file handler. A hash is never sent to the server, which makes
 * both faces deep-linkable and reloadable with no server change at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { captureCover } from '@/shell/coverMorph';

export type Face = 'technical' | 'art';

/** Where someone who has never been here before lands. See the note above. */
const DEFAULT_FACE: Face = 'art';

const STORAGE_KEY = 'sonn.player.face';

/** The hash → a face, or null when it does not name one. */
function parse(hash: string): Face | null {
  const value = hash.replace(/^#\/?/, '').toLowerCase();
  return value === 'technical' || value === 'art' ? value : null;
}

function readStored(): Face | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'technical' || value === 'art' ? value : null;
  } catch {
    // Private-mode Safari throws; the default is a fine place to start.
    return null;
  }
}

/**
 * The shell's phone line — the art face's own 979px breakpoint.
 *
 * Read once at load rather than watched, and that is the point: dragging a desktop window narrow
 * must not swap the face out from under the person doing it. It answers "what kind of device is
 * this", which does not change while the page is open, and a resize is a window changing size.
 */
const PHONE = window.matchMedia?.('(max-width: 979px)').matches ?? false;

/** The one face a phone has. See the note above. */
function resolveFace(): Face {
  return PHONE ? 'art' : (parse(window.location.hash) ?? readStored() ?? DEFAULT_FACE);
}

/**
 * Whether an answer, once given, would actually be kept. Asking a browser that cannot remember
 * the answer means asking on every visit — the exact toll booth the ask is designed not to be —
 * so an unwritable storage keeps the old behaviour: no question, straight into the default face.
 */
function storageWorks(): boolean {
  try {
    const probe = 'sonn.player.probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * The face, the setter, and whether we arrived by switching.
 *
 * `chose` is what the transition needs: a face reached by pressing the switch should animate in, and the
 * same face reached by reloading the page should simply be there. Animating a reload is the tell that a
 * transition has become decoration.
 */
export function useFace(): {
  face: Face;
  go: (face: Face) => void;
  chose: boolean;
  morphing: boolean;
  undecided: boolean;
} {
  const [face, setFace] = useState<Face>(resolveFace);
  const [chose, setChose] = useState(false);
  /*
   * Whether this browser has ever answered the "which player" question — by pressing the switch,
   * by following a deep link, or on the ask itself. Read once, on mount: it decides whether the
   * splash resolves into the ask or into a face, and that decision must not change under a screen
   * already animating. `Root` owns the ask's lifecycle from here.
   */
  const [undecided] = useState<boolean>(
    () => !PHONE && parse(window.location.hash) === null && readStored() === null && storageWorks(),
  );
  /* Whether the switch we are in the middle of is carrying a sleeve across — see `coverMorph`. */
  const [morphing, setMorphing] = useState(false);

  /*
   * The address bar is made to say what is on screen.
   *
   * Two cases, one rule. A url that named no face (`/player/`, `/player/#/`) gets the one we
   * resolved written into it, because leaving the hash empty means a reload is a second guess at
   * the same question and the back button has nothing to go back to. And a phone that was handed
   * `#/technical` gets it corrected, because it is showing the art face and a url that disagrees
   * with the screen is the kind of small lie that later reads as a bug.
   */
  useEffect(() => {
    if (parse(window.location.hash) !== face) {
      window.history.replaceState(null, '', `#/${face}`);
    }
    // Once, on mount: afterwards `go` keeps the hash in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The back button is a real navigation between faces, so it has to move the app.
  useEffect(() => {
    const onHash = (): void => {
      const next = parse(window.location.hash);
      if (next === null) {
        return;
      }
      if (PHONE) {
        // One face here, so a link to the other one is answered rather than followed.
        if (next !== 'art') {
          window.history.replaceState(null, '', '#/art');
        }
        return;
      }
      setChose(false);
      setMorphing(false);
      setFace(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Face) => {
    /*
     * Measure the sleeve *before* React is told anything.
     *
     * This is the only moment the outgoing face is still on screen — the state update below unmounts it in
     * the same commit that mounts the new one, so a capture taken any later has nothing to measure.
     */
    setMorphing(captureCover());
    setChose(true);
    setFace(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting only costs the next bare load its shortcut.
    }
    const hash = `#/${next}`;
    if (window.location.hash !== hash) {
      // `pushState` rather than assigning `location.hash`: assigning fires `hashchange`, which would
      // immediately reset `chose` and swallow the transition we just asked for.
      window.history.pushState(null, '', hash);
    }
  }, []);

  return { face, go, chose, morphing, undecided };
}
