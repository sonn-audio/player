/**
 * The house, as a wall of records.
 *
 * This is the shell of the desk player, and it replaces both the thing it grew out of and the strip
 * along the bottom that used to stand for the house.
 *
 * **What was wrong with what it replaces.** The old home was a sleeve on the left, a column of type on
 * the right, and the other rooms reduced to a line of 10px words at the bottom edge — which is the
 * skeleton Spotify, Apple Music and every web player share. You can refine that until it is the most
 * tasteful version of it, and it will still be a version of it. And it says the wrong thing about this
 * product: a multiroom server's subject is *the house*, and the house was the least visible object on
 * the screen.
 *
 * **What this is instead.** Every room is a panel in one row, in the house's own order. The room you are
 * listening in is the whole width of the window; every other room is a sliver of its own artwork, 76px
 * wide, standing at its own place in the row like a record pulled halfway out of a shelf. Choosing
 * another room widens it and narrows this one — the wall slides, and the artwork you were looking at
 * becomes one of the spines.
 *
 * So the house is never a menu you open. It is on screen, made of the pictures of what is playing in it,
 * and it costs 76px per room rather than a page called Grouping.
 *
 * A house with one room is this component drawing one panel, which is the old screen exactly. Nothing
 * special-cases it.
 */
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import { useVolumeControl } from '@/art/volume';
import type { Channel } from '@/art/useCur';

export function Wall({
  channels,
  currentLeaderId,
  onSelect,
  children,
}: {
  channels: Channel[];
  /** The room whose panel is the wall. */
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
  /** What the current room's panel holds — the stage. */
  children: React.ReactNode;
}) {
  return (
    <div className="cx-wall">
      {channels.map((channel) =>
        channel.leader.id === currentLeaderId ? (
          <div className="cx-wall-room" key={channel.leader.id}>
            {children}
          </div>
        ) : (
          <Sliver key={channel.leader.id} channel={channel} onSelect={onSelect} />
        ),
      )}
    </div>
  );
}

/**
 * One room, seen edge-on.
 *
 * The artwork is cropped to a vertical band and dimmed hard — recognisable as *that* record from across
 * the room without ever competing with the one being played. A room with nothing on is a dark panel with
 * its name in it, which is what a closed door looks like and is the honest drawing of a silent room.
 *
 * Two targets, not one. The button is the whole panel and it selects; the fader is a rail on the inner
 * edge that appears under the pointer and takes its own pointer events. Overlapping a drag and a click on
 * one element is how a mixing desk becomes a lottery, so they are separate elements — the same split the
 * dock made between a name you press and a fader you pull.
 */
function Sliver({ channel, onSelect }: { channel: Channel; onSelect: (zoneId: number) => void }) {
  const api = useApi();
  const control = useVolumeControl(channel.leader);
  const playing = channel.playing && channel.hasTrack;
  const activity = playing ? 'playing' : channel.hasTrack ? 'paused' : 'silent';
  const cover = zoneCoverCss(api, channel.leader, 320);

  return (
    <div className="cx-sliver" data-activity={activity}>
      {cover && <span className="cx-sliver-art" style={{ backgroundImage: cover }} aria-hidden="true" />}
      <span className="cx-sliver-veil" aria-hidden="true" />

      <button
        type="button"
        className="cx-sliver-hit"
        onClick={() => onSelect(channel.leader.id)}
        title={
          channel.hasTrack
            ? `${channel.leader.name} — ${channel.leader.track?.title ?? ''}`
            : channel.leader.name
        }
      >
        <span className="cx-sliver-name mono">{channel.leader.name}</span>
      </button>

      {/* Playing rooms carry a light at the foot of the panel. Nothing else marks them: a room with a
          picture in it and a light under it is already saying it. */}
      {playing && <span className="cx-sliver-lit" aria-hidden="true" />}

      <span
        className="cx-sliver-fader"
        onPointerDown={control.onPointerDownV}
        role="presentation"
        aria-hidden="true"
      >
        <span className="cx-sliver-fader-fill" style={{ height: control.pct }} />
        <span className="cx-sliver-fader-ro mono" data-show={control.active || undefined}>
          {control.value}
        </span>
      </span>
    </div>
  );
}
