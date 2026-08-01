/**
 * The bar across the top: the wordmark, where you are, and the way to the other player.
 *
 * It came back from the design after being removed, and the removal was the mistake: a rail that
 * carried the wordmark, the room picker, the search field, every destination *and* the way out of the
 * face was doing five jobs, and the first one it dropped was being legible. Moving the identity up here
 * leaves the rail with one job — where to go — which is why the tree below it now reads as a table of
 * contents instead of a wall.
 *
 * **Deliberately almost empty on the right.** Two things have been tried there and both went back:
 *
 *  - The room's volume. On screen in every view, which sounded right, and impractical in use: it is a
 *    metre away from the transport it belongs with, so adjusting the level meant crossing the window
 *    while looking at the player. It lives in the bar along the bottom, beside the buttons your hand is
 *    already on.
 *  - A settings menu. Two clicks to reach one item that mattered, which is a menu earning its keep by
 *    existing rather than by holding anything.
 *
 * What is left is the one thing that genuinely belongs to this *view*: whether the stream is up. The
 * switch to the other face used to live here and has moved to the shell (`shell/FaceSwitch`), where it is
 * drawn once for both players — a control about changing face should not itself change when you use it.
 */
import { useServer } from '@/state/ServerContext';
import { Icon, type IconName } from '@/components/Icon';
import { Brand } from '@/shell/Brand';

/** What the label says, and the glyph beside it. */
export type BarView = { label: string; icon: IconName };

export function AppBar({ view }: { view: BarView }) {
  const { status } = useServer();

  return (
    <header className="app-bar">
      {/* A hidden twin: the visible one is drawn by the shell, over both faces at once, so switching
          cannot make it hop or blink. This reserves its column. */}
      <span className="app-bar-brand">
        <Brand placeholder />
      </span>

      <span className="app-bar-view mono">
        <Icon name={view.icon} />
        {view.label}
      </span>

      <div className="app-bar-right">
        {/* Not connected is worth a word up here, where it explains why nothing responds. */}
        {status !== 'open' && (
          <span className="badge warn" title="Live updates are not arriving">
            {status === 'connecting' ? 'sync' : 'offline'}
          </span>
        )}

      </div>
    </header>
  );
}
