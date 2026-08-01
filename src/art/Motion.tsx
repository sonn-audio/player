/**
 * A sleeve that moves, over the sleeve that does not.
 *
 * Motion artwork is the one thing an *art* player should obviously do and this one was throwing away: the
 * contract has carried `animatedCoverUrl` all along and nothing rendered it. It is a layer rather than a
 * replacement — the still is always underneath, painted by whoever owns the element, and the video fades in
 * on top only once it is resolved *and* actually playing. So a cover with no motion, a manifest that will
 * not resolve, a browser that refuses to autoplay and a slow connection all look identical: the still,
 * which is what they should look like.
 *
 * `active` is what stops a shelf of thirty tiles from opening thirty video streams. Only the one being
 * pointed at asks for anything; everything else is a still and costs nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { motionUrl } from '@/art/motion';

export function Motion({
  src,
  active = true,
  className = 'cx-motion',
}: {
  /** The contract's `animatedCoverUrl`. Undefined for most covers, which is the common case. */
  src: string | undefined;
  /** False for a tile nobody is looking at. */
  active?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!src || !active) {
      return undefined;
    }
    let live = true;
    void motionUrl(src).then((resolved) => {
      if (live) {
        setUrl(resolved);
      }
    });
    return () => {
      live = false;
    };
  }, [src, active]);

  /*
   * Reset when it stops being the one in view.
   *
   * Without this a tile keeps its decoded video around after the pointer has left, and a shelf you have
   * swept across is holding ten of them. Dropping the url unmounts the element and with it the buffer.
   */
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setUrl(null);
    }
  }, [active]);

  if (!url || !active) {
    return null;
  }

  return (
    <video
      ref={video}
      className={className}
      src={url}
      data-on={playing || undefined}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      // Only reveal it once frames are actually arriving: fading in a video that has not started leaves a
      // black square where the sleeve was.
      onPlaying={() => setPlaying(true)}
      onError={() => setUrl(null)}
      aria-hidden="true"
    />
  );
}
