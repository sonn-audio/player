/**
 * Artwork for a folder, made out of what is in it.
 *
 * A browsable folder has no sleeve of its own — "Albums", "Genres & Moods", "My Playlists" are
 * places, not records — so `ItemCover` draws its music-note placeholder and a listing of folders
 * becomes a row of identical empty squares. That is the whole reason a service root looked
 * unfinished: the page had nothing on it but the absence of artwork.
 *
 * So the folder borrows: the first four sleeves inside it, tiled. Which is not decoration — a
 * mosaic of four albums says what "New Releases" currently holds before you open it, and two
 * folders side by side stop being interchangeable.
 *
 * Three outcomes, in order:
 *
 *  - **Four or more** covers inside → a 2×2 quilt.
 *  - **One to three** → the first one, full bleed. A quilt with holes in it reads as failed
 *    loading; one real sleeve reads as deliberate.
 *  - **None, or nothing inside** → a rack glyph. Explicitly *not* the music note: a note over an
 *    empty square says "artwork is missing", and for a folder nothing is missing.
 *
 * The fetch waits until the tile is near the viewport, because this turns one listing request into
 * one per tile and a sixty-row folder listing must not become sixty requests on mount.
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useFolderPreview } from '@/state/useFolderPreview';
import { useInView } from '@/state/useInView';

/** Enough to fill the quilt, and cheap enough to ask for on a screenful of tiles. */
const PROBE = 4;

export function FolderCover({ id, className }: { id: string; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const preview = useFolderPreview(id, PROBE, seen);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [id]);

  const covers = preview.items.map((item) => item.coverUrl).filter((url): url is string => !!url);
  const quilt = !broken && covers.length >= 4;
  const single = !broken && !quilt ? covers[0] : undefined;
  const empty = !quilt && !single;

  return (
    <div
      ref={ref}
      className={`cover folder-cover ${className ?? ''}`}
      // `data-empty` reuses the centring the cover box already has for its placeholder, and
      // `data-pending` is what keeps the glyph from flashing in before the answer arrives. Every
      // branch draws the same square, so a folder never changes size when its preview lands.
      data-empty={empty || undefined}
      data-pending={(empty && preview.state !== 'ready') || undefined}
    >
      {quilt ? (
        <span className="folder-quilt">
          {covers.slice(0, 4).map((url, index) => (
            <img
              key={`${url}#${index}`}
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              // One dead url would leave a white gap in the quilt; the whole tile falls back
              // instead, which is the only way this stays a picture rather than a grid of holes.
              onError={() => setBroken(true)}
            />
          ))}
        </span>
      ) : single ? (
        <img src={single} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <Icon name="folder" className="cover-placeholder" />
      )}
    </div>
  );
}
