/**
 * The wall: the room you are in, as the thing a record or another room is dropped onto.
 *
 * Drag a record here to play it in this room; drag a room here to group it with this one. The rooms
 * themselves are listed in the frame's sidebar and on Home, so the wall carries nothing but the page.
 * At rest the house is a gallery — see `Gallery`.
 */
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import { PowerGlyph, SpeakerGlyph } from '@/art/glyphs';
import { mainTitle } from '@/lib/title';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';

export function Wall({
  currentLeaderId,
  drag,
  children,
}: {
  currentLeaderId: number | null;
  drag: RoomDrag;
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
