/**
 * Whether this browser can put the player on its home screen, and how.
 *
 * Two platforms, two mechanics, one hook:
 *
 *  - **Chromium** fires `beforeinstallprompt` when the app qualifies (manifest, icons, a service
 *    worker with a fetch handler). The event is captured and held; calling `prompt()` later shows
 *    the browser's own sheet. It fires *once* per page load, so it has to be caught at module
 *    level — a listener registered inside a component that mounts a second later has already
 *    missed it.
 *  - **iOS Safari** has no such API and never will; installing is a manual trip through the share
 *    sheet. So there the honest answer is not a button but a sentence saying which two taps.
 *
 * And one state that is neither: already installed, where the whole question is moot. That is what
 * `display-mode: standalone` reports, plus Safari's own `navigator.standalone` for the versions
 * that predate it.
 */
import { useEffect, useState } from 'react';

/** The slice of `BeforeInstallPromptEvent` actually used; the type is not in lib.dom. */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/*
 * Caught at module level, before React has mounted anything.
 *
 * Chromium fires this once, early, and does not re-fire it for a listener that arrives later. The
 * captured event stays valid until it is used or the page goes away.
 */
let captured: InstallPrompt | null = null;
const waiting = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar; the app asks in its own words, in its own place.
    event.preventDefault();
    captured = event as InstallPrompt;
    waiting.forEach((notify) => notify());
  });
  window.addEventListener('appinstalled', () => {
    captured = null;
    waiting.forEach((notify) => notify());
  });
}

const DISMISSED_KEY = 'sonn.player.install.dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private-mode Safari throws; an un-rememberable dismissal is better than no dismissal.
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // Safari's own flag, which predates the media query and is still what iOS reports.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export type Install = {
  /** Show the hint at all: installable here, not already installed, not waved away. */
  offer: boolean;
  /** No API on this platform — the hint explains the share sheet instead of offering a button. */
  manual: boolean;
  /** Ask the browser to install. Never call when `manual`. */
  install: () => void;
  /** Not now, and not again. */
  dismiss: () => void;
};

export function useInstall(): Install {
  const [ready, setReady] = useState(() => captured !== null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const notify = (): void => {
      setReady(captured !== null);
      setInstalled(isStandalone());
    };
    waiting.add(notify);
    return () => {
      waiting.delete(notify);
    };
  }, []);

  const manual = isIos() && !ready;

  return {
    offer: !installed && !dismissed && (ready || manual),
    manual,
    install: () => {
      const event = captured;
      if (!event) {
        return;
      }
      void event.prompt().then(() => {
        // Used or refused, the event is spent either way — Chromium will fire a fresh one on a
        // later visit if the app still qualifies.
        captured = null;
        waiting.forEach((tell) => tell());
      });
    },
    dismiss: () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(DISMISSED_KEY, '1');
      } catch {
        // Not persisting only costs the next visit one more hint.
      }
    },
  };
}
