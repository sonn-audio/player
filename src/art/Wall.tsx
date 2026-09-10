/**
 * The wall: the room you are in, with the rest of the house along the foot of it.
 *
 * The house used to stand *either side* of the room — one narrow panel per other room, each with its
 * sleeve, its name written up the spine and a fader you could find by hovering. It was a good idea
 * about a gallery and a poor one about a screen: a 1440px window gave the record 40% of its width and
 * spent 150px on two vertical words nobody read, and the resting state ("house") already *is* that
 * gallery, done properly, one press away.
 *
 * So the house is a strip now. Every room in one row along the bottom — a small sleeve, the name, what
 * is on — with the room you are in marked and the others one press away. It keeps the two gestures the
 * slivers carried (drag the record onto a room to send it there; drag a room onto the stage to group)
 * because those are about the *rooms*, not about where they were drawn. What it drops is the fader,
 * which belongs to the desk (`Channels`) and to the stage's own row, and was the one thing on a sliver
 * that needed a hover to be found.
 *
 * The strip is drawn under the stage and under the quiet-house screen — the two states where the room's
 * panel has no bar of its own. A listing already ends in the mini bar (the record and its transport),
 * and a strip under that would be a footer with a footer; see `foot`.
 */
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';

export function Wall({
  channels,
  currentLeaderId,
  onSelect,
  drag,
  onCanvas,
  onHouse,
  canCanvas,
  foot,
  children,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
  drag: RoomDrag;
  /** The two ways of withdrawing — the record alone, or the whole house. */
  onCanvas: () => void;
  onHouse: () => void;
  /** Whether there is a record to hang: a canvas of nothing is a blank wall. */
  canCanvas: boolean;
  /**
   * Whether the strip is drawn at all. On the stage, yes. Under a listing the mini bar already runs
   * along the bottom with the record and its transport, and two bars stacked is a footer with a footer.
   */
  foot: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="cx-wall">
      <div
        className="cx-wall-room"
        data-room-drop={currentLeaderId ?? undefined}
        data-room-drop-kind="wall"
        data-hot={drag.active?.kind === 'room' || undefined}
        data-over={(currentLeaderId !== null && drag.over === currentLeaderId) || undefined}
      >
        {children}
      </div>

      {foot && channels.length > 0 && (
        <footer className="cx-house">
          {channels.map((channel) => (
            <Room
              key={channel.leader.id}
              channel={channel}
              current={channel.leader.id === currentLeaderId}
              onSelect={onSelect}
              drag={drag}
            />
          ))}

          {/*
           * The two withdrawals, at the far end of the row of rooms — which is where they belong,
           * because both are ways of looking at the house rather than at this room's controls.
           */}
          <span className="cx-house-ways mono">
            {canCanvas && (
              <button type="button" onClick={onCanvas}>
                canvas
              </button>
            )}
            <button type="button" onClick={onHouse}>
              house
            </button>
          </span>
        </footer>
      )}
    </div>
  );
}

/**
 * One room in the strip.
 *
 * Three states, told by the line under the name and nothing else: what is playing, `quiet` for a room
 * that is on with nothing loaded, `off` for one that is off. A playing room also carries the record's
 * light beside its name, so a glance along the strip says where the music is without reading it.
 */
function Room({
  channel,
  current,
  onSelect,
  drag,
}: {
  channel: Channel;
  current: boolean;
  onSelect: (zoneId: number) => void;
  drag: RoomDrag;
}) {
  const api = useApi();
  const leader = channel.leader;
  const cover = zoneCoverCss(api, leader, 120);
  const playing = channel.playing && channel.hasTrack;
  const off = leader.powerState?.power === 'off';
  const line = channel.hasTrack
    ? [leader.track?.title, leader.track?.artist].filter(Boolean).join(' · ')
    : off
      ? 'off'
      : 'quiet';

  return (
    <button
      type="button"
      className="cx-house-room"
      data-current={current || undefined}
      data-quiet={!channel.hasTrack || undefined}
      data-room-drop={current ? undefined : leader.id}
      data-room-drop-kind={current ? undefined : 'room'}
      data-hot={(!current && drag.active?.kind === 'record') || undefined}
      data-over={(!current && drag.over === leader.id) || undefined}
      /* The same threshold `useRoomDrag` gives the slivers: a press is a select, a pull is a drag, and
         `consumed` keeps the click that ends a drag from also switching rooms. */
      onPointerDown={(event) =>
        !current && drag.begin({ kind: 'room', zoneId: leader.id, cover, name: leader.name }, event)
      }
      onClick={() => {
        if (drag.consumed() || current) {
          return;
        }
        onSelect(leader.id);
      }}
      title={channel.hasTrack ? `${leader.name} — ${leader.track?.title ?? ''}` : leader.name}
    >
      <span className="cx-house-cov" style={cover ? { backgroundImage: cover } : undefined} aria-hidden="true" />
      <span className="cx-house-txt">
        <span className="cx-house-name mono">
          {playing && <i className="cx-house-lit" aria-hidden="true" />}
          {leader.name}
          {channel.members.length > 1 && <i className="cx-house-plus"> +{channel.members.length - 1}</i>}
        </span>
        <span className="cx-house-line">{line}</span>
      </span>
    </button>
  );
}
