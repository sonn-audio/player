/**
 * One drop of the record's colour, in the accent — and nowhere else.
 *
 * The design says it in four words: *gedempt: één druppel, geen schreeuw*. The sleeve's own colour is
 * allowed to tint the small set of things that mean something — the play ring, the timeline, the live
 * mark, the glow under the artwork — and it is **damped 40% toward a neutral silver** on the way in, so
 * a red album and a blue one are the same room with a different light rather than two colour schemes.
 *
 * This replaced a bolder reading (the palette as a full-window wash, the product green kept as the
 * accent) that was wrong on both counts: the wash was a colour cast at any strength you could see, and
 * the art face is the one surface that should *not* carry the console's green. It has no state to report
 * and no verdict to give; it has a record playing. Silver is what a control surface is when it is not
 * saying anything.
 *
 * Four variables come out, matching the design's own names:
 *
 *  - `--g`   the accent itself
 *  - `--gb`  a brighter cut for text on dark, 42% toward white
 *  - `--gon` ink for text *on* the accent, always near-black
 *  - `--cx-stage` the record's own dark, for the one surface allowed more than a drop: the
 *    phone player. See `stageOf` below for the whole argument.
 */
import type { ApiTrack } from '@/api/types';

/** The neutral the accent falls back to, and the colour every album tint is damped toward. */
const SILVER = '#c9cdd4';

/** How far an album's colour is pulled toward the neutral. 0 = the raw sleeve colour, 1 = silver. */
const DAMP = 0.4;

/**
 * Below this perceived lightness an accent is lifted toward white.
 *
 * The accent has to work as a hairline and as small text on near-black, so a dark navy sleeve cannot be
 * allowed to hand it a colour nobody can see. The lift is proportional (`0.42 - lum * 0.5`), so a colour
 * that is nearly at the threshold barely moves and one that is nearly black moves a lot.
 */
const MIN_LUM = 0.5;

export type Accent = { '--g': string; '--gb': string; '--gon': string; '--cx-stage': string };

/** The page's own near-black (`--cx-bg`), the pole every stage colour is pulled toward. */
const STAGE_BASE: Rgb = [10, 10, 12];

/** How far the record's dark is pulled toward the page's. 0 = the raw sleeve dark, 1 = the page. */
const STAGE_DAMP = 0.42;

/** Above this luminance a "dark" background is not one, and gets pulled down until it is. */
const STAGE_MAX_LUM = 0.16;

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`;

/** Rec.601 luma, 0–1 — the same weighting the design's own prototype uses. */
const luminance = (rgb: Rgb): number => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;

/** Toward white by `amount`. */
const lighten = (rgb: Rgb, amount: number): Rgb => [
  rgb[0] + (255 - rgb[0]) * amount,
  rgb[1] + (255 - rgb[1]) * amount,
  rgb[2] + (255 - rgb[2]) * amount,
];

/** Between two colours, `t` of the way from `from` to `to`. */
const blend = (from: Rgb, to: Rgb, t: number): Rgb => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
];

/**
 * The accent for whatever is playing, as inline custom properties for `.cx-root`.
 *
 * `colors.primary` is the sleeve's most salient colour — not its most common one — which is exactly what
 * an accent wants and exactly what a wash does not: for a dark photograph with a small yellow label the
 * server correctly reports the yellow, and as a drop on a play ring that reads as the record while as a
 * full-window wash it read as olive.
 *
 * A room with nothing playing gets the plain silver, so the surface has no opinion until it has music.
 */
/**
 * The stage colour: the record's own dark, tamed until it can be the room.
 *
 * This is the one deliberate exception to "one drop, no wash". The *phone* player is a different
 * situation from every other surface: it is the whole screen, held in a hand, showing one record —
 * a pocket edition of the sleeve, not a control surface among rooms. There the contract's
 * `colors.backgroundDark` (derived server-side from the artwork, sitting unused since the wash was
 * retired) finally does the job it was made for: the page under the canvas takes the record's own
 * temperature, the way the record industry has printed inner sleeves forever.
 *
 * Tamed twice, both toward the page's own near-black: `STAGE_DAMP` so a red album and a blue one
 * are one product in two lights rather than two products, and a luminance ceiling so a sleeve
 * whose "dark" is not (a white-bordered pressing) cannot bleach the text standing on it. No track,
 * or no palette, is exactly the page colour — the surface has no opinion until it has music.
 */
function stageOf(track: ApiTrack | null | undefined): Rgb {
  const dark = track?.colors?.backgroundDark;
  if (!dark) {
    return STAGE_BASE;
  }
  let stage = blend([dark[0], dark[1], dark[2]], STAGE_BASE, STAGE_DAMP);
  const lum = luminance(stage);
  if (lum > STAGE_MAX_LUM) {
    // Pull the overshoot back toward the page, proportionally — a near-miss barely moves.
    stage = blend(stage, STAGE_BASE, Math.min(1, (lum - STAGE_MAX_LUM) / lum + 0.35));
  }
  return stage;
}

export function accentOf(track: ApiTrack | null | undefined): Accent {
  const silver = parse(SILVER);
  let accent = silver;

  const primary = track?.colors?.primary;
  if (primary) {
    accent = blend([primary[0], primary[1], primary[2]], silver, DAMP);
  }

  const lum = luminance(accent);
  if (lum < MIN_LUM) {
    accent = lighten(accent, MIN_LUM - 0.08 - lum * 0.5);
  }

  return {
    '--g': toHex(accent),
    '--gb': toHex(lighten(accent, 0.42)),
    '--gon': '#0a0a0b',
    '--cx-stage': toHex(stageOf(track)),
  };
}

/**
 * A stable identity for "the artwork changed", for the wash's cross-dissolve.
 *
 * Neither the palette nor the cover address is a reliable trigger on its own: two tracks off one album
 * share a palette, and the per-zone cover url deliberately does not change when the picture does. The
 * album's own artwork url does, and pairing it with the title covers a single sleeve with a queue behind
 * it — a dissolve per track on one album is right, because the dissolve is what says "something
 * happened".
 */
export function artKeyOf(track: ApiTrack | null | undefined): string {
  return track ? `${track.coverUrl}|${track.title}` : 'none';
}
