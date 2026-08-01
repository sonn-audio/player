/**
 * Artwork as a CSS background, for the art player.
 *
 * The technical player uses `<Cover>`, an `<img>` with an error fallback. This face wants the same
 * picture as a *background* — blurred behind the stage, cropped into a 40px chip, filling a
 * `background-position: center 30%` wash — and none of that is an image element.
 *
 * The url is `/zones/{id}/cover`, not `track.coverUrl`, for the reason the contract gives:
 * `coverUrl` is the artwork's real location, which can be a remote CDN, a data uri, or an address
 * only the server can reach. The per-zone route is one address that follows whatever the zone is
 * playing — and `cacheKey` is how it stays correct, since that address deliberately does not change
 * when the picture does. Varying an otherwise-ignored parameter with something that moves per track
 * is the contract's own suggested fix.
 *
 * A zone playing nothing answers 404, and a failed background is simply absent — which is why every
 * caller must still draw its placeholder underneath rather than relying on the image to arrive.
 */
import type { ApiClient } from '@/api/client';
import type { ApiZoneState } from '@/api/types';

/** `url("…")` for a zone's current artwork, or undefined when there is nothing to show. */
export function zoneCoverCss(
  api: ApiClient,
  zone: ApiZoneState | null | undefined,
  size = 640,
): string | undefined {
  if (!zone?.track) {
    return undefined;
  }
  return `url("${api.coverUrl(zone.id, { size, cacheKey: zone.track.coverUrl })}")`;
}

/** The same, for a row that carries its own url (a queue entry, a recent, a browse tile). */
export function itemCoverCss(url: string | undefined): string | undefined {
  return url ? `url("${url}")` : undefined;
}
