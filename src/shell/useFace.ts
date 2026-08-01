/**
 * Which face of the player is on screen, and how you get to the other one.
 *
 * There are two, over one API: a **technical** one (signal path, formats, spectrum) and an **art** one
 * (artwork, calm, phone-first). They are two views of one bundle rather than two apps, because
 * everything below the presentation is shared — the API client, the event stream, the zone store, the
 * selected room.
 *
 * **There is no longer a screen that asks which one you want.** There was: a landing page with two
 * cards, framed as a choice between products. But the cards described one player twice, the state they
 * showed to make the choice concrete (`2 of 4 rooms playing`) was the thing you were being kept from,
 * and a first-run gate in front of a music player is a toll booth. The switch in each face's top-right
 * corner tells the whole story more honestly: whichever face you are in, the other one is one press
 * away, and nothing had to be decided before the music could start.
 *
 * So a bare url opens the face you were last in, and the art one the first time — it is the face for a
 * phone, a wall panel and the rest of the time, and the technical one is the specialist view you go to
 * when you want to know what the audio is doing.
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
 * The face, the setter, and whether we arrived by switching.
 *
 * `chose` is what the transition needs: a face reached by pressing the switch should animate in, and the
 * same face reached by reloading the page should simply be there. Animating a reload is the tell that a
 * transition has become decoration.
 */
export function useFace(): { face: Face; go: (face: Face) => void; chose: boolean; morphing: boolean } {
  const [face, setFace] = useState<Face>(
    () => parse(window.location.hash) ?? readStored() ?? DEFAULT_FACE,
  );
  const [chose, setChose] = useState(false);
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

  return { face, go, chose, morphing };
}
