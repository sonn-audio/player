/**
 * What this room plays after this — down the column, under the record.
 *
 * The column under the sleeve was page: quiet, but a hole in the middle of the composition, and the
 * one thing this face had stopped saying anywhere. The queue used to be a tab pinned under the
 * display, where a twelve-track album took two hundred pixels off the top of the spectrum every time;
 * it moved out to the rail, and the panel has been silent about what is coming ever since.
 *
 * So it comes back here, in the shape this column actually is: tall and narrow. A running order —
 * index, title, artist — set as type rather than as sleeves, because the one picture on this face is
 * the record above it and a column of thumbnails would compete with it. The art face is where a
 * queue is a shelf of covers; here it is a list on the back of the sleeve.
 *
 * It shows as many as the column holds and fades at the foot rather than scrolling: a list you scroll
 * is a place you go, and this is a thing you glance at. The count and the way into the full list are
 * the last line, which is the only fact a clipped list cannot state itself.
 *
 * The fade is applied only when the list is *actually* clipped (see `useClipped`). A gradient over a
 * list that fits greys out its last row for no reason — the drawing says "there is more" where there
 * is nothing, which is worse than no fade at all.
 *
 * Pressing an entry jumps to it (`queuePlay` takes the *entry* id, so the same track twice is two
 * different rows). Nothing here polls: `useZoneCollection` re-reads when the server says this room's
 * queue went stale.
 *
 * **When nothing follows** — the last track of an album, a radio stream, a line-in — the column shows
 * what this room played instead. A player that goes blank on the last track is a player that looks
 * broken exactly when someone is deciding what to put on next, and "what was that one before this?"
 * is the question a room actually gets asked. Recents are not pressable here: they carry no entry id
 * and re-playing a title from a list of ghosts is a different feature than a running order.
 */
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import { formatTime } from '@/lib/format';
import type { ApiQueue, ApiRecents, ApiZoneState } from '@/api/types';

/** One page is plenty: the column clips long before this, and the count comes from `total`. */
const PAGE = 40;

/**
 * Whether this box is showing less than it holds.
 *
 * Two things move it — the window's height and how many entries there are — so it watches the element
 * rather than deriving it from either. CSS cannot ask "did this overflow", and a fade that lies is a
 * fade that has to be measured.
 */
function useClipped(): [React.MutableRefObject<HTMLOListElement | null>, boolean] {
  const ref = useRef<HTMLOListElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return undefined;
    }
    const read = (): void => setClipped(node.scrollHeight > node.clientHeight + 2);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  });

  return [ref, clipped];
}

export function RunningOrder({
  zone,
  onOpenQueue,
}: {
  zone: ApiZoneState;
  /** Where the whole list lives — the rail's own Queue. */
  onOpenQueue: () => void;
}) {
  const api = useApi();
  const [listRef, clipped] = useClipped();
  const { data } = useZoneCollection<ApiQueue>((id) => api.getQueue(id, 0, PAGE), zone.id, 'queue');
  const recent = useZoneCollection<ApiRecents>((id) => api.getRecents(id, 0, PAGE), zone.id, 'recents');

  /*
   * Everything after the one playing.
   *
   * `currentIndex` is null for a queue nobody has started from — a radio stream, a line-in — and in
   * that case there is nothing "after this", so the whole page is what is coming.
   */
  const from = data?.currentIndex == null ? 0 : data.currentIndex + 1;
  const ahead = data?.items.slice(from) ?? [];
  const remaining = Math.max(0, (data?.total ?? 0) - from);

  /* What played before, minus the one playing — a room's recents lead with the current track. */
  const played = (recent.data?.items ?? []).filter((item) => !(item.title === zone.track?.title && item.artist === zone.track?.artist));

  if (ahead.length === 0 && played.length === 0) {
    return null;
  }

  if (ahead.length === 0) {
    return (
      <section className="np-order" data-past>
        <h3 className="np-order-head mono">
          Just played
          <i aria-hidden="true" />
        </h3>

        <ol className="np-order-list" ref={listRef} data-clipped={clipped || undefined}>
          {played.map((item, index) => {
            const previous = index === 0 ? zone.track?.artist : played[index - 1]?.artist;
            const shows = item.artist && item.artist !== previous;

            return (
              <li key={`${item.title}-${item.artist}-${index}`}>
                <span className="np-order-row" data-static>
                  {/* No index. A running order is numbered because the numbers are the order it will
                      happen in; a list of what is behind you has no such promise to make. */}
                  <span className="np-order-index mono" aria-hidden="true" />
                  <span className="np-order-text">
                    <span className="np-order-title">{item.title}</span>
                    {shows && <i className="np-order-artist">{item.artist}</i>}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <section className="np-order">
      {/* A label and a rule: the label names the column, the rule gives it a top edge without a box.
          Same device the chain uses under the display. */}
      <h3 className="np-order-head mono">
        Up next
        <i aria-hidden="true" />
      </h3>

      <ol className="np-order-list" ref={listRef} data-clipped={clipped || undefined}>
        {ahead.map((entry, index) => {
          /*
           * The artist, only when it changes.
           *
           * Nine rows of `Michael Jackson` under a Michael Jackson record is the list telling you what
           * you already know, nine times, in the space where the titles should be reading cleanly. So
           * the name appears where it is news: the first row compares against what is playing, every
           * other row against the row above it. An album reads as a list of songs; a mixed queue keeps
           * every name it needs.
           */
          const previous = index === 0 ? zone.track?.artist : ahead[index - 1]?.artist;
          const shows = entry.artist && entry.artist !== previous;

          return (
            <li key={entry.id}>
              <button
                type="button"
                className="np-order-row"
                onClick={() => void api.queuePlay(zone.id, entry.id)}
                title={`Play ${entry.title}${entry.artist ? ` — ${entry.artist}` : ''}`}
              >
                {/* Two digits, tabular, dim: the numbers are a ladder for the eye, not information —
                  which is why they are the position in the running order and not the track number. */}
                <span className="np-order-index mono">{String(index + 1).padStart(2, '0')}</span>
                <span className="np-order-text">
                  <span className="np-order-title">{entry.title}</span>
                  {shows && <i className="np-order-artist">{entry.artist}</i>}
                </span>
                {/* The length, right-aligned and tabular — the one number a running order has always
                  carried, and what makes this read as the back of a sleeve rather than a menu. */}
                <span className="np-order-time mono">{entry.duration > 0 ? formatTime(entry.duration) : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* What a clipped list cannot say for itself. Absent when the column is showing all of it. */}
      {remaining > ahead.length && (
        <button type="button" className="np-order-more mono" onClick={onOpenQueue}>
          {remaining - ahead.length} more
        </button>
      )}
    </section>
  );
}
