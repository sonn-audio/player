/**
 * Type that is sized to its box rather than to its character count.
 *
 * A record's name is whatever the label called it: `Steam` and
 * `A State of Trance, Ibiza 2026 (DJ Mix) [Mixed by Armin van Buuren]` land on the same page. Sizing
 * by length — the ladder this replaces — guesses, because `WWWW` and `iiii` are the same four
 * characters and nothing like the same width; and whatever it guesses, a title that wraps to three
 * lines pushes the timeline, the transport and the house down with it, so the page rearranges itself
 * every few minutes.
 *
 * So the title gets a box of its own, of a height that never changes, and the type is *measured* into
 * it: the largest size at which the name still fits, found by halving the interval seven times, which
 * is exact to a pixel and costs seven reflows of one element on a track change. Everything below the
 * box stands still, whatever is playing.
 *
 * Re-measured when the name changes, when the box changes size, and once more when the webfont has
 * loaded — the first measurement of a page that is still in the fallback face is a measurement of the
 * wrong letters.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How many times the interval is halved. Seven gets within a pixel of any size this face uses. */
const STEPS = 7;

export function useFitText(
  key: string,
  { max, min }: { max: number; min: number },
): { ref: (element: HTMLElement | null) => void; size: number | undefined } {
  const element = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const node = element.current;
    if (!node || node.clientHeight === 0) {
      return;
    }
    const fits = (px: number): boolean => {
      node.style.fontSize = `${px}px`;
      /* `scrollHeight` is the wrapped text's own height; `clientHeight` is the box it may fill. */
      return node.scrollHeight <= node.clientHeight;
    };
    let found = max;
    if (!fits(max)) {
      let low = min;
      let high = max;
      for (let step = 0; step < STEPS; step += 1) {
        const mid = (low + high) / 2;
        if (fits(mid)) {
          low = mid;
        } else {
          high = mid;
        }
      }
      found = Math.floor(low);
    }
    /*
     * The answer is written on the element as well as kept in state. Measuring walks the size up and
     * down the element's own `style`, so the element is left mid-search unless the last step puts the
     * answer back; and a second measurement that lands on the same number changes no state, so React
     * would never redraw the size the search just wiped. Belt and braces: the style attribute and the
     * state say the same thing after every pass.
     */
    node.style.fontSize = `${found}px`;
    setSize(found);
  }, [max, min]);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      element.current = node;
      if (node) {
        measure();
      }
    },
    [measure],
  );

  useEffect(() => {
    measure();
    const node = element.current;
    if (!node) {
      return undefined;
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    /* The fallback face measures differently; one more pass once the real one is in. */
    void document.fonts?.ready.then(() => measure()).catch(() => undefined);
    return () => observer.disconnect();
  }, [key, measure]);

  return { ref, size };
}
