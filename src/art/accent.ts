/**
 * The record owns the room.
 *
 * For a long time the rule here was *one drop*: the sleeve's colour was allowed to tint the play ring
 * and the timeline, damped 40% toward silver, and nothing else — a control surface with no opinion.
 * That made a player that was correct and interchangeable with five other correct players. The stance
 * is the opposite now: the frame is made of the record. The sleeve's dark becomes the frame and the
 * pane, its most salient colour becomes the one accent on the page, and the ink the server reads for
 * text on that dark becomes the text ladder. A red album and a blue one are two rooms, and that is the
 * point: every record makes the app its own.
 *
 * Damped still, but lightly, and capped, so a white-bordered pressing cannot bleach the type and a navy
 * one cannot hand the accent a colour nobody can see. Nothing playing is the neutral frame.
 *
 * What comes out, as custom properties on `.cx-root`:
 *
 *  - `--rec-deep`   the frame around the pane: the record's dark, most of the way to black
 *  - `--rec-bg`     the pane itself: the record's dark, tamed
 *  - `--rec-mid`    the record's colour as a ground, for glows
 *  - `--rec-accent` the one accent: play, the timeline, the active row
 *  - `--rec-ink`    the text ladder's top step, from the server's `onDark`
 *  - `--g`, `--gb`, `--gon` the accent's older names, kept for the surfaces that read them
 *  - `--cx-stage`   the phone player's ground; `--cx-a1`, `--cx-a2` the two colours of the wash
 */
import type { ApiTrack } from '@/api/types';

/** The neutral the accent falls back to, and the colour every album tint is damped toward. */
const SILVER = '#c9cdd4';

/** How far an album's colour is pulled toward the neutral. 0 = the raw sleeve colour, 1 = silver. */
const DAMP = 0.4;

/** The same, for the frame's own accent: lightly, so the colour is the record's and not a memory of it. */
const REC_DAMP = 0.14;

/**
 * Below this perceived lightness an accent is lifted toward white.
 *
 * The accent has to work as a hairline and as small text on near-black, so a dark navy sleeve cannot be
 * allowed to hand it a colour nobody can see. The lift is proportional (`0.42 - lum * 0.5`), so a colour
 * that is nearly at the threshold barely moves and one that is nearly black moves a lot.
 */
const MIN_LUM = 0.5;

export type Accent = {
  '--g': string;
  '--gb': string;
  '--gon': string;
  '--cx-stage': string;
  /** The record's two colours as a ground: the primary and the accent the server read off the sleeve, damped. */
  '--cx-a1': string;
  '--cx-a2': string;
  '--rec-deep': string;
  '--rec-bg': string;
  '--rec-mid': string;
  '--rec-accent': string;
  '--rec-ink': string;
};

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

/*
 * A colour as a *ground*: pulled most of the way to the page's black, then capped in luminance so a
 * yellow sleeve does not light the room like a lamp. 0.22 is bright enough to read as a colour on
 * #0a0a0c and dark enough that white type over it stays white type.
 */
const GROUND_DAMP = 0.5;
const GROUND_MAX_LUM = 0.26;

function groundOf(rgb: readonly [number, number, number] | undefined): Rgb {
  if (!rgb) {
    return STAGE_BASE;
  }
  let ground = blend([rgb[0], rgb[1], rgb[2]], STAGE_BASE, GROUND_DAMP);
  const lum = luminance(ground);
  if (lum > GROUND_MAX_LUM) {
    ground = blend(ground, STAGE_BASE, Math.min(1, (lum - GROUND_MAX_LUM) / lum + 0.3));
  }
  return ground;
}

/** Pulled toward the page's black until its luminance is under `max`; a near-miss barely moves. */
function capLum(rgb: Rgb, max: number): Rgb {
  const lum = luminance(rgb);
  return lum > max ? blend(rgb, STAGE_BASE, Math.min(1, (lum - max) / lum + 0.3)) : rgb;
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

  /* The frame: the record's dark twice over, and its colour lightly damped. */
  const dark = track?.colors?.backgroundDark;
  const deep = dark ? capLum(blend([dark[0], dark[1], dark[2]], STAGE_BASE, 0.58), 0.08) : STAGE_BASE;
  const bg = dark ? capLum(blend([dark[0], dark[1], dark[2]], STAGE_BASE, 0.3), 0.15) : ([16, 17, 20] as Rgb);
  let rec = silver;
  if (primary) {
    rec = blend([primary[0], primary[1], primary[2]], silver, REC_DAMP);
    const recLum = luminance(rec);
    if (recLum < MIN_LUM) {
      rec = lighten(rec, MIN_LUM - 0.08 - recLum * 0.5);
    }
  }
  const mid = primary ? capLum(blend([primary[0], primary[1], primary[2]], bg, 0.45), 0.3) : ([22, 23, 28] as Rgb);
  const onDark = track?.colors?.onDark;
  const ink = onDark ? lighten([onDark[0], onDark[1], onDark[2]], 0.55) : ([247, 248, 250] as Rgb);

  return {
    '--rec-deep': toHex(deep),
    '--rec-bg': toHex(bg),
    '--rec-mid': toHex(mid),
    '--rec-accent': toHex(rec),
    '--rec-ink': toHex(ink),
    '--g': toHex(accent),
    '--gb': toHex(lighten(accent, 0.42)),
    '--gon': '#0a0a0b',
    '--cx-stage': toHex(stageOf(track)),
    '--cx-a1': toHex(groundOf(track?.colors?.primary)),
    /* The accent falls back to the primary rather than to black, so a sleeve the server read as one colour
       still makes a room of one colour rather than a room with a dark corner. */
    '--cx-a2': toHex(groundOf(track?.colors?.accent ?? track?.colors?.primary)),
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
