/**
 * "Put sonn on your home screen", once, quietly, on the screen you open the app onto.
 *
 * A hint rather than a banner: it sits in the flow of home instead of over it, it says what the
 * install actually buys ("no address bar, opens like an app"), and pressing the cross means never
 * again on this browser. Nothing here nags — a house appliance that begs to be installed is a
 * website pretending.
 *
 * On iOS there is no install API, so the sentence names the two taps instead of offering a button
 * that could not work. That is the whole difference between the two platforms here.
 */
import { Mark } from '@/components/Mark';
import { CloseGlyph, ForwardGlyph } from '@/art/glyphs';
import { useInstall } from '@/shell/useInstall';

export function InstallHint() {
  const install = useInstall();

  if (!install.offer) {
    return null;
  }

  return (
    <div className="cx-install">
      <Mark className="cx-install-mark" />

      <span className="cx-install-text">
        <span className="cx-install-title">Put sonn on your home screen</span>
        <span className="cx-install-sub">
          {install.manual
            ? 'Share, then “Add to Home Screen” — it opens like an app, with no address bar.'
            : 'Opens like an app, with no address bar.'}
        </span>
      </span>

      {!install.manual && (
        <button type="button" className="mono cx-install-go" onClick={install.install}>
          add
          <ForwardGlyph size={13} />
        </button>
      )}

      <button
        type="button"
        className="cx-install-close"
        onClick={install.dismiss}
        aria-label="Not now"
      >
        <CloseGlyph size={13} />
      </button>
    </div>
  );
}
