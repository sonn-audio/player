/**
 * Picking a room up.
 *
 * The wall made every room an object on the screen, and an object you can see is an object you expect to
 * be able to move. Two gestures come out of that, and they are the two things this product does that a
 * single-room player cannot:
 *
 *  - **Drag the sleeve onto another room** — the music moves there (`handoff`).
 *  - **Drag a room onto the one you are in** — they play together (`setGroup`).
 *
 * Both were already possible and both were a *list with checkboxes* called Grouping, which is a form for
 * something physical. Neither needs anything from the server that is not already in the contract.
 *
 * **Pointer events, not HTML5 drag-and-drop.** DnD hands you a browser-drawn drag image you cannot style,
 * fires no useful events on touch, and cancels on a stray keypress. What this face wants is a sleeve
 * following the cursor at a tilt, so the drag is drawn like everything else here.
 *
 * **The threshold is what protects the click.** The sleeve is also the play button and a sliver is also
 * the room switch; below `THRESHOLD_PX` of travel nothing has been dragged and the press stays a press.
 * Past it the gesture commits and `consumed()` tells the click handler to stand down for exactly one
 * event — a `pointerup` that ended a drag still produces a `click`, and without this every handoff would
 * also pause the music it just moved.
 *
 * **Targets are found by hit-testing, not by measuring.** `elementFromPoint` reads the `data-room-drop`
 * the wall already puts on its panels, so nothing has to register a rectangle, keep it in step with a
 * `flex-grow` animation, or be told when the house changes.
 */
import { useCallback, useRef, useState } from 'react';

/** How far a pointer travels before a press becomes a drag. */
const THRESHOLD_PX = 9;

export type DragKind = 'record' | 'room';

export type DragPayload = {
  kind: DragKind;
  /** The zone the gesture is about: the room being emptied, or the room being brought in. */
  zoneId: number;
  /** `url("…")` for the sleeve that follows the pointer, when that room has one. */
  cover: string | undefined;
  name: string;
};

/** Where a drag can land: the wall's big panel, or one of its slivers. */
export type DropKind = 'room' | 'wall';

export type RoomDrag = {
  /** What is in the hand right now, with the pointer's position — null when nothing is. */
  active: (DragPayload & { x: number; y: number }) | null;
  /** The zone id under the pointer, when it is a legal target for what is being dragged. */
  over: number | null;
  /** Begin a possible drag. Safe to call on every pointer-down: below the threshold nothing happens. */
  begin: (payload: DragPayload, event: React.PointerEvent) => void;
  /** True for the one click that follows a completed drag, which must be ignored. */
  consumed: () => boolean;
};

function targetAt(x: number, y: number): { zoneId: number; kind: DropKind } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-room-drop]');
  if (!element) {
    return null;
  }
  const zoneId = Number(element.dataset.roomDrop);
  const kind = element.dataset.roomDropKind === 'wall' ? 'wall' : 'room';
  return Number.isFinite(zoneId) ? { zoneId, kind } : null;
}

/** Whether this payload may land here — a record goes to another room, a room joins the wall. */
function legal(payload: DragPayload, target: { zoneId: number; kind: DropKind }): boolean {
  if (target.zoneId === payload.zoneId) {
    return false;
  }
  return payload.kind === 'record' ? target.kind === 'room' : target.kind === 'wall';
}

export function useRoomDrag(
  onDrop: (payload: DragPayload, target: { zoneId: number; kind: DropKind }) => void,
): RoomDrag {
  const [active, setActive] = useState<(DragPayload & { x: number; y: number }) | null>(null);
  const [over, setOver] = useState<number | null>(null);
  /* Set on the pointer-up that ended a drag, and read once by the click that follows it. */
  const swallow = useRef(false);

  const begin = useCallback(
    (payload: DragPayload, event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      /*
       * A press that might become a drag must not also start a text selection.
       *
       * Without this the pointer dragged a blue selection across every word it passed on the way to the
       * target — the panel read as a document being highlighted rather than a record being carried. It
       * costs the source element its focus-on-click, which nothing here depends on: the click still
       * fires, and keyboard users reach these controls by tabbing to them.
       */
      event.preventDefault();
      const from = { x: event.clientX, y: event.clientY };
      let dragging = false;

      const move = (moveEvent: PointerEvent): void => {
        const travelled =
          Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y);
        if (!dragging && travelled < THRESHOLD_PX) {
          return;
        }
        dragging = true;
        setActive({ ...payload, x: moveEvent.clientX, y: moveEvent.clientY });
        const target = targetAt(moveEvent.clientX, moveEvent.clientY);
        setOver(target && legal(payload, target) ? target.zoneId : null);
      };

      const end = (upEvent: PointerEvent): void => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        setActive(null);
        setOver(null);
        if (!dragging) {
          return;
        }
        /* The press has already become something else; whatever it was pressing must not also fire. */
        swallow.current = true;
        const target = targetAt(upEvent.clientX, upEvent.clientY);
        if (target && legal(payload, target)) {
          onDrop(payload, target);
        }
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
    },
    [onDrop],
  );

  const consumed = useCallback((): boolean => {
    if (!swallow.current) {
      return false;
    }
    swallow.current = false;
    return true;
  }, []);

  return { active, over, begin, consumed };
}
