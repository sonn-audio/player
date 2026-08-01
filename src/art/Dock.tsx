/**
 * The house along the bottom, folded to its names.
 *
 * One object, two states, and the folded one is almost nothing:
 *
 *  - **Folded.** The room names, at 55% — `WOONKAMER  KEUKEN │ KANTOOR  SLAAPKAMER  BADKAMER`. The group
 *    that is playing together reads as one enclosure; a room with music is legible, a quiet one recedes.
 *    No faders, no sleeves. It is a *caption* on the house, and it costs 58px.
 *  - **Unfolded.** The fader grows out of the name (0 → 100px) and the sleeve chip grows under it
 *    (0 → 70px, scaling from 0.6). This is the mixing desk, and it appears because you reached for it.
 *
 * An earlier pass folded this to sleeve-chips-plus-names instead, which was still a strip of artwork along
 * the bottom of a screen whose subject is one piece of artwork in the middle. Names carry the same
 * information — which rooms, which are playing, which are grouped — and carry none of the pictures.
 *
 * Opening and closing is not this component's business: it is half of a pair (see `useEdges`), because the
 * rules are about the pair — one at a time on touch, seven seconds, and everything folds when the screen
 * dims.
 */
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import { useVolumeControl } from '@/art/volume';
import { ChevronGlyph } from '@/art/glyphs';
import type { Channel } from '@/art/useCur';
import type { ApiZoneState } from '@/api/types';

export function Dock({
  channels,
  currentLeaderId,
  onSelect,
  open,
  onEnter,
  onLeave,
  onToggle,
  touch,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
  open: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onToggle: () => void;
  touch: boolean;
}) {
  if (channels.length === 0) {
    return null;
  }

  return (
    <div
      className="cx-dock"
      data-open={open || undefined}
      {...(touch
        ? {}
        : {
            onPointerEnter: (event: React.PointerEvent) => event.pointerType === 'mouse' && onEnter(),
            onPointerLeave: (event: React.PointerEvent) => event.pointerType === 'mouse' && onLeave(),
          })}
    >
      {touch && (
        <button
          type="button"
          className="cx-dock-grip"
          aria-label={open ? 'Hide room levels' : 'Show room levels'}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="cx-dock-grip-bar">
            <ChevronGlyph size={12} />
          </span>
        </button>
      )}

      <div className="cx-strip">
        {channels.map((channel) => (
          <div
            className={channel.members.length > 1 ? 'cx-ch-group' : 'cx-ch-solo'}
            key={channel.leader.id}
          >
            {channel.members.map((member) => (
              <Cell
                key={member.id}
                zone={member}
                channel={channel}
                current={channel.leader.id === currentLeaderId}
                onSelect={() => onSelect(member.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One room: a name always, a fader and a sleeve when the dock is open.
 *
 * The name is the cell's floor and it never moves: the sleeve grows out of the top of it and the fader out
 * of the top of that, both from zero height, so unfolding reads as a room's controls rising out of a label
 * that was already there. Putting the name last in the source is what makes that true — with the chip
 * below it, unfolding pushed the name up and off the bottom of the bar.
 *
 * Nothing needs hiding from the keyboard when the dock is folded: the fader is a `span` that listens for a
 * pointer and the chip is decorative, so the name — which is drawn in both states — is the only tab stop
 * either way.
 */
function Cell({
  zone,
  channel,
  current,
  onSelect,
}: {
  zone: ApiZoneState;
  channel: Channel;
  current: boolean;
  onSelect: () => void;
}) {
  const api = useApi();
  const control = useVolumeControl(zone);
  const playing = channel.playing && channel.hasTrack;
  /** Playing → paused → silent, which is what the cell's weight is keyed off. */
  const activity = playing ? 'playing' : channel.hasTrack ? 'paused' : 'silent';

  const leaderIsThis = channel.leader.id === zone.id;
  const cover = zoneCoverCss(api, channel.leader, 160);
  const progress =
    channel.leader.duration > 0
      ? Math.min(1, Math.max(0, channel.leader.position / channel.leader.duration))
      : 0;

  return (
    <div className="cx-ch" data-current={current || undefined} data-activity={activity}>
      <span className="cx-fader" onPointerDown={control.onPointerDownV}>
        <span className="cx-fader-ro mono" data-show={control.active || undefined}>
          {control.value}
        </span>
        <span className="cx-fader-track">
          <span className="cx-fader-fill" style={{ height: control.pct }}>
            {/* The shimmer at the top of a playing fill — a VU flicker, not a spinner. It exists only
                while audio is actually flowing, so a still strip means a quiet house. */}
            {playing && <span className="cx-fader-vu" />}
            <span className="cx-fader-cap" />
          </span>
        </span>
      </span>

      {/* Only the leader carries the sleeve: a follower is playing the same thing, and three copies of one
          cover reads as three rooms playing three different tracks. */}
      <span className="cx-ch-chip-wrap" aria-hidden="true">
        {leaderIsThis && cover ? (
          <span className="cx-ch-chip" style={{ backgroundImage: cover }}>
            {progress > 0 && (
              <span className="cx-ch-prog">
                <i style={{ width: `${progress * 100}%` }} />
              </span>
            )}
          </span>
        ) : (
          <span className="cx-ch-chip cx-ch-chip-empty" />
        )}
      </span>

      <button type="button" className="cx-ch-name mono" onClick={onSelect} title={zone.name}>
        {zone.name}
        {playing && <span className="cx-ch-dot" />}
      </button>
    </div>
  );
}
