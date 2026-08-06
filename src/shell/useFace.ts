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
  const [face, setFace] = useState<Face>(
    () => parse(window.location.hash) ?? readStored() ?? DEFAULT_FACE,
  );
  const [chose, setChose] = useState(false);
  /*
   * Whether this browser has ever answered the "which player" question — by pressing the switch,
   * by following a deep link, or on the ask itself. Read once, on mount: it decides whether the
   * splash resolves into the ask or into a face, and that decision must not change under a screen
   * already animating. `Root` owns the ask's lifecycle from here.
   */
  const [undecided] = useState<boolean>(
    () => parse(window.location.hash) === null && readStored() === null && storageWorks(),
  );
  /* Whether the switch we are in the middle of is carrying a sleeve across — see `coverMorph`. */
  const [morphing, setMorphing] = useState(false);

  /*
   * A url that named no face gets the one we resolved written into it.
   *
   * `/player/` and `/player/#/` both open a player now, and leaving the hash empty behind them means a
   * reload is a second guess at the same question and the back button has nothing to go back to. One
   * `replaceState` and the address bar says what is on screen.
   */
  useEffect(() => {
    if (parse(window.location.hash) === null) {
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
