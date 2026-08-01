/**
 * The right-hand rail: what is happening to the audio on its way out of this room.
 *
 * One thing, which is the point. It carried a list of the other rooms too — their volumes, a + to pull
 * one into the group, a button to open grouping — and every part of that now exists on the grouping
 * screen, side by side with the delay that lines them up. Two places to change one membership is one
 * too many, and the rail was the worse of the two: a column too narrow to compare rooms in, next to a
 * signal path it kept pushing down.
 *
 * A **card**, unlike the rest of the player, and that is the design's call rather than a lapse: the
 * rail is an instrument and a boxed instrument reads as a unit you take in at a glance. The fill is a
 * white tint (`--well`) with a hairline, so it sits *with* the artwork wash instead of punching a hole
 * in it.
 */
import { SignalPath } from '@/components/SignalPath';
import { Icon } from '@/components/Icon';
import type { ApiZoneState } from '@/api/types';

/**
 * What is happening to the audio on its way out of this room.
 *
 * The card used to lead with the device — name, glyph, room underneath. It was removed on purpose:
 * you reach this rail from a player you already picked, the app bar names it, and the destination is
 * the last line of the signal path anyway. Restating it above the path made the card look like two
 * cards and pushed the one thing worth reading below the fold.
 *
 * What the header did carry that the path cannot is *absence*: a zone with no output configured, or
 * one whose device is not reachable. Both are real states with a real consequence — pressing play
 * does nothing — so they stay, as the only line the card shows in that case.
 */
function OutputCard({ zone }: { zone: ApiZoneState }) {
  const output = zone.output;
  const reachable = output?.device?.connected !== false;

  if (!output || !reachable) {
    return (
      <section className="rail-card">
        <p className="rail-card-warn">
          <Icon name="speaker" />
          {output ? 'Output not connected' : 'No output configured'}
        </p>
      </section>
    );
  }

  return (
    <section className="rail-card">
      <SignalPath zone={zone} />
    </section>
  );
}

export function ZoneRail({ zone }: { zone: ApiZoneState }) {
  return (
    <aside className="rail">
      <h2 className="rail-head">Signal path</h2>
      <OutputCard zone={zone} />
    </aside>
  );
}
