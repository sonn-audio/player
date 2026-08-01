/**
 * The bar along the bottom: what is playing, and the controls for it, from anywhere.
 *
 * This is the piece that makes browsing and playing one screen instead of two. While you are
 * three levels into an album list, the bar is what tells you the room is still playing and lets
 * you pause it without navigating away — so `NowPlayingView` becomes somewhere you go to see the
 * artwork and the queue rather than somewhere you must go to press pause.
 *
 * It renders the zone, not a copy of it: transport, progress and volume are the same components
 * the main view uses, so there is no second source of truth to drift. `Transport` and `Volume`
 * each own their own optimistic-gesture handling, which is why a slider dragged here does not
 * fight the `zone.changed` that follows.
 *
 * Clicking the track opens the now-playing view, which is the one bit of navigation the bar owns.
 */
import { Cover } from '@/components/Cover';
import { Transport } from '@/components/Transport';
import { Volume } from '@/components/Volume';
import { ProgressBar } from '@/components/ProgressBar';
import { StreamFormat } from '@/components/StreamFormat';
import { subtitleOf } from '@/lib/format';
import { useCoverAnchor } from '@/shell/coverMorph';
import type { ApiZoneState } from '@/api/types';

export function NowBar({ zone, onOpen }: { zone: ApiZoneState; onOpen: () => void }) {
  const track = zone.track;
  /*
   * This 44px thumbnail is the sleeve on screen while you are browsing, so it is the one that flies when
   * the face switches from here — a thumbnail opening into a half-window sleeve is the same object
   * moving, which is the point. It can only ever be a *source*: the bar is absent on the now-playing
   * view, which is where a switch into this face always lands.
   */
  const coverAnchor = useCoverAnchor();

  return (
    <footer className="now-bar">
      {/* `track === null` is the whole idle check, per the contract — not three empty strings. */}
      <button
        type="button"
        className="now-bar-track"
        onClick={onOpen}
        title="Open now playing"
        // Nothing to open when nothing is loaded, and a dead button that looks alive is worse
        // than a disabled one.
        disabled={!track}
      >
        <Cover zone={zone} size={96} className="now-bar-cover" anchor={coverAnchor} />
        <span className="now-bar-text">
          <span className="now-bar-title">{track?.title || 'Nothing playing'}</span>
          <span className="now-bar-sub">{subtitleOf(track) || zone.name}</span>
          {/* One line here: the full block belongs in the view, not in a 64px bar. */}
          <StreamFormat format={zone.format} compact />
        </span>
      </button>

      <div className="now-bar-controls">
        <Transport zone={zone} />
        <ProgressBar zone={zone} />
      </div>

      {/*
        The room's volume, beside the transport rather than in the bar at the top.

        It was up there for a while because that is where the design puts it, and in use it was a metre
        from the buttons it belongs with — you crossed the window to change the level while looking at
        the player. Here it is the same reach as pause, on screen in every view, and still the only one
        in the player: the now-playing block does not draw a second.
      */}
      <div className="now-bar-right">
        <Volume zone={zone} compact percent />
      </div>
    </footer>
  );
}
