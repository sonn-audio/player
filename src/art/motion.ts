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

/**
 * Whether this browser can decode a variant, asked of the browser rather than assumed.
 *
 * Apple offers the same sleeve twice at the top size: `avc1` and `hvc1`. H.265 is the better encode and
 * Safari plays it; Chrome and Firefox on Linux and Windows do not decode it at all, and a video element
 * handed one fires `error` — which `Motion` correctly turns back into the still, so the feature looks
 * absent rather than broken and nothing says why. Picking on file size alone, as this did, is a coin
 * toss between the two 768px variants.
 *
 * `canPlayType` returns `'probably'`, `'maybe'` or `''`. Anything non-empty counts: 'maybe' is what a
 * browser says when it can decode the codec but will not promise about the container, which is exactly
 * the honest answer for a fragmented MP4 pulled out of an HLS manifest.
 */
function canPlay(codecs: string): boolean {
  if (!codecs) {
    return false;
  }
  return Boolean(document.createElement('video').canPlayType(`video/mp4; codecs="${codecs}"`));
}

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
   * A master manifest lists each variant on the line *after* its `#EXT-X-STREAM-INF`, so the two are read
   * as a pair — the directive for what the stream *is* (its codec, its true resolution) and the line under
   * it for where it lives. This used to read only the second half and take the size out of the filename,
   * which threw away the one field that decides whether the thing will play at all.
   *
   * Sorted by pixels rather than by declared bandwidth, because what matters here is how big a sleeve it
   * has to fill, not bitrate.
   */
  const lines = master.split('\n').map((line) => line.trim());
  const variants: { url: string; size: number; codecs: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const next = lines[index + 1];
    if (!lines[index]!.startsWith('#EXT-X-STREAM-INF') || !next || next.startsWith('#') || !isPlayable(next)) {
      continue;
    }
    const resolution = /RESOLUTION=(\d+)x\d+/.exec(lines[index]!)?.[1];
    variants.push({
      url: resolve(next, manifestUrl),
      // The manifest's own resolution first; the filename is the fallback for a manifest that omits it.
      size: resolution ? Number(resolution) : sizeOf(next),
      codecs: /CODECS="([^"]+)"/.exec(lines[index]!)?.[1] ?? '',
    });
  }
  /*
   * Smallest first, and at equal size the widely-decodable encode first.
   *
   * The tiebreak matters on exactly the browsers the `canPlayType` filter below cannot help: one that
   * answers `''` to everything leaves the list in manifest order, and Apple happens to print `avc1`
   * before `hvc1` today. Ordering it here is the difference between that being true and it being
   * relied upon.
   */
  variants.sort(
    (a, b) => a.size - b.size || Number(b.codecs.startsWith('avc1')) - Number(a.codecs.startsWith('avc1')),
  );

  /*
   * Only what this browser can actually decode — and if it says it can decode none of them, take the list
   * as it stands rather than resolving to nothing. A Chromium built without proprietary codecs answers
   * `''` to every question here; on that browser no variant was ever going to play, and returning the
   * still is what happens either way. Deciding it here would only mean deciding it *sooner*, and being
   * wrong about a browser whose `canPlayType` is pessimistic would cost the feature entirely.
   */
  const decodable = variants.filter((variant) => canPlay(variant.codecs));
  const usable = decodable.length > 0 ? decodable : variants;

  const pick = usable.find((variant) => variant.size >= WANT_PX) ?? usable[usable.length - 1];
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
