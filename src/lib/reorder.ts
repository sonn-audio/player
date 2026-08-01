/**
 * Turning "put this row here" into the API's `{move, before}`.
 *
 * `PATCH /queue` is expressed as **insert-before**: `before` is the entry the moved one
 * should end up in front of, and omitting it means the end. That is a good primitive and a
 * bad fit for a UI, which thinks in destination *indices* — and converting between the two
 * has an off-by-one that only shows up when moving an item downwards.
 *
 * Moving up, the target index is already the entry to land in front of. Moving down, that
 * entry has shifted: removing the dragged row first pulls everything below it up by one, so
 * inserting before `items[to]` puts it back where it started. The anchor is `items[to + 1]`
 * — and when that is past the end, there is no anchor at all, which is the `undefined`
 * ("move to the end") case.
 *
 * Verified against 4.0.0-beta.17 on a three-entry queue: moving the last item before the
 * first, to the end, and one step down all landed where the UI asked.
 */

/**
 * The `before` argument that lands `from` at index `to`, or `undefined` for the end.
 *
 * Returns `null` when the move is a no-op or out of range, so a caller can skip the request
 * rather than sending one the server would answer 204 to having changed nothing.
 */
export function moveAnchor<T>(
  items: readonly T[],
  from: number,
  to: number,
  idOf: (item: T) => string,
): { before: string | undefined } | null {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return null;
  }
  // Moving up: land in front of whatever currently occupies the destination.
  if (to < from) {
    return { before: idOf(items[to]!) };
  }
  // Moving down: anchor on the entry *after* the destination, because removing this row
  // first shifts everything below it up by one. Past the end, there is nothing to anchor
  // on — which is exactly what "no before" means.
  const anchor = items[to + 1];
  return { before: anchor ? idOf(anchor) : undefined };
}
