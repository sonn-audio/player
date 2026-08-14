/**
 * Whether an element has ever been on screen.
 *
 * "Ever", not "is": once something has been seen it stays seen, so a shelf that scrolls back out
 * of view does not throw away what it fetched and fetch it again on the way back. That makes this
 * a one-way latch rather than a visibility flag, which is the only shape a *loading* trigger can
 * safely have.
 *
 * The margin is generous on purpose. A shelf that starts loading when its first pixel appears is
 * a shelf you watch load; starting a screen early means the artwork is usually already there by
 * the time you scroll to it.
 */
import { useEffect, useRef, useState } from 'react';

export function useInView<T extends HTMLElement>(margin = '600px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) {
      return;
    }
    const element = ref.current;
    if (!element) {
      return;
    }
    // No observer (very old browser, or a test environment) means everything loads at once —
    // slower, never broken.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, margin]);

  return [ref, seen];
}
