/**
 * The corner that leads out of the player: **admin**.
 *
 * It used to hold two doors — the other face and the console — and the argument for it being part of
 * the frame rather than of a face was that a control *about* switching face must not blink and change
 * shape under the cursor that just pressed it. There is one face now, so the switch is gone and what
 * is left is the door that was always a real navigation: an `<a href>`, so the browser performs it and
 * `@view-transition` can carry the mark across (see `shell.css`).
 *
 * A bare label rather than a box, because it sits over artwork: the art player boxes nothing, and a
 * control that has to live on a photograph can only be the quiet kind.
 */
export function AdminLink() {
  return (
    <div className="admin-link mono">
      <a className="admin-link-go" href="/admin/" title="Set the house up">
        admin
      </a>
    </div>
  );
}
