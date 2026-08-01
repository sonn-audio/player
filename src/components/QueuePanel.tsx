/**
 * The queue, with reordering.
 *
 * Every id here is an **entry** id, not a track id — the same track queued twice has two
 * of them — which is what makes "remove this one" and "move this one" unambiguous.
 *
 * Reordering is offered two ways on purpose: dragging, because that is what a queue wants,
 * and up/down buttons, because drag-and-drop is unusable by keyboard and awkward on touch.
 * Both go through `moveAnchor`, so the index-to-`before` conversion exists once.
 *
 * The list is rendered from local state while a drag is in flight (`draft`), which is the
 * one place this player does not render the server directly: the row has to follow the
 * pointer, and a round trip per hover would fight it. The draft is dropped the moment the
 * server answers.
 *
 * Refreshes come from `queue.changed`, so this panel is correct when *another* client edits the
 * queue too — a second tab, a wall panel, the Loxone app. No refresh-after-write needed.
 */
import { useEffect, useState } from 'react';
import { useApi, useServer } from '@/state/ServerContext';
import { useZoneCollection } from '@/state/useZoneCollection';
import { ItemCover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useAddFavorite } from '@/state/useAddFavorite';
import { entryTitleOf, formatTime } from '@/lib/format';
import { moveAnchor } from '@/lib/reorder';
import type { ApiQueue, ApiQueueItem, ApiZoneState } from '@/api/types';

/** One screenful and then some; `total` tells us whether there is more. */
const PAGE_SIZE = 100;

export function QueuePanel({ zone, zones }: { zone: ApiZoneState; zones: ApiZoneState[] }) {
  const api = useApi();
  const { api: client } = useServer();

  const queue = useZoneCollection<ApiQueue>(
    (zoneId) => client.getQueue(zoneId, 0, PAGE_SIZE),
    zone.id,
    'queue',
    // A local destination receives no events, so `queue.changed` never comes; what is playing
    // moving is the only signal available there. Harmless for a real zone, which also emits.
    [zone.state, zone.track?.title],
  );

  const favorites = useAddFavorite();

  /** Local order while dragging; null means "render the server's". */
  const [draft, setDraft] = useState<ApiQueueItem[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const served = queue.data?.items ?? [];
  const items = draft ?? served;
  const total = queue.data?.total ?? 0;
  const targets = zones.filter((candidate) => candidate.id !== zone.id);

  useEffect(() => {
    if (targetId !== null && !targets.some((candidate) => candidate.id === targetId)) {
      setTargetId(null);
    }
  }, [targetId, targets]);

  // A fresh read supersedes any draft — including one from a drag the user abandoned by
  // dropping outside the list.
  useEffect(() => {
    setDraft(null);
  }, [served]);

  /**
   * Fires a queue command. The resulting `queue.changed` is what re-reads the list, so this
   * does not chain a refresh — only a *failed* write needs one, to discard the optimistic
   * draft the server never accepted.
   */
  const act = (run: Promise<unknown>) => {
    void run.catch(() => queue.refresh());
  };

  const moveQueue = async () => {
    if (targetId === null || moving || total === 0) return;
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target) return;
    if (!window.confirm(`Move this queue to ${target.name}? Playback will continue there.`)) return;
    setMoving(true);
    setMoveError(null);
    try {
      await api.handoff(zone.id, target.id);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Could not move the queue');
    } finally {
      setMoving(false);
    }
  };

  /** Commits a move by index, or does nothing when it would not change the order. */
  const move = (from: number, to: number) => {
    const anchor = moveAnchor(items, from, to, (item) => item.id);
    if (!anchor) {
      setDraft(null);
      return;
    }
    const id = items[from]!.id;
    // Show the result immediately; `refresh` replaces it with the server's truth.
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    setDraft(next);
    act(api.queueMove(zone.id, id, anchor.before));
  };

  /** Reorders the draft as the pointer passes over a row, without touching the server. */
  const dragOver = (overId: string) => {
    if (!dragging || dragging === overId) {
      return;
    }
    const from = items.findIndex((item) => item.id === dragging);
    const to = items.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    setDraft(next);
  };

  /** On drop, ask the server for the position the draft ended up showing. */
  const drop = () => {
    if (!dragging || !draft) {
      setDragging(null);
      return;
    }
    const to = draft.findIndex((item) => item.id === dragging);
    const from = served.findIndex((item) => item.id === dragging);
    setDragging(null);
    if (to < 0 || from < 0 || from === to) {
      setDraft(null);
      return;
    }
    // Computed against the *served* order, since that is what the server is holding.
    const anchor = moveAnchor(served, from, to, (item) => item.id);
    if (!anchor) {
      setDraft(null);
      return;
    }
    act(api.queueMove(zone.id, dragging, anchor.before));
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>
          Queue {total > 0 && <span className="count">{total}</span>}
        </h2>
        {total > 0 && (
          <span className="panel-actions">
            {targets.length > 0 && (
              /*
                `data-armed` is the field's shape, not its state: the select gives up its right corners
                only once there is a button welded to that edge. Without it, a lone control sat there
                with one square end and read as half of something that had failed to render.
              */
              <span className="queue-transfer" data-armed={targetId !== null ? '' : undefined}>
                <select
                  aria-label="Move queue to player"
                  value={targetId ?? ''}
                  disabled={moving}
                  onChange={(event) => setTargetId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Move to…</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                {/*
                  Absent until a room is picked, rather than present and dead.
                  A disabled button beside its own select is the most common way a toolbar reads as
                  broken: there is nothing to press until you have answered "where to", and the select
                  is that question. It appears the moment you answer it.
                */}
                {targetId !== null && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={moving}
                    onClick={() => void moveQueue()}
                  >
                    {moving ? 'Moving…' : 'Move here'}
                  </button>
                )}
              </span>
            )}
            <button type="button" className="text-button" onClick={() => act(api.queueUndo(zone.id))}>
              Undo
            </button>
            <button type="button" className="text-button" onClick={() => act(api.queueClear(zone.id))}>
              Clear
            </button>
          </span>
        )}
      </header>

      {moveError && <p className="notice warn">Could not move queue: {moveError}</p>}

      {items.length === 0 ? (
        <p className="hint">
          {queue.loading ? 'Loading…' : 'Nothing queued. Play a favourite or a recent to start one.'}
        </p>
      ) : (
        <ol className="item-list queue-list" onDragOver={(event) => event.preventDefault()}>
          {items.map((item, index) => (
            <li
              key={item.id}
              data-current={index === queue.data?.currentIndex || undefined}
              data-dragging={item.id === dragging || undefined}
              draggable
              onDragStart={() => setDragging(item.id)}
              onDragEnter={() => dragOver(item.id)}
              onDragEnd={drop}
              onDrop={drop}
            >
              <span className="drag-handle" title="Drag to reorder" aria-hidden="true">
                <Icon name="grip" />
              </span>

              <button
                type="button"
                className="item-row"
                onClick={() => act(api.queuePlay(zone.id, item.id))}
                title="Play this entry"
              >
                <ItemCover url={item.coverUrl} className="tiny" />
                <span className="item-text">
                  <span className="item-title">{entryTitleOf(item)}</span>
                  <span className="item-sub">{item.artist}</span>
                </span>
                {item.duration > 0 && <span className="item-meta">{formatTime(item.duration)}</span>}
              </button>

              {/* Keyboard- and touch-reachable equivalents of the drag. */}
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                {/* `source` is the opaque provider id, so a queue entry can become a
                    favourite as readily as a browse row. */}
                <FavoriteButton
                  zone={zone}
                  uri={item.source}
                  name={item.title}
                  pending={favorites.pending === item.source}
                  saved={favorites.saved === item.source}
                  onAdd={favorites.add}
                />
                <button
                  type="button"
                  className="icon-button small ghost"
                  title="Remove from queue"
                  onClick={() => act(api.queueRemove(zone.id, item.id))}
                >
                  <Icon name="close" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {total > items.length && (
        <p className="hint small">
          Showing {items.length} of {total}. Reordering works within what is loaded.
        </p>
      )}

      {/*
        The end of the list, said out loud.
        A one-track queue leaves most of this column empty, and empty space at the bottom of a page
        reads as something that has not finished loading. One quiet line turns it into an answer: this
        is all of it, and here is how to add to it.
      */}
      {items.length > 0 && total === items.length && (
        <p className="queue-end">
          End of queue — pick a favourite, a recent or anything in the catalogue to add to it.
        </p>
      )}
    </section>
  );
}
