/**
 * What is coming, and what has been — as two lists, for the sheet that holds them.
 *
 * These used to live in a permanent 240px rail down the right of the stage, held at 62% opacity so that
 * a list of ten track titles would not compete with the 90px title beside it. That opacity was the
 * argument for the rail existing at all, and it was the wrong way round: a thing that has to be faded to
 * be tolerable on screen is a thing that should not be on screen. So the column is gone, the stage has
 * its width back, and both lists appear at full contrast in a sheet — reached from the one line the stage
 * kept (`NextUp`), or from the queue tab on a phone.
 *
 * Rows do the two things worth doing to a queue entry — play it, remove it — and nothing else.
 * Reordering by drag is a technical-player affordance and it is in the other face.
 */
import { useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { itemCoverCss } from '@/art/cover';
import { Bars, CloseGlyph, GripGlyph, PauseGlyph, PlayGlyph, PlusGlyph } from '@/art/glyphs';
import { Timeline } from '@/art/Stage';
import { zoneCoverCss } from '@/art/cover';
import type { Cur } from '@/art/useCur';
import { entryTitleOf, formatTime } from '@/lib/format';
import type { ApiQueue, ApiRecentItem, ApiZoneState } from '@/api/types';

/**
 * One row: a mark on the left, two lines, and the actions that appear when you reach for them.
 *
 * The mark is either the entry's own artwork or its position in the running order — see `oneRecord` for
 * which and why. The row that is playing shows neither: it shows three moving bars, which is the only
 * thing in the list that needs to be seen from across a room.
 */
function Row({
  cover,
  index,
  numbered,
  title,
  sub,
  meta,
  current,
  past,
  onPlay,
  onRemove,
  qid,
  onGrip,
  dragging = false,
  over = false,
}: {
  cover: string | undefined;
  /** Position in the running order, 1-based, for a queue that is one record. */
  index?: number;
  numbered?: boolean;
  title: string;
  sub: string;
  meta?: string;
  current?: boolean;
  past?: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  /** The entry's id, for a row that can be picked up and put down somewhere else. */
  qid?: string | undefined;
  onGrip?: ((event: React.PointerEvent) => void) | undefined;
  dragging?: boolean;
  /** Another row is being held over this one: it will land here. */
  over?: boolean;
}) {
  return (
    <div
      className="cx-qrow"
      data-current={current || undefined}
      data-past={past || undefined}
      data-numbered={numbered || undefined}
      data-qid={qid}
      data-dragging={dragging || undefined}
      data-over={over || undefined}
    >
      <button type="button" className="cx-qmain" onClick={onPlay}>
        <span className="cx-qmark">
          {current ? (
            <Bars />
          ) : numbered ? (
            <span className="cx-qnum mono">{index}</span>
          ) : (
            <span className="cx-qcov" style={{ backgroundImage: itemCoverCss(cover) }} />
          )}
        </span>
        <span className="cx-qmeta">
          <span className="cx-qtitle">{title}</span>
          {sub && <span className="cx-qsub">{sub}</span>}
        </span>
      </button>
      {meta && <span className="cx-qdur mono">{meta}</span>}
      {onRemove && (
        <button type="button" className="cx-qrm" onClick={onRemove} aria-label="Remove from queue">
          <CloseGlyph size={13} />
        </button>
      )}
      {onGrip && (
        <span className="cx-qgrip" onPointerDown={onGrip} role="presentation" title="Drag to reorder">
          <GripGlyph size={16} />
        </span>
      )}
    </div>
  );
}

/**
 * Is this queue one record, or a pile of things?
 *
 * A queue built by pressing play on an album is fourteen entries with the same sleeve, and drawing that
 * sleeve fourteen times down the left edge is fourteen copies of one fact — a wall of identical thumbnails
 * that carries no information and looks like a rendering bug. A run of one record wants what the back of a
 * sleeve has: numbers. A queue you have assembled by hand is the opposite case, where the artwork is the
 * fastest way to find the thing you added twenty minutes ago.
 *
 * Judged on the album name, falling back to the artwork url — a provider that leaves `album` empty on
 * queue entries still sends one cover for all of them.
 */
function oneRecord(items: ApiQueue['items']): boolean {
  if (items.length < 3) {
    return false;
  }
  const key = (item: ApiQueue['items'][number]): string => item.album || item.coverUrl || '';
  const first = key(items[0]!);
  return first !== '' && items.every((item) => key(item) === first);
}

/** A section's head inside the sheet: the label, the hairline, and the words on the right. */
function Sec({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="cx-qsec">
      <span className="cx-qsec-lbl mono">{label}</span>
      <span className="cx-qsec-rule" aria-hidden="true" />
      {children}
    </div>
  );
}

/**
 * The queue, as the concept has it: what is on, then what is next, then what was.
 *
 * It was two tabs — `next` and `recent` — under a head that named the room, and the record playing was
 * the first row of the first tab, marked with bars. Three things wrong with that at once: the record you
 * are listening to is not an item in a list, the past is not an alternative to the future, and a tab is a
 * choice you make before you can see what you are choosing between. So: the record at the top with its
 * own transport and timeline, `up next` as a section with the two things you do to a queue at its head
 * (shuffle, clear), the tracks already played folded away, and `earlier` — what this room played
 * before this queue — as the last section. Nothing to choose; it reads top to bottom.
 */
export function QueueSheet({
  zone,
  cur,
  queue,
  recents,
  onBrowse,
}: {
  zone: ApiZoneState;
  cur: Cur;
  queue: ApiQueue;
  recents: ApiRecentItem[];
  /** The way to the catalogue, from an empty queue. */
  onBrowse: () => void;
}) {
  const api = useApi();
  const at = queue.currentIndex ?? -1;
  const ahead = at >= 0 ? queue.items.slice(at + 1) : queue.items;
  const numbered = oneRecord(queue.items);
  const toggle = (): void => {
    void (cur.isPlaying ? api.pause(zone.id) : api.play(zone.id));
  };

  /*
   * Pick a row up, carry it, put it down.
   *
   * The row follows the pointer by a translate; the row under the pointer is marked as where it
   * will land; on release the server is asked to move the entry before that row (or after it, when
   * the drag went down). `queueMove` is the contract's own verb — nothing here reorders locally, the
   * next queue event does, which is why the row snaps back and then moves rather than moving twice.
   */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const aheadRef = useRef(ahead);
  aheadRef.current = ahead;
  const grip = (id: string) => (event: React.PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-qid]');
    if (!row) {
      return;
    }
    const startY = event.clientY;
    setDragId(id);
    const under = (x: number, y: number): string | null => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-qid]');
      const target = hit?.dataset.qid ?? null;
      return target && target !== id ? target : null;
    };
    const move = (moved: PointerEvent): void => {
      row.style.translate = `0 ${moved.clientY - startY}px`;
      setOverId(under(moved.clientX, moved.clientY));
    };
    const up = (upEvent: PointerEvent): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      row.style.translate = '';
      const target = under(upEvent.clientX, upEvent.clientY);
      setDragId(null);
      setOverId(null);
      if (!target) {
        return;
      }
      const list = aheadRef.current;
      const from = list.findIndex((item) => item.id === id);
      const to = list.findIndex((item) => item.id === target);
      if (from < 0 || to < 0) {
        return;
      }
      // Dragged down: land *after* the row under the pointer, i.e. before the one below it.
      const before = to > from ? list[to + 1]?.id : target;
      void api.queueMove(zone.id, id, before);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  return (
    <div className="cx-qsheet">
      {cur.hasTrack && (
        <div className="cx-qnow">
          <span className="cx-qnow-cov" style={{ backgroundImage: zoneCoverCss(api, cur.leader, 160) }} />
          <span className="cx-qnow-txt">
            <span className="cx-qnow-lbl mono">now playing</span>
            <span className="cx-qnow-title">{cur.title}</span>
            {cur.artist && <span className="cx-qnow-sub">{cur.artist}</span>}
          </span>
          <button type="button" className="cx-qnow-ring" aria-label={cur.isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
            {cur.isPlaying ? <PauseGlyph size={18} /> : <PlayGlyph size={19} />}
          </button>
          {cur.showBar && (
            <span className="cx-qnow-bar">
              <Timeline cur={cur} />
            </span>
          )}
        </div>
      )}

      <Sec label={ahead.length > 0 ? `up next · ${ahead.length}` : 'up next'}>
        {ahead.length > 0 && (
          <>
            <button
              type="button"
              className="cx-qsec-act mono"
              data-on={cur.shuffle || undefined}
              onClick={() => void api.setShuffle(zone.id, !cur.shuffle)}
            >
              shuffle
            </button>
            <button type="button" className="cx-qsec-act mono" onClick={() => void api.queueClear(zone.id)}>
              clear
            </button>
          </>
        )}
      </Sec>

      {ahead.length > 0 ? (
        <div className="cx-rail-sec">
          {numbered && (queue.items[0]!.album || queue.items[0]!.artist) && (
            <p className="cx-qrun mono">{[queue.items[0]!.album, queue.items[0]!.artist].filter(Boolean).join(' · ')}</p>
          )}
          {ahead.map((item, offset) => (
            <Row
              key={item.id}
              cover={item.coverUrl}
              index={at + offset + 2}
              numbered={numbered}
              title={entryTitleOf(item)}
              sub={numbered ? '' : [item.artist, item.album].filter(Boolean).join(' — ')}
              {...(item.duration > 0 ? { meta: formatTime(item.duration) } : {})}
              onPlay={() => void api.queuePlay(zone.id, item.id)}
              onRemove={() => void api.queueRemove(zone.id, item.id)}
              qid={item.id}
              onGrip={ahead.length > 1 ? grip(item.id) : undefined}
              dragging={dragId === item.id}
              over={overId === item.id}
            />
          ))}
        </div>
      ) : (
        <button type="button" className="cx-qadd mono" onClick={onBrowse}>
          <PlusGlyph size={14} />
          {queue.items.length > 0 ? 'nothing after this one — add from music' : 'add from music'}
        </button>
      )}

      {at > 0 && (
        <details className="cx-qplayed">
          <summary className="cx-qsec cx-qsec-toggle">
            <span className="cx-qsec-lbl mono">played · {at}</span>
            <span className="cx-qsec-rule" aria-hidden="true" />
            <span className="cx-qsec-act mono">show</span>
          </summary>
          <div className="cx-rail-sec">
            {queue.items.slice(0, at).map((item, index) => (
              <Row
                key={item.id}
                cover={item.coverUrl}
                index={index + 1}
                numbered={numbered}
                title={entryTitleOf(item)}
                sub={numbered ? '' : [item.artist, item.album].filter(Boolean).join(' — ')}
                {...(item.duration > 0 ? { meta: formatTime(item.duration) } : {})}
                past
                onPlay={() => void api.queuePlay(zone.id, item.id)}
                onRemove={() => void api.queueRemove(zone.id, item.id)}
              />
            ))}
          </div>
        </details>
      )}

      {recents.length > 0 && (
        <>
          <Sec label="earlier" />
          <div className="cx-rail-sec cx-qearlier">
            {recents.slice(0, 8).map((item, index) => (
              <Row
                key={`${item.source}-${index}`}
                cover={item.coverUrl}
                title={item.title || item.album || item.source}
                sub={[item.artist, item.album].filter(Boolean).join(' — ')}
                onPlay={() => void api.play(zone.id, item.source)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
