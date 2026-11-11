/**
 * The record's colours, read off the sleeve itself.
 *
 * The server sends two colours per track, chosen for small accents, and for years this face damped
 * even those toward grey: a frame "lit by the record" came out brown for every warm sleeve and black
 * for every dark one. A room is lit by the whole picture. So the picture is read here: the cover is
 * drawn into a 36-pixel square and its hues are weighed by how saturated and how mid-toned they are —
 * the same judgement an eye makes about what colour a sleeve "is". Up to three hues that are really
 * there come out, set to the lightness a ground wants and with their own saturation kept.
 *
 * A grey sleeve gives a graphite room rather than an invented colour. A picture that cannot be read
 * (a foreign host without CORS) gives nothing, and the caller falls back to the server's two colours.
 */
export type Palette = {
  /** Four colours for the ground, the most present first. */
  colors: [string, string, string, string];
  /** The one accent: the most vivid hue, light enough to be a button on the ground. */
  accent: string;
  /** The frame's dark: the leading hue at almost no lightness. */
  deep: string;
  /** Text on all of it. */
  ink: string;
};

type Hsl = [number, number, number];

function toHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round((((h % 1) + 1) % 1) * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const BINS = 18;

function read(image: HTMLImageElement): Palette | null {
  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  const weight = new Float64Array(BINS);
  const sumH = new Float64Array(BINS);
  const sumS = new Float64Array(BINS);
  let chroma = 0;
  let light = 0;
  const pixels = size * size;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = toHsl(data[i]!, data[i + 1]!, data[i + 2]!);
    light += l;
    /* A hue counts for how saturated it is and how far it is from black and white. */
    const w = s * clamp(1 - Math.abs(l - 0.5) * 1.7, 0.05, 1);
    chroma += w;
    const bin = Math.min(BINS - 1, Math.floor(h * BINS));
    weight[bin] = weight[bin]! + w;
    sumH[bin] = sumH[bin]! + h * w;
    sumS[bin] = sumS[bin]! + s * w;
  }
  chroma /= pixels;
  light /= pixels;

  /* A grey sleeve: graphite, with the faintest cool cast so it is a room and not a void. */
  if (chroma < 0.035) {
    const base = clamp(light, 0.25, 0.6);
    return {
      colors: [hsl(0.6, 0.05, 0.3 + base * 0.12), hsl(0.62, 0.07, 0.22), hsl(0.58, 0.04, 0.36), hsl(0.6, 0.06, 0.13)],
      accent: hsl(0.6, 0.06, 0.84),
      deep: hsl(0.62, 0.08, 0.045),
      ink: hsl(0.6, 0.1, 0.97),
    };
  }

  const order = Array.from({ length: BINS }, (_, bin) => bin).sort((a, b) => weight[b]! - weight[a]!);
  const picks: { h: number; s: number; w: number }[] = [];
  for (const bin of order) {
    if (weight[bin]! <= 0 || (picks.length > 0 && weight[bin]! < picks[0]!.w * 0.14)) {
      break;
    }
    const apart = picks.every((pick) => {
      const gap = Math.abs(pick.h - sumH[bin]! / weight[bin]!);
      return Math.min(gap, 1 - gap) > 0.09;
    });
    if (apart) {
      picks.push({ h: sumH[bin]! / weight[bin]!, s: sumS[bin]! / weight[bin]!, w: weight[bin]! });
    }
    if (picks.length === 3) {
      break;
    }
  }
  const lead = picks[0]!;
  const second = picks[1] ?? { h: lead.h + 0.07, s: lead.s * 0.9, w: 0 };
  const third = picks[2] ?? { h: lead.h - 0.06, s: lead.s * 0.8, w: 0 };
  /* How much colour the sleeve really has decides how much the room gets: a mostly-grey photograph
     with one red detail is a dim red room, not a red one. */
  const strength = clamp(chroma * 3.2, 0.45, 1);
  const ground = (pick: { h: number; s: number }, l: number): string => hsl(pick.h, clamp(pick.s, 0.3, 0.78) * strength, l);
  const vivid = [...picks].sort((a, b) => b.s * Math.sqrt(b.w) - a.s * Math.sqrt(a.w))[0]!;

  return {
    colors: [ground(lead, 0.42), ground(second, 0.36), ground(third, 0.46), ground(lead, 0.2)],
    accent: hsl(vivid.h, clamp(vivid.s, 0.45, 0.85) * clamp(strength + 0.15, 0, 1), 0.7),
    deep: hsl(lead.h, clamp(lead.s, 0.2, 0.5) * strength, 0.05),
    ink: hsl(lead.h, 0.22, 0.965),
  };
}

const cache = new Map<string, Promise<Palette | null>>();

/** The palette of the picture at `url`, read once and kept. Null when the picture cannot be read. */
export function paletteOf(url: string): Promise<Palette | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = new Promise<Palette | null>((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve(read(image));
      image.onerror = () => resolve(null);
      image.src = url;
    });
    cache.set(url, hit);
  }
  return hit;
}
