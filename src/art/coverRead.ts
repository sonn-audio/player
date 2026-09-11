/**
 * Reading a sleeve, so the record can decide its own composition.
 *
 * Two sleeves should not get one layout. A quiet sleeve — a dark field, a single figure, a colour with a
 * word on it — can carry the title *on* it, the way a magazine cover does, and the page beside it can
 * fall silent. A busy sleeve — a photograph, a collage, its own typography — wants the spread: the
 * picture whole on the left, the words on the right where they do not fight it.
 *
 * The reading is cheap and local: the sleeve drawn at 48×48 into a canvas, and the lower-left region
 * (where the title would stand) measured for edge density and luminance spread. Both low means there is
 * nothing there for type to collide with. Calibrated on the house's own records: Moonlight Drive,
 * Devotion, Coldplay's *Rush of Blood* read quiet; Mezzanine, Natural Blues and *The Nightly Disease* read
 * busy. The ink follows the region's brightness — white on a dark field, near-black on a pale one.
 *
 * The cover comes from the server's own proxy, so the canvas is not tainted; a read that fails for any
 * reason answers null and the stage keeps the spread, which is never wrong.
 */
import { useEffect, useState } from 'react';

export type CoverRead = {
  /** Whether the lower-left of the sleeve is calm enough to carry the title. */
  quiet: boolean;
  /** Which ink reads on that region. */
  ink: 'light' | 'dark';
};

const SAMPLE = 48;
/** Mean absolute neighbour difference below which a region has no detail worth protecting. */
const QUIET_EDGE = 0.085;
/** Luminance spread below which a region is one field rather than a picture. */
const QUIET_SPREAD = 0.2;

const reads = new Map<string, Promise<CoverRead | null>>();

function measure(img: HTMLImageElement): CoverRead | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }
  const lum = (x: number, y: number): number => {
    const i = (y * SAMPLE + x) * 4;
    return (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
  };
  const values: number[] = [];
  let edges = 0;
  let pairs = 0;
  for (let y = Math.floor(SAMPLE * 0.42); y < SAMPLE; y += 1) {
    for (let x = 0; x < SAMPLE * 0.62; x += 1) {
      const l = lum(x, y);
      values.push(l);
      if (x + 1 < SAMPLE && y + 1 < SAMPLE) {
        edges += Math.abs(l - lum(x + 1, y)) + Math.abs(l - lum(x, y + 1));
        pairs += 1;
      }
    }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const spread = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  const edge = pairs > 0 ? edges / pairs : 1;
  return { quiet: edge < QUIET_EDGE && spread < QUIET_SPREAD, ink: mean < 0.5 ? 'light' : 'dark' };
}

export function readCover(url: string): Promise<CoverRead | null> {
  let hit = reads.get(url);
  if (!hit) {
    hit = new Promise<CoverRead | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(measure(img));
      img.onerror = () => resolve(null);
      img.src = url;
    });
    reads.set(url, hit);
  }
  return hit;
}

/** The reading for a cover url, or null while it is being taken (and when it cannot be). */
export function useCoverRead(url: string | undefined): CoverRead | null {
  const [read, setRead] = useState<CoverRead | null>(null);
  useEffect(() => {
    let live = true;
    setRead(null);
    if (!url) {
      return undefined;
    }
    void readCover(url).then((result) => {
      if (live) {
        setRead(result);
      }
    });
    return () => {
      live = false;
    };
  }, [url]);
  return read;
}
