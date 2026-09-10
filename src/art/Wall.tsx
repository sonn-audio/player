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
import { PowerGlyph, SpeakerGlyph } from '@/art/glyphs';
import { mainTitle } from '@/lib/title';
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
          <HouseStrip
            channels={channels}
            currentLeaderId={currentLeaderId}
            onSelect={onSelect}
            drag={drag}
            onCanvas={onCanvas}
            onHouse={onHouse}
            canCanvas={canCanvas}
          />
        </footer>
      )}
    </div>
  );
}

/**
 * The house, as a row of rooms: what the strip along the foot of the wall holds, and what the stage's
 * own page holds at its foot on a wide window (see `Stage`'s `house`). One component, two places, so
 * the rooms cannot be drawn two ways.
 */
export function HouseStrip({
  channels,
  currentLeaderId,
  onSelect,
  drag,
  onCanvas,
  onHouse,
  canCanvas,
  compact = false,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
  drag: RoomDrag;
  onCanvas: () => void;
  onHouse: () => void;
  canCanvas: boolean;
  /** Inside a column rather than across the page: the rooms wrap, and the row has no fixed height. */
  compact?: boolean;
}) {
  /*
   * The two withdrawals — the record alone, or the whole house — stand at the far end of the row of
   * rooms, because both are ways of looking at the house rather than at this room's controls.
   */
  const ways = (
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
  );
  const rooms = channels.map((channel) => (
    <Room
      key={channel.leader.id}
      channel={channel}
      current={channel.leader.id === currentLeaderId}
      onSelect={onSelect}
      drag={drag}
      compact={compact}
    />
  ));

  if (compact) {
    /* Inside a page the row has a head like every other section — the label, the hairline, the ways —
       so the rooms below it can wrap without the words wrapping with them. */
    return (
      <div className="cx-house-row" data-compact>
        <div className="cx-house-head">
          <span className="cx-house-lbl mono">the house</span>
          <span className="cx-house-rule" aria-hidden="true" />
          {ways}
        </div>
        <div className="cx-house-rooms">{rooms}</div>
      </div>
    );
  }
  return (
    <div className="cx-house-row">
      {rooms}
      {ways}
    </div>
  );
}

/**
 * The house at rest: every room the same width, each showing what is on in it.
 *
 * This is the gallery — the picture a panel in a hallway shows when nobody is touching it, where the
 * useful question is not *what is this* but *what is the house doing*. A room with a record shows its
 * sleeve whole with the name and the record under it and a hairline of how far along it is; a quiet
 * room shows its name on the dark. Pressing a room stands you in it and wakes the screen.
 */
export function Gallery({
  channels,
  currentLeaderId,
  onSelect,
  onLeave,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
  onLeave: () => void;
}) {
  const api = useApi();
  return (
    <div
      className="cx-gallery"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button') === null) {
          onLeave();
        }
      }}
    >
      {channels.map((channel) => {
        const leader = channel.leader;
        const cover = zoneCoverCss(api, leader, 640);
        const playing = channel.playing && channel.hasTrack;
        const off = leader.powerState?.power === 'off';
        const pct = channel.hasTrack && leader.duration > 0 ? Math.min(100, (leader.position / leader.duration) * 100) : null;
        return (
          <button
            type="button"
            className="cx-gal-room"
            key={leader.id}
            data-current={leader.id === currentLeaderId || undefined}
            data-quiet={!channel.hasTrack || undefined}
            data-on={playing || undefined}
            onClick={() => {
              onSelect(leader.id);
              onLeave();
            }}
          >
            <span className="cx-gal-cov" style={cover && channel.hasTrack ? { backgroundImage: cover } : undefined} aria-hidden="true">
              {!channel.hasTrack && (off ? <PowerGlyph size={22} /> : <SpeakerGlyph size={22} />)}
            </span>
            <span className="cx-gal-name mono">
              {playing && <i className="cx-house-lit" aria-hidden="true" />}
              {leader.name}
              {channel.members.length > 1 && <i className="cx-house-plus"> +{channel.members.length - 1}</i>}
            </span>
            {channel.hasTrack ? (
              <>
                <span className="cx-gal-title">{leader.track?.title ? mainTitle(leader.track.title) : ''}</span>
                {leader.track?.artist && <span className="cx-gal-artist">{leader.track.artist}</span>}
              </>
            ) : (
              <span className="cx-gal-artist">{off ? 'off' : 'quiet'}</span>
            )}
            {pct !== null && (
              <span className="cx-gal-prog" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            )}
          </button>
        );
      })}
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
  compact = false,
}: {
  channel: Channel;
  current: boolean;
  onSelect: (zoneId: number) => void;
  drag: RoomDrag;
  /** In a page's row there is room for the record's name, not for the artist too. */
  compact?: boolean;
}) {
  const api = useApi();
  const leader = channel.leader;
  const cover = zoneCoverCss(api, leader, 120);
  const playing = channel.playing && channel.hasTrack;
  const off = leader.powerState?.power === 'off';
  const line = channel.hasTrack
    ? [leader.track?.title ? mainTitle(leader.track.title) : '', compact ? '' : leader.track?.artist]
        .filter(Boolean)
        .join(' · ')
    : off
      ? 'off'
      : 'quiet';
  /* How far into its record the room is — the one thing about another room a glance at the strip
     might want beyond what is on. Null for a station, which has no far. */
  const pct = channel.hasTrack && leader.duration > 0 ? Math.min(100, (leader.position / leader.duration) * 100) : null;

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
      <span className="cx-house-cov" style={cover ? { backgroundImage: cover } : undefined} aria-hidden="true">
        {/* A room with nothing on shows what it is, not an empty square. */}
        {!channel.hasTrack && (off ? <PowerGlyph size={14} /> : <SpeakerGlyph size={14} />)}
      </span>
      <span className="cx-house-txt">
        <span className="cx-house-name mono">
          {playing && <i className="cx-house-lit" aria-hidden="true" />}
          {leader.name}
          {channel.members.length > 1 && <i className="cx-house-plus"> +{channel.members.length - 1}</i>}
        </span>
        <span className="cx-house-line">{line}</span>
        {pct !== null && (
          <span className="cx-house-prog" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}
