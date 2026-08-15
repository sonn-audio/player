/**
 * The shell around both players: the splash, the choice, and the way between them.
 *
 * One component owns three things that are easy to get wrong separately:
 *
 *  - **The splash is the connecting phase**, not a timer. It leaves when the event stream has
 *    answered *and* it has been on screen long enough not to flash — whichever is later. A local
 *    server answers in 40 ms, and a mark that appears and vanishes inside one frame reads as a
 *    glitch rather than as a boot.
 *  - **The transition between faces is feedback**, so it only plays when someone pressed the switch.
 *    Arriving at `#/art` by reload should look like the art player was always there; arriving by pressing
 *    `ART MODE` in the other face should carry the sleeve across (see `shell/coverMorph`).
 *  - **Both faces mount under one `ServerProvider`** (in `main.tsx`), so switching face does not
 *    reopen the stream, refetch the zones, or lose the selected room. That is the whole reason these
 *    are two views rather than two apps.
 */
import { useEffect, useRef, useState } from 'react';
import { App } from '@/App';
import { ArtApp } from '@/art/ArtApp';
import { Brand } from '@/shell/Brand';
import { Choice } from '@/shell/Choice';
import { FaceSwitch } from '@/shell/FaceSwitch';
import { Intro } from '@/shell/Intro';
import { useFace, type Face } from '@/shell/useFace';
import { useServer } from '@/state/ServerContext';

/** How long the splash stays even when the server answers instantly. */
const INTRO_MIN_MS = 1600;

/**
 * How long it stays when the server does not answer at all.
 *
 * `EventStream` retries forever and reports `connecting` between attempts — it never reports a
 * final failure, which is right for a house appliance and fatal for a splash that waits for one.
 * Without this cap an unreachable server means a mark breathing on black indefinitely, which is the
 * exact "is it broken or is it working" ambiguity the splash exists to remove. The shell behind it
 * says *reconnecting* in the rail, which is a far better answer than a splash can give.
 */
const INTRO_MAX_MS = 4200;

/** How long the contents fade before the black layer itself starts to go. */
const INTRO_FADE_MS = 520;

/** How long the black layer takes to clear once it starts. */
const INTRO_OUT_MS = 640;

/** How long the ask takes to fade once answered — same curve family as the intro's exit. */
const CHOICE_OUT_MS = 700;

export function Root() {
  const { face, go, chose, morphing, undecided } = useFace();
  const { status } = useServer();

  const [intro, setIntro] = useState<'holding' | 'fading' | 'out' | 'gone'>('holding');
  const [minElapsed, setMinElapsed] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  /*
   * The ask's lifecycle, owned here because only the shell knows the layering: the choice sits
   * *under* the splash, so the intro's black dissolves into the question rather than into a face
   * — and once answered it fades over the face that was mounted underneath all along. `undecided`
   * is read once by `useFace`; from `asking` onwards this state is the authority.
   */
  const [ask, setAsk] = useState<'asking' | 'leaving' | 'gone'>(undecided ? 'asking' : 'gone');

  useEffect(() => {
    if (ask !== 'leaving') {
      return;
    }
    const timer = setTimeout(() => setAsk('gone'), CHOICE_OUT_MS);
    return () => clearTimeout(timer);
  }, [ask]);

  const pick = (next: Face): void => {
    go(next);
    setAsk('leaving');
  };

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), INTRO_MIN_MS);
    const max = setTimeout(() => setGaveUp(true), INTRO_MAX_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, []);

  /*
   * Resolved means "we know how this went, or we have waited long enough to stop pretending".
   * The stream is up, or the cap expired — see `INTRO_MAX_MS`.
   */
  const resolved = (status === 'open' && minElapsed) || gaveUp;
  const leaving = useRef(false);

  useEffect(() => {
    if (leaving.current || !resolved) {
      return;
    }
    leaving.current = true;
    setIntro('fading');
    const toOut = setTimeout(() => setIntro('out'), INTRO_FADE_MS);
    const toGone = setTimeout(() => setIntro('gone'), INTRO_FADE_MS + INTRO_OUT_MS);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toGone);
    };
  }, [resolved]);

  return (
    <>
      {/*
        Keyed on the face so React remounts on a switch, which is what lets the CSS entrance
        animation run again rather than only on the first mount. Cheap: the expensive state (zones,
        stream, selection) lives above this in the provider and is untouched by the remount.
      */}
      <div
        className="face"
        key={face}
        data-face={face}
        data-entered={chose || undefined}
        /* A switch that carries the sleeve across gets a fade and no scale: the flight is the
           transition, and `getBoundingClientRect` on a face mid-scale measures the wrong destination
           for it (see `coverMorph.flyTo`). */
        data-morph={morphing || undefined}
      >
        {face === 'technical' && <App />}
        {face === 'art' && <ArtApp />}
      </div>

      {/*
        Drawn once, over both faces, so a switch cannot move it or fade it. Outside the keyed `.face`
        deliberately — that is the whole point (see `Brand`). Phone-hidden in CSS, because the art face
        gives the artwork all four edges at that width.
      */}
      <Brand vt={intro === 'gone'} />
      <FaceSwitch face={face} onSwitch={go} />

      {/* Under the splash, over the frame: the intro dissolves into the question, the question
          fades into the face. Mounted only for a browser that has never answered it. */}
      {ask !== 'gone' && <Choice leaving={ask === 'leaving'} onPick={pick} />}

      {intro !== 'gone' && <Intro fading={intro !== 'holding'} out={intro === 'out'} vt />}
    </>
  );
}
