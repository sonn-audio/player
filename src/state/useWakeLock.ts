/**
 * Keeping the screen awake while it is being a record sleeve.
 *
 * The art face's idle state exists for a panel on a wall — left alone for a minute, the chrome
 * dims away and the screen becomes the artwork. The operating system does not know that: to it
 * the page has simply had no input for a while, which is exactly what a screensaver is for. A
 * wall panel that blanks itself two minutes into every record defeats the state designed for it.
 *
 * `navigator.wakeLock` is the polite version of the fix: a *request*, which the platform is free
 * to refuse (battery saver, a backgrounded tab) and to revoke at any time. Both are fine here —
 * the cost of not holding the lock is a dimmed screen, not broken audio — so refusals are
 * swallowed rather than surfaced, and there is no retry loop. The one revocation worth acting on
 * is the automatic one: the platform releases the lock whenever the page loses visibility, and
 * does **not** re-grant it on return, so becoming visible again is the one moment to re-ask.
 *
 * Held only while `active` — the caller says when the screen is worth keeping (music playing, in
 * practice), because a wake lock on a quiet house is a lit screen showing nothing all night.
 */
import { useEffect } from 'react';

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) {
      return;
    }

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        const granted = await navigator.wakeLock.request('screen');
        // The effect may have been torn down while the request was in flight; a lock nobody
        // is tracking would hold the screen on with no way to release it until unload.
        if (cancelled) {
          void granted.release();
          return;
        }
        lock = granted;
      } catch {
        // Refused — battery saver, a hidden tab, a browser without the permission. The screen
        // dims as it always did; nothing else depends on the lock.
      }
    };

    void acquire();

    // Visibility loss releases the lock platform-side; visibility return is when to re-ask.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && lock?.released !== false) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
