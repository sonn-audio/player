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
import { useApi } from '@/state/ServerContext';
import { itemCoverCss } from '@/art/cover';
import { Bars, CloseGlyph } from '@/art/glyphs';
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
}) {
  return (
    <div
      className="cx-qrow"
      data-current={current || undefined}
      data-past={past || undefined}
      data-numbered={numbered || undefined}
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

export function QueueList({ zone, queue }: { zone: ApiZoneState; queue: ApiQueue }) {
  const api = useApi();

  if (queue.items.length === 0) {
    return <p className="cx-rail-empty">Nothing queued. Play an album and it shows up here.</p>;
  }

  const numbered = oneRecord(queue.items);

  return (
    <div className="cx-rail-sec">
      {/* One line naming the record, since the rows no longer repeat it fourteen times. */}
      {numbered && (queue.items[0]!.album || queue.items[0]!.artist) && (
        <p className="cx-qrun mono">
          {[queue.items[0]!.album, queue.items[0]!.artist].filter(Boolean).join(' · ')}
        </p>
      )}

      {queue.items.map((item, index) => (
        <Row
          key={item.id}
          cover={item.coverUrl}
          index={index + 1}
          numbered={numbered}
          title={entryTitleOf(item)}
          // On a single record the artist and album are the heading above the list, so repeating them
          // under every title is the same duplication the thumbnails were.
          sub={numbered ? '' : [item.artist, item.album].filter(Boolean).join(' — ')}
          {...(item.duration > 0 ? { meta: formatTime(item.duration) } : {})}
          current={queue.currentIndex === index}
          past={queue.currentIndex !== null && index < queue.currentIndex}
          onPlay={() => void api.queuePlay(zone.id, item.id)}
          onRemove={() => void api.queueRemove(zone.id, item.id)}
        />
      ))}
    </div>
  );
}

export function RecentsList({ zone, recents }: { zone: ApiZoneState; recents: ApiRecentItem[] }) {
  const api = useApi();

  if (recents.length === 0) {
    return <p className="cx-rail-empty">Nothing played here yet.</p>;
  }

  return (
    <div className="cx-rail-sec">
      {recents.map((item, index) => (
        <Row
          // `source` is the opaque id and the only stable handle a recent has; the index breaks the
          // tie for the rare duplicate.
          key={`${item.source}-${index}`}
          cover={item.coverUrl}
          title={item.title || item.album || item.source}
          sub={[item.artist, item.album].filter(Boolean).join(' — ')}
          onPlay={() => void api.play(zone.id, item.source)}
        />
      ))}
    </div>
  );
}

export type QueueTab = 'queue' | 'recents';

/**
 * The two tabs, for the sheet's head to carry.
 *
 * They used to be a second header row under the first, which put two bands of chrome above a list of
 * twelve things. Now they sit on the far side of the head's rule, and the head's own title is the room
 * the queue belongs to — which is the fact the old two-row arrangement never actually stated.
 *
 * The queue tab is absent for a source that has no queue — a station, a line-in — because a queue
 * reading "1 of 1" for a stream that has been playing for six hours is worse than no tab. Recents is
 * always there, since a room that has played anything has recents.
 */
export function QueueTabs({
  hasQueue,
  active,
  total,
  onPick,
}: {
  hasQueue: boolean;
  active: QueueTab;
  total: number;
  onPick: (tab: QueueTab) => void;
}) {
  if (!hasQueue) {
    return <span className="cx-sheet-tabs mono cx-sheet-tab-static">recent</span>;
  }
  return (
    <div className="cx-sheet-tabs mono">
      <button type="button" data-on={active === 'queue' || undefined} onClick={() => onPick('queue')}>
        next{total > 0 ? ` ${total}` : ''}
      </button>
      <button type="button" data-on={active === 'recents' || undefined} onClick={() => onPick('recents')}>
        recent
      </button>
    </div>
  );
}

/**
 * The sheet's body: what is coming, or what has been.
 *
 * One list shape, two sources. This stayed a component rather than two calls at the sheet's site because
 * dropping the permanent rail nearly took recents with it — the rail's second tab was the only way to
 * them on a desk, outside the quiet-house welcome screen — and keeping the pair together is what keeps
 * that capability from being lost again.
 */
export function QueueSheet({
  zone,
  queue,
  recents,
  tab,
}: {
  zone: ApiZoneState;
  queue: ApiQueue;
  recents: ApiRecentItem[];
  tab: QueueTab;
}) {
  return tab === 'queue' ? (
    <QueueList zone={zone} queue={queue} />
  ) : (
    <RecentsList zone={zone} recents={recents} />
  );
}
