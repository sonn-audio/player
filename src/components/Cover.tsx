/**
 * Cover art for a zone.
 *
 * Uses `/zones/{id}/cover` rather than `track.coverUrl` directly, for the reason the
 * contract gives: `coverUrl` is the artwork's real location, which can be a remote CDN, a
 * data uri, or a url only the server can reach. The per-zone route is one address that
 * follows whatever the zone is playing, and it is the server's job to fetch the awkward
 * cases.
 *
 * `track.coverUrl` is still used — as the cache key. The zone url deliberately does not
 * change per track, so a browser will happily keep the previous image; varying an
 * otherwise-ignored parameter with a value that moves per track is the contract's own
 * suggested fix.
 *
 * A zone playing nothing answers `404`, so the placeholder here is drawn on error rather
 * than expected as blank bytes.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { motionUrl } from '@/art/motion';
import type { ApiZoneState } from '@/api/types';

export function Cover({
  zone,
  animatedUrl,
  size = 320,
  className,
  anchor,
}: {
  zone: ApiZoneState | null;
  animatedUrl?: string;
  /** Pixel hint passed upstream where the provider offers variants. */
  size?: number;
  className?: string;
  /**
   * Marks this cover as the one that flies when the player switches face — see `shell/coverMorph`.
   * Spread onto the clipping box rather than the image, because the box is what has the radius and the
   * shadow, and those are half of what makes the flight read as the same object.
   */
  anchor?: { ref: (element: HTMLElement | null) => void; 'data-morph': 'cover' };
}) {
  const api = useApi();
  /*
   * Three stops, not two.
   *
   * The server-proxied url is the right first choice for the reason above, but a single failed fetch
   * used to end the story: the largest element on the page fell back to a glyph and stayed there until
   * the track changed, while the queue row beside it drew the same artwork perfectly — because it uses
   * the remote url straight from the zone state. So a failure now tries that url before giving up. It
   * costs one browser request to a CDN in the case where our own copy did not arrive, which is plainly
   * better than showing a music note over a record sleeve we have the address of.
   */
  const [stage, setStage] = useState<'proxy' | 'direct' | 'none'>('proxy');
  const cacheKey = zone?.track?.coverUrl ?? '';

  /*
   * Motion artwork, resolved to something this browser can actually play.
   *
   * `animatedCoverUrl` arrives as an HLS manifest, and Chrome has never played HLS from a `<video src>` —
   * so handing it over directly (which is what this did) animated in Safari and showed a still everywhere
   * else, silently. `motionUrl` turns it into the plain fragmented MP4 the manifest is carved out of; see
   * that file for why one exists. Null until it resolves, and null forever if it does not, which leaves the
   * still exactly as it was.
   */
  const [motion, setMotion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setMotion(null);
    void motionUrl(animatedUrl).then((resolved) => {
      if (live) {
        setMotion(resolved);
      }
    });
    return () => {
      live = false;
    };
  }, [animatedUrl]);

  // A new track means a new attempt, including after one that had no art at all.
  useEffect(() => {
    setStage('proxy');
  }, [zone?.id, cacheKey]);

  const direct = zone?.track?.coverUrl ?? '';
  // Straight to the placeholder when the fallback has nowhere to go.
  const failed = stage === 'none' || (stage === 'direct' && !direct);
  const showPlaceholder = !zone || !zone.track || failed;
  const src = stage === 'proxy' ? api.coverUrl(zone?.id ?? 0, { size, cacheKey }) : direct;
  const onImageError = (): void => setStage((at) => (at === 'proxy' ? 'direct' : 'none'));

  return (
    <div className={`cover ${className ?? ''}`} data-empty={showPlaceholder || undefined} {...anchor}>
      {showPlaceholder ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="cover-placeholder">
          <path
            fill="currentColor"
            d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z"
          />
        </svg>
      ) : motion ? (
        <video
          src={motion}
          poster={src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onError={onImageError}
        />
      ) : (
        <img
          src={src}
          alt=""
          /* Not lazy: this is the hero, always in view, and deferring it is how a page shows a hole
             where its subject goes. */
          decoding="async"
          onError={onImageError}
        />
      )}
    </div>
  );
}

/**
 * Artwork for a row that carries its own url — a queue entry, a favourite, a recent.
 *
 * These have no per-zone equivalent: the zone cover route only knows what is playing
 * *now*, so a list of things that are not playing has to use the urls the API gave it.
 */
export function ItemCover({ url, animatedUrl, className }: { url: string; animatedUrl?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return <div className={`cover ${className ?? ''}`} data-empty />;
  }
  return (
    <div className={`cover ${className ?? ''}`}>
      {animatedUrl ? (
        <video
          src={animatedUrl}
          poster={url || undefined}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
