/**
 * The shell around the player: the splash, and what is drawn over the app.
 *
 * Two things that are easy to get wrong separately:
 *
 *  - **The splash is the connecting phase**, not a timer. It leaves when the event stream has
 *    answered *and* it has been on screen long enough not to flash — whichever is later. A local
 *    server answers in 40 ms, and a mark that appears and vanishes inside one frame reads as a
 *    glitch rather than as a boot.
 *  - **The frame is drawn over the app**, not inside it: the wordmark and the way out to admin sit
 *    outside the player so nothing the player does can move them.
 *
 * There used to be two players here — a technical face and an art one — with a switch, a remembered
 * choice, a hash route and a cover that flew between them. One of them has absorbed the other: the
 * instruments are a *view* of the player now (`art/Signal`) rather than a second application, so the
 * machinery that kept two shells in step is gone. What it protected is not: the sleeve still flies,
 * between the stage and the deck, through the same `coverMorph`.
 */
import { useEffect, useRef, useState } from 'react';
import { ArtApp } from '@/art/ArtApp';
import { AdminLink } from '@/shell/AdminLink';
import { Brand } from '@/shell/Brand';
import { Intro } from '@/shell/Intro';
import { ServerMismatch } from '@/shell/ServerMismatch';
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

export function Root() {
  const { status } = useServer();

  /*
   * An old bookmark does not get to leave a lie in the address bar.
   *
   * `#/technical` and `#/art` addressed the two faces. There is one player now, so the hash routes
   * nothing — and a url that names a face the app no longer has is the kind of small untruth that
   * later reads as a bug. Cleared once, on arrival, without adding a history entry.
   */
  useEffect(() => {
    if (/^#\/?(technical|art)$/i.test(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const [intro, setIntro] = useState<'holding' | 'fading' | 'out' | 'gone'>('holding');
  const [minElapsed, setMinElapsed] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

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
      {/* One player, so no key and no entrance to replay: the splash's own dissolve is the arrival. */}
      <div className="face">
        <ArtApp />
      </div>

      {/*
        Drawn over the app so nothing inside it can move them. Outside on purpose — that is the whole
        point (see `Brand`). Phone-hidden in CSS, because the player gives the artwork all four edges
        at that width.
      */}
      <Brand vt={intro === 'gone'} />
      <AdminLink />
      <ServerMismatch />

      {intro !== 'gone' && <Intro fading={intro !== 'holding'} out={intro === 'out'} vt />}
    </>
  );
}
