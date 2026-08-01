/**
 * The queue, as a lane down the right-hand edge.
 *
 * Two states of one column, and the folded one is the whole idea:
 *
 *  - **Folded — 96px.** Not a list. A *receding stack*: one sleeve behind, six ahead, each one further
 *    out pushed slightly right, scaled down, desaturated and dimmed, so the queue visibly falls away
 *    into the dark. Everything past the sixth collapses to nothing. One word, turned on its side, says
 *    what the stack is. It answers *is there more, and what does it look like* from across a room, which
 *    is the only question a queue gets asked while music is playing.
 *  - **Open — up to 240px.** All of that resets: every row square, upright, full colour, with its title,
 *    its duration and a way to remove it. Rows arrive staggered, nearest first.
 *
 * That is what lets a queue be permanent here. An earlier pass moved it into a sheet instead, on the
 * grounds that a column faded to 62% to be tolerable is a column that should not exist — right about the
 * fading, wrong about the removing. As a stack of six sleeves it needs no fading, because it is not
 * competing with the title beside it; it is a margin with pictures in it.
 *
 * **Three ways in, one per machine.** A pointer opens it by arriving — no delay, because the lane is
 * against the window's edge and cannot be crossed on the way to something else. A finger presses the
 * grip, and it stays until pressed again or for seven seconds. A keyboard tabs to the grip. The rules for
 * that are in `useEdges`, because they are rules about this lane *and* the dock along the bottom.
 */
import { itemCoverCss } from '@/art/cover';
import { useApi } from '@/state/ServerContext';
import { CloseGlyph, ChevronGlyph } from '@/art/glyphs';
import { entryTitleOf, formatTime } from '@/lib/format';
import type { ApiQueue, ApiQueueItem, ApiZoneState } from '@/api/types';

/** How many played tracks the folded stack keeps. One — enough to say there is a behind. */
const FOLDED_BEHIND = 1;

/** How many upcoming tracks it shows. Six, and the rest collapse to nothing. */
const FOLDED_AHEAD = 6;

/**
 * How a row looks at distance `d` from what is playing, while the lane is folded.
 *
 * Every number here is doing the same job: making distance *visible*, so the stack reads as depth rather
 * than as a list that happens to be short. Further out is further right, smaller, greyer and darker — and
 * past the cut, gone. Written as arithmetic rather than as six hand-tuned rules because it has to hold for
 * a queue of four and a queue of four hundred.
 */
function folded(d: number, played: boolean): React.CSSProperties {
  const show = played ? d <= FOLDED_BEHIND : d <= FOLDED_AHEAD;
  const delay = `${(Math.min(d, 8) * 0.05).toFixed(3)}s`;

  if (!show) {
    return { maxHeight: 0, padding: '0 6px', opacity: 0, transform: 'scale(.7)', transitionDelay: delay };
  }
  return {
    maxHeight: '64px',
    padding: '5px 6px',
    opacity: played ? 0.55 : 1,
    transform: `translateX(${Math.min(6, d * 1.2).toFixed(1)}px) scale(${Math.max(0.82, 1 - d * 0.04).toFixed(3)})`,
    filter: played
      ? 'grayscale(.85) brightness(.65)'
      : `grayscale(${Math.min(0.7, (d - 1) * 0.2).toFixed(2)}) brightness(${Math.max(0.5, 1.05 - d * 0.12).toFixed(2)})`,
    transitionDelay: delay,
  };
}

/** How the same row looks once the lane is open: itself, arriving in order. */
function unfolded(d: number, played: boolean): React.CSSProperties {
  return {
    maxHeight: '64px',
    padding: '5px 6px',
    opacity: played ? 0.5 : 1,
    transform: 'none',
    filter: 'none',
    transitionDelay: `${(Math.min(d, 8) * 0.06).toFixed(3)}s`,
  };
}

export function Lane({
  zone,
  queue,
  open,
  onOpen,
  onClose,
  onToggle,
  /** True when the device has no hover to give — the grip appears and the pointer handlers do not. */
  touch,
}: {
  zone: ApiZoneState;
  queue: ApiQueue;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  touch: boolean;
}) {
  const api = useApi();
  const current = queue.currentIndex;

  /*
   * An empty queue still occupies its 96px.
   *
   * The queue arrives a couple of hundred milliseconds after this screen does, so a lane that unmounts
   * itself when empty is a lane that appears late — and the whole composition slides 48px left when it
   * does. (It also broke the sleeve's flight between the two faces, which measures where the sleeve is
   * about to land and got an answer from before the shift.) Whether there *can* be a queue is known on
   * the first frame; whether there *is* one is not, so the shell is drawn either way and only its
   * contents wait.
   */
  const empty = queue.items.length === 0;

  /*
   * Split at what is playing, and keep the distance.
   *
   * `d` is how many tracks away from now — counting backwards through what has played and forwards
   * through what has not — and it is the only input the look of a row has while folded.
   */
  const behind = current === null ? [] : queue.items.slice(0, current).map((item, index) => ({
    item,
    d: current - index,
    played: true,
  }));
  const ahead = (current === null ? queue.items : queue.items.slice(current)).map((item, index) => ({
    item,
    d: index,
    played: false,
  }));

  return (
    <aside
      className="cx-lane"
      data-open={open || undefined}
      {...(touch
        ? {}
        : {
            onPointerEnter: (event: React.PointerEvent) => event.pointerType === 'mouse' && onOpen(),
            onPointerLeave: (event: React.PointerEvent) => event.pointerType === 'mouse' && onClose(),
          })}
    >
      <span className="cx-lane-edge" aria-hidden="true" />

      {/* Touch only: hover is a pointer's privilege and this face lives on wall panels. */}
      {touch && (
        <button
          type="button"
          className="cx-lane-grip"
          aria-label={open ? 'Hide the queue' : 'Show the queue'}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="cx-lane-grip-bar">
            <ChevronGlyph size={12} />
          </span>
        </button>
      )}

      <div className="cx-lane-body">
        {/* The heading exists twice: as a word when there is room for it, and turned on its side when
            there is not. Only ever one of them is drawn — and neither, until there is a queue to head. */}
        {!empty && (
          <>
            <span className="cx-lane-head mono">next</span>
            <span className="cx-lane-head-vert" aria-hidden={open}>
              <span className="mono">next</span>
            </span>
          </>
        )}

        {[...behind, ...ahead].map(({ item, d, played }, index) => (
          <Row
            key={item.id}
            item={item}
            size={played ? 'past' : index === behind.length && current !== null ? 'current' : 'next'}
            open={open}
            style={open ? unfolded(d, played) : folded(d, played)}
            onPlay={() => void api.queuePlay(zone.id, item.id)}
            onRemove={() => void api.queueRemove(zone.id, item.id)}
          />
        ))}
      </div>
    </aside>
  );
}

/**
 * One entry.
 *
 * The sleeve *is* the row when the lane is folded and a thumbnail beside a title when it is open, which is
 * why its size is keyed off both its place in the queue and the lane's state (see `art.css`). Everything
 * that is words has zero width until there is width to give it.
 */
function Row({
  item,
  size,
  open,
  style,
  onPlay,
  onRemove,
}: {
  item: ApiQueueItem;
  /** Where it sits relative to what is playing — the folded lane says this with size alone. */
  size: 'past' | 'current' | 'next';
  open: boolean;
  /** The per-distance transform, filter and height. Computed, not classed — see `folded`. */
  style: React.CSSProperties;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const sub = [item.artist, item.album].filter(Boolean).join(' — ');

  return (
    <div className="cx-lrow" data-size={size} style={style}>
      <button
        type="button"
        className="cx-lrow-main"
        onClick={onPlay}
        tabIndex={open ? undefined : -1}
        title={item.title}
      >
        <span className="cx-lrow-cov" style={{ backgroundImage: itemCoverCss(item.coverUrl) }} />
        <span className="cx-lrow-meta">
          <span className="cx-lrow-title">{entryTitleOf(item)}</span>
          {sub && <span className="cx-lrow-sub">{sub}</span>}
        </span>
      </button>

      {item.duration > 0 && <span className="cx-lrow-dur mono">{formatTime(item.duration)}</span>}

      <button
        type="button"
        className="cx-lrow-rm"
        onClick={onRemove}
        tabIndex={open ? undefined : -1}
        aria-label="Remove from queue"
      >
        <CloseGlyph size={12} />
      </button>
    </div>
  );
}
