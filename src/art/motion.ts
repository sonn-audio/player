/**
 * Animated artwork, playable outside Safari.
 *
 * Apple ships motion covers as HLS (`…_default.m3u8`), which only Safari can play from a `<video src>`.
 * Handing that url straight to a video element — which is what the contract's `animatedCoverUrl` invites —
 * gets you a still poster in every other browser, so the feature reads as broken rather than absent.
 *
 * It does not have to be. Those manifests are **byte-range HLS over a single fragmented MP4**: every
 * segment is a `Range:` into one file, and the `EXT-X-MAP` init segment is the head of that same file. So
 * the whole asset is already a complete, ordinary `.mp4` — two fetches to find its name and any browser
 * can play it directly, no media-source shim, no dependency. Apple serves the manifests with
 * `access-control-allow-origin: *`, which is the other half of why this works at all.
 *
 * Resolution is cached per url and shared across every component, because the same sleeve is asked for by
 * the shelf, the hero and the stage in quick succession and each one would otherwise fetch two manifests.
 */

/** Resolved once per manifest url. `null` means "asked, and there is nothing playable here". */
const cache = new Map<string, Promise<string | null>>();

/**
 * Which variant to take.
 *
 * The manifests offer 360px through 1080px. 720 is the smallest that still looks sharp on a half-window
 * sleeve, and the largest worth spending on a 40px tile is far below it — but one resolution is fetched
 * per *asset*, not per placement, so this picks the size the biggest consumer needs and lets the small
 * ones scale it down. Anything ≥ this wins; otherwise the largest on offer.
 */
const WANT_PX = 720;

/** Ignore trick-play streams: they are I-frame-only and play as a stutter of stills. */
const isPlayable = (line: string): boolean => line.includes('_video_') && !line.includes('trickPlay');

function resolve(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** The `NxN` in a variant's name, or 0 when it does not say. */
function sizeOf(name: string): number {
  const match = /_(\d+)x\1(?:[._]|$)/.exec(name);
  return match?.[1] ? Number(match[1]) : 0;
}

async function look(manifestUrl: string): Promise<string | null> {
  const master = await fetch(manifestUrl).then((response) => (response.ok ? response.text() : ''));
  if (!master) {
    return null;
  }

  /*
   * A master manifest lists each variant on the line *after* its `#EXT-X-STREAM-INF`, so the useful lines
   * are simply the ones that are not directives. Sorted by the size in the filename rather than by the
   * declared bandwidth, because what matters here is pixels on a sleeve, not bitrate.
   */
  const variants = master
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && isPlayable(line))
    .map((line) => ({ url: resolve(line, manifestUrl), size: sizeOf(line) }))
    .sort((a, b) => a.size - b.size);

  const pick = variants.find((variant) => variant.size >= WANT_PX) ?? variants[variants.length - 1];
  if (!pick) {
    return null;
  }

  const media = await fetch(pick.url).then((response) => (response.ok ? response.text() : ''));
  /*
   * `EXT-X-MAP` names the init segment, and in a byte-range playlist that is the first bytes of the one
   * file every other segment also points into. Which makes it the whole asset.
   */
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(media);
  if (!map?.[1]) {
    return null;
  }

  const file = resolve(map[1], pick.url);
  // A playlist that is *not* byte-range would name a real init segment here, and playing that alone would
  // give a frozen first frame. Only take it when the media segments point at the same file.
  return media.includes(map[1]) && media.includes('#EXT-X-BYTERANGE') ? file : null;
}

/**
 * The plain video url behind a motion cover, or null if there is not one.
 *
 * Never throws: a cover that will not resolve is a cover that stays a still, which is exactly what should
 * happen and is not worth an error path in three call sites.
 */
export function motionUrl(animatedCoverUrl: string | undefined): Promise<string | null> {
  if (!animatedCoverUrl) {
    return Promise.resolve(null);
  }
  // Already a plain file (a provider that is not Apple): nothing to resolve.
  if (!animatedCoverUrl.includes('.m3u8')) {
    return Promise.resolve(animatedCoverUrl);
  }

  const hit = cache.get(animatedCoverUrl);
  if (hit) {
    return hit;
  }

  const pending = look(animatedCoverUrl).catch(() => null);
  cache.set(animatedCoverUrl, pending);
  return pending;
}
