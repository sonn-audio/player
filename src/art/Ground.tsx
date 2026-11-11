/**
 * The ground: the room, lit by the record.
 *
 * One layer under everything — the sidebar, the pane, the bar all stand on it — and it is the light
 * the sleeve throws: its own colours (`palette.ts`) as soft fields that drift past each other, slowly,
 * the way light in a room does. The frame is glass over it. There is no separate wash behind the
 * stage and no separate screensaver any more: the stage is the ground seen through the pane, and the
 * rest is the ground with the frame stepped away.
 *
 * Drawn on a 64-pixel canvas and blurred up by the stylesheet, so it costs a few hundred pixels a
 * frame at any window size. A change of record is not a cut: every field's colour and place glide to
 * the new one. While the room is at rest and playing, the fields swell on the room's own audio
 * (`useAnalysis`); under reduced motion they hold still.
 */
import { useEffect, useRef } from 'react';
import { toHeight, useAnalysis } from '@/state/useAnalysis';
import type { Palette } from '@/art/palette';

const W = 64;
const H = 40;

/** Nothing has ever played here: a quiet graphite with the house's green far underneath. */
const NEUTRAL: Palette = {
  colors: ['hsl(200 14% 22%)', 'hsl(160 16% 17%)', 'hsl(225 12% 25%)', 'hsl(210 14% 11%)'],
  accent: 'hsl(210 8% 82%)',
  deep: 'hsl(210 12% 4.5%)',
  ink: 'hsl(210 10% 97%)',
};

type Rgb = [number, number, number];

/** Any CSS colour as numbers, by asking a canvas — the palette is written as `hsl()`. */
function rgbOf(context: CanvasRenderingContext2D, colour: string): Rgb {
  context.fillStyle = '#000';
  context.fillStyle = colour;
  const hex = context.fillStyle as string;
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

/* Where each field lives and how it wanders: a centre, a reach, two slow frequencies. */
const FIELDS = [
  { x: 0.2, y: 0.3, r: 0.62, fx: 0.011, fy: 0.017, c: 0, band: 0 },
  { x: 0.78, y: 0.22, r: 0.5, fx: 0.015, fy: 0.009, c: 1, band: 1 },
  { x: 0.55, y: 0.78, r: 0.58, fx: 0.008, fy: 0.013, c: 2, band: 2 },
  { x: 0.1, y: 0.85, r: 0.5, fx: 0.013, fy: 0.01, c: 3, band: 0 },
  { x: 0.92, y: 0.7, r: 0.46, fx: 0.009, fy: 0.016, c: 0, band: 1 },
  { x: 0.5, y: 0.42, r: 0.44, fx: 0.007, fy: 0.012, c: 1, band: 2 },
] as const;

export function Ground({
  palette,
  zoneId,
  listening,
}: {
  palette: Palette | null;
  /** The room whose audio moves the light, when `listening`. */
  zoneId: number | null;
  /** At rest and playing: the fields follow the sound. */
  listening: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef<Palette>(palette ?? NEUTRAL);
  target.current = palette ?? NEUTRAL;
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const analysis = useAnalysis(zoneId ?? 0, listening && zoneId !== null && !still, 20);
  const bins = useRef<number[]>([]);
  bins.current = analysis.bins;

  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) {
      return undefined;
    }
    let frame = 0;
    let last = 0;
    let shown: Rgb[] | null = null;
    let deep: Rgb | null = null;
    const bands = [0, 0, 0];

    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw);
      /* Thirty frames a second is more than light needs. */
      if (now - last < 33) {
        return;
      }
      last = now;
      const want = target.current.colors.map((colour) => rgbOf(context, colour));
      const wantDeep = rgbOf(context, target.current.deep);
      if (!shown || !deep) {
        shown = want;
        deep = wantDeep;
      } else {
        /* The glide: a twentieth of the way each frame, so a new record takes about two seconds. */
        for (let i = 0; i < shown.length; i += 1) {
          for (let k = 0; k < 3; k += 1) {
            shown[i]![k] = shown[i]![k]! + (want[i]![k]! - shown[i]![k]!) * 0.05;
          }
        }
        for (let k = 0; k < 3; k += 1) {
          deep[k] = deep[k]! + (wantDeep[k]! - deep[k]!) * 0.05;
        }
      }

      const heard = bins.current;
      const third = Math.max(1, Math.floor(heard.length / 3));
      for (let b = 0; b < 3; b += 1) {
        const slice = heard.slice(b * third, b === 2 ? heard.length : (b + 1) * third);
        const level = slice.length ? slice.reduce((sum, sample) => sum + toHeight(sample), 0) / slice.length : 0;
        bands[b] = bands[b]! + (level - bands[b]!) * 0.14;
      }

      context.globalCompositeOperation = 'source-over';
      context.fillStyle = `rgb(${deep[0]} ${deep[1]} ${deep[2]})`;
      context.fillRect(0, 0, W, H);
      const t = still ? 0 : now / 1000;
      for (const field of FIELDS) {
        const colour = shown[field.c]!;
        const swell = 1 + bands[field.band]! * 0.55;
        const x = (field.x + Math.sin(t * field.fx * 6.283) * 0.12) * W;
        const y = (field.y + Math.cos(t * field.fy * 6.283) * 0.14) * H;
        const r = field.r * W * 0.62 * swell;
        const gradient = context.createRadialGradient(x, y, 0, x, y, r);
        const alpha = Math.min(1, 0.82 + bands[field.band]! * 0.3);
        gradient.addColorStop(0, `rgb(${colour[0]} ${colour[1]} ${colour[2]} / ${alpha})`);
        gradient.addColorStop(1, `rgb(${colour[0]} ${colour[1]} ${colour[2]} / 0)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, W, H);
      }
      if (still) {
        cancelAnimationFrame(frame);
        /* Held still, but a new record still has to arrive: one more frame when the target changes. */
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    /* Re-run on a palette change only under reduced motion, where the loop has stopped. */
  }, [still, still ? palette : null]);

  return (
    <div className="cx-ground" aria-hidden="true">
      <canvas ref={canvas} width={W} height={H} className="cx-ground-canvas" />
      <span className="cx-ground-scrim" />
      <span className="cx-ground-grain" />
    </div>
  );
}
