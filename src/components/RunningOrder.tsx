/**
 * What this room plays after this — down the column, under the record.
 *
 * The column under the sleeve was page: quiet, but a hole in the middle of the composition, and the
 * one thing this face had stopped saying anywhere. The queue used to be a tab pinned under the
 * display, where a twelve-track album took two hundred pixels off the top of the spectrum every time;
 * it moved out to the rail, and the panel had been silent about what is coming ever since.
 *
 * So it comes back here, in the shape this column actually is: tall and narrow. A running order —
 * title, artist, length — set as type rather than as sleeves, because the one picture on this face is
 * the record above it and a column of thumbnails would compete with it. The art face is where a queue
 * is a shelf of covers; here it is the list on the back of the sleeve.
 *
 * The box is a stated height and the list scrolls inside it, so how much of the running order you see
 * is a decision rather than a consequence of the window's height. The count at the foot is the one
 * thing a scrollbar cannot say: how many entries there are beyond the page this asked the server for.
 *
 * **No numbers.** A queue you can reorder has no stable numbering — the moment a row moves, every
 * number under it is wrong until the server answers — and they were a ladder for the eye rather than
 * information. The grip that replaced them is worth the same 18px and does something.
 *
 * Pressing an entry jumps to it (`queuePlay` takes the *entry* id, so the same track twice is two
 * different rows); dragging its grip moves it (`queueMove`). Nothing here polls: `useZoneCollection`
 * re-reads when the server says this room's queue went stale.
 *
 * **When nothing follows** — the last track of an album, a radio stream, a line-in — the column shows
 * what this room played instead. A player that goes blank on the last track is a player that looks
 * broken exactly when someone is deciding what to put on next, and "what was that one before this?"
 * is the question a room actually gets asked. Recents are neither pressable nor draggable: they carry
 * no entry id, and there is nothing to reorder about the past.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import { Icon } from '@/components/Icon';
import { formatTime } from '@/lib/format';
import type { ApiQueue, ApiQueueItem, ApiRecents, ApiZoneState } from '@/api/types';

/** One page is plenty: the count comes from `total`, and the whole list is a place in the rail. */
const PAGE = 40;

/** How far a pointer travels on a grip before it is a drag rather than a slip. */
const THRESHOLD_PX = 5;

/** Where a dragged entry would land: before this id, or at the end. */
type Drop = { beforeId: string | null };

/**
 * Dragging one entry to another place in the running order.
 *
 * Pointer events rather than HTML5 drag-and-drop, for the reasons the art face's `useRoomDrag` gives:
 * DnD hands you a browser-drawn ghost you cannot style and fires nothing useful under a finger. The
 * target is hit-tested from `data-queue-id` on the rows, so nothing has to keep a table of rectangles
 * in step with a list that changes under it.
 *
 * The move is applied locally the moment the pointer is released and the server is told after. A queue
 * that waits for a round trip before showing the row in its new place feels broken at exactly the
 * moment the gesture ends; `queue.changed` re-reads the truth a moment later and the draft is dropped.
 */
function useReorder(
  rows: ApiQueueItem[],
  onMove: (itemId: string, beforeId: string | null) => void,
): {
  rows: ApiQueueItem[];
  dragId: string | null;
  drop: Drop | null;
  begin: (itemId: string, event: React.PointerEvent) => void;
} {
  const [draft, setDraft] = useState<ApiQueueItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  /* The rows as they are right now, for the handlers the gesture installs on the document. */
  const live = useRef(rows);
  live.current = draft ?? rows;

  /* The server's answer always wins: a fresh read replaces whatever the drag left behind. */
  useEffect(() => setDraft(null), [rows]);

  const begin = useCallback(
    (itemId: string, event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const from = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let target: Drop | null = null;

      const at = (x: number, y: number): Drop | null => {
        const row = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>('[data-queue-id]');
        if (!row) {
          return null;
        }
        const id = row.dataset.queueId ?? null;
        if (id === itemId) {
          return null;
        }
        /* Above the midpoint the entry lands before this row, below it after — which is the row after
           this one, or the end of the list. */
        const box = row.getBoundingClientRect();
        if (y < box.top + box.height / 2) {
          return { beforeId: id };
        }
        const index = live.current.findIndex((entry) => entry.id === id);
        const next = live.current[index + 1];
        return { beforeId: next && next.id !== itemId ? next.id : null };
      };

      const move = (moveEvent: PointerEvent): void => {
        const travelled =
          Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y);
        if (!dragging && travelled < THRESHOLD_PX) {
          return;
        }
        dragging = true;
        setDragId(itemId);
        target = at(moveEvent.clientX, moveEvent.clientY);
        setDrop(target);
      };

      const end = (): void => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        setDragId(null);
        setDrop(null);
        if (!dragging || !target) {
          return;
        }
        const beforeId = target.beforeId;
        const current = live.current;
        const moving = current.find((entry) => entry.id === itemId);
        if (!moving) {
          return;
        }
        const without = current.filter((entry) => entry.id !== itemId);
        const index = beforeId === null ? without.length : without.findIndex((entry) => entry.id === beforeId);
        setDraft([...without.slice(0, index), moving, ...without.slice(index)]);
        onMove(itemId, beforeId);
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
    },
    [onMove],
  );

  return { rows: draft ?? rows, dragId, drop, begin };
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
  const { data } = useZoneCollection<ApiQueue>((id) => api.getQueue(id, 0, PAGE), zone.id, 'queue');
  const recent = useZoneCollection<ApiRecents>(
    (id) => api.getRecents(id, 0, PAGE),
    zone.id,
    'recents',
  );

  /*
   * Everything after the one playing.
   *
   * `currentIndex` is null for a queue nobody has started from — a radio stream, a line-in — and in
   * that case there is nothing "after this", so the whole page is what is coming.
   */
  const from = data?.currentIndex == null ? 0 : data.currentIndex + 1;
  /*
   * The one playing is not one of the ones coming.
   *
   * `currentIndex` is the server's answer and it is usually right, but it is null for a queue nobody
   * started from and it can lag a reorder by a beat — and in both cases the first row of "up next" was
   * the track named in 60px type directly above it. Dropping a leading entry that matches what is
   * playing costs one comparison and closes both holes.
   */
  const sliced = data?.items.slice(from) ?? [];
  const first = sliced[0];
  const ahead =
    first && first.title === zone.track?.title && first.artist === zone.track?.artist
      ? sliced.slice(1)
      : sliced;
  const remaining = Math.max(0, (data?.total ?? 0) - from);

  const move = useCallback(
    (itemId: string, beforeId: string | null) => {
      void api.queueMove(zone.id, itemId, ...(beforeId ? ([beforeId] as const) : ([] as const)));
    },
    [api, zone.id],
  );
  const order = useReorder(ahead, move);

  /* What played before, minus the one playing — a room's recents lead with the current track. */
  const played = (recent.data?.items ?? []).filter(
    (item) => !(item.title === zone.track?.title && item.artist === zone.track?.artist),
  );

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

        <ol className="np-order-list">
          {played.map((item, index) => {
            const previous = index === 0 ? zone.track?.artist : played[index - 1]?.artist;
            const shows = item.artist && item.artist !== previous;

            return (
              <li className="np-order-item" key={`${item.title}-${item.artist}-${index}`}>
                <span className="np-order-row" data-static>
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

      <ol className="np-order-list">
        {order.rows.map((entry, index) => {
          /*
           * The artist, only when it changes.
           *
           * Nine rows of `Michael Jackson` under a Michael Jackson record is the list telling you what
           * you already know, nine times, in the space where the titles should be reading cleanly. So
           * the name appears where it is news: the first row compares against what is playing, every
           * other row against the row above it. An album reads as a list of songs; a mixed queue keeps
           * every name it needs.
           */
          const previous = index === 0 ? zone.track?.artist : order.rows[index - 1]?.artist;
          const shows = entry.artist && entry.artist !== previous;

          return (
            <li
              className="np-order-item"
              key={entry.id}
              data-queue-id={entry.id}
              data-dragging={order.dragId === entry.id || undefined}
              data-drop={order.drop?.beforeId === entry.id || undefined}
            >
              {/*
               * The grip, where the numbers used to be.
               *
               * Its own element rather than part of the row, because the row is a button and a control
               * inside a button is neither valid nor operable. `touch-action: none` in the stylesheet is
               * what stops a finger on the grip from scrolling the list instead of moving the entry.
               */}
              <span
                className="np-order-grip"
                onPointerDown={(event) => order.begin(entry.id, event)}
                title="Drag to reorder"
                role="presentation"
              >
                <Icon name="grip" />
              </span>

              <button
                type="button"
                className="np-order-row"
                onClick={() => void api.queuePlay(zone.id, entry.id)}
                title={`Play ${entry.title}${entry.artist ? ` — ${entry.artist}` : ''}`}
              >
                <span className="np-order-text">
                  <span className="np-order-title">{entry.title}</span>
                  {shows && <i className="np-order-artist">{entry.artist}</i>}
                </span>
                {/* The length, right-aligned and tabular — the one number a running order has always
                    carried, and what makes this read as the back of a sleeve rather than a menu. */}
                <span className="np-order-time mono">
                  {entry.duration > 0 ? formatTime(entry.duration) : ''}
                </span>
              </button>
            </li>
          );
        })}

        {/* The end of the list is a target too: dropping past the last row sends the entry there. */}
        {order.dragId && (
          <li
            className="np-order-tail"
            data-queue-id=""
            data-drop={order.drop?.beforeId === null || undefined}
            aria-hidden="true"
          />
        )}
      </ol>

      {/* What a page cannot say for itself. Absent when the list holds the whole queue. */}
      {remaining > order.rows.length && (
        <button type="button" className="np-order-more mono" onClick={onOpenQueue}>
          {remaining - order.rows.length} more
        </button>
      )}
    </section>
  );
}
