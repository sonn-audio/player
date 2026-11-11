/**
 * Home: the house, as the records that are on in it.
 *
 * Quiet on purpose. Every room with a record is its sleeve with the room's name engraved under it and
 * what is on; the rooms with nothing on are two lines of type beside them; under that, what this room
 * played lately. Nothing here moves or glows — the sleeves are the only colour on the page.
 *
 * Press a sleeve to stand in that room and look at its record. Pull one onto another and they play
 * together — the same gesture and payload the rooms page has.
 */
import { useApi } from '@/state/ServerContext';
import { itemCoverCss, zoneCoverCss } from '@/art/cover';
import { greeting } from '@/art/Stage';
import { mainTitle } from '@/lib/title';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';

/** `Wednesday 11 November` */
function dayLine(now = new Date()): string {
  return now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export type Shelf = { key: string; title: string; sub?: string; cover: string | undefined; play: () => void }[];

export function House({
  channels,
  currentLeaderId,
  drag,
  recents,
  scenes,
  onSelect,
  onOpen,
  onBrowse,
  onSaveScene,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  drag: RoomDrag;
  /** What the room you stand in played lately. */
  recents: Shelf;
  /** Saved moments: the rooms, what was on, how loud. */
  scenes: Shelf;
  /** Stand in this room. */
  onSelect: (zoneId: number) => void;
  /** Stand in it and look at its record. */
  onOpen: (zoneId: number) => void;
  onBrowse: () => void;
  /** Keep this moment. Absent when nothing is on in the room you stand in. */
  onSaveScene?: (() => void) | undefined;
}) {
  const api = useApi();
  /* A sleeve needs a record: something playing, or something paused that has a picture. A line-in with
     no signal is a room with nothing on, whatever its transport says. */
  const isLit = (channel: Channel): boolean =>
    channel.hasTrack && (channel.playing || Boolean(channel.leader.track?.coverUrl));
  const lit = channels.filter(isLit);
  const quiet = channels.filter((channel) => !isLit(channel));
  const playing = lit.filter((channel) => channel.playing).length;
  const paused = lit.length - playing;
  const tally = [
    playing > 0 ? `${playing} playing` : '',
    paused > 0 ? `${paused} paused` : '',
    quiet.length > 0 ? `${quiet.length} quiet` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const dropProps = (channel: Channel) => ({
    'data-room-drop': channel.leader.id,
    'data-room-drop-kind': 'desk',
    'data-hot': (drag.active?.kind === 'room' && drag.active.zoneId !== channel.leader.id) || undefined,
    'data-over': drag.over === channel.leader.id || undefined,
  });

  return (
    <div className="cx-home">
      <header className="cx-home-head">
        <span className="cx-home-lbl mono">{dayLine()}</span>
        <h1 className="cx-home-greet">{greeting()}.</h1>
      </header>

      <section className="cx-home-sec">
        <div className="cx-home-sec-head">
          <span className="cx-home-lbl mono">in the house</span>
          <span className="cx-home-lbl mono" data-dim>
            {tally}
          </span>
        </div>
        <div className="cx-home-house">
          {lit.map((channel) => {
            const leader = channel.leader;
            const cover = zoneCoverCss(api, leader, 480);
            const others = channel.members.slice(1).map((member) => member.name);
            return (
              <button
                type="button"
                className="cx-home-room"
                key={leader.id}
                data-current={leader.id === currentLeaderId || undefined}
                data-on={channel.playing || undefined}
                onPointerDown={(event) => drag.begin({ kind: 'room', zoneId: leader.id, cover, name: leader.name }, event)}
                onClick={() => !drag.consumed() && onOpen(leader.id)}
                title={`${leader.name} — ${leader.track?.title ?? ''}`}
                {...dropProps(channel)}
              >
                <span className="cx-home-room-cov" style={{ backgroundImage: cover }} aria-hidden="true" />
                <span className="cx-home-room-name mono">
                  <i aria-hidden="true" />
                  {[leader.name, ...others].join(' + ')}
                </span>
                <span className="cx-home-room-title">{leader.track?.title ? mainTitle(leader.track.title) : ''}</span>
                <span className="cx-home-room-artist">
                  {[leader.track?.artist, channel.playing ? '' : 'paused'].filter(Boolean).join(' · ')}
                </span>
              </button>
            );
          })}

          {quiet.length > 0 && (
            <div className="cx-home-quiets" data-alone={lit.length === 0 || undefined}>
              {quiet.map((channel) => {
                const leader = channel.leader;
                const off = leader.powerState?.power === 'off';
                return (
                  <button
                    type="button"
                    className="cx-home-quiet"
                    key={leader.id}
                    data-current={leader.id === currentLeaderId || undefined}
                    data-off={off || undefined}
                    onPointerDown={(event) =>
                      drag.begin({ kind: 'room', zoneId: leader.id, cover: undefined, name: leader.name }, event)
                    }
                    onClick={() => !drag.consumed() && onSelect(leader.id)}
                    {...dropProps(channel)}
                  >
                    <i aria-hidden="true" />
                    <span>
                      {leader.name}
                      <em>{off ? 'off' : 'quiet'}</em>
                    </span>
                    <span className="cx-home-quiet-vol mono">{off ? '—' : leader.volume}</span>
                  </button>
                );
              })}
              {channels.length > 1 && (
                <span className="cx-home-lbl mono" data-dim>
                  drag a room onto another to play them together
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {scenes.length > 0 && (
        <section className="cx-home-sec">
          <div className="cx-home-sec-head">
            <span className="cx-home-lbl mono">scenes</span>
            {onSaveScene && (
              <button type="button" className="cx-home-lbl mono" data-act onClick={onSaveScene}>
                save this moment
              </button>
            )}
          </div>
          <div className="cx-home-scenes">
            {scenes.map((item) => (
              <button type="button" className="cx-home-scene" key={item.key} onClick={item.play}>
                {item.title}
                {item.sub && <em>{item.sub}</em>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="cx-home-sec">
        <div className="cx-home-sec-head">
          <span className="cx-home-lbl mono">{recents.length > 0 ? 'lately in this room' : 'nothing played here yet'}</span>
          <button type="button" className="cx-home-lbl mono" data-act onClick={onBrowse}>
            browse music
          </button>
        </div>
        {recents.length > 0 && (
          <div className="cx-home-row">
            {recents.map((item) => (
              <button type="button" className="cx-home-tile" key={item.key} onClick={item.play} title={`Play ${item.title}`}>
                <span className="cx-home-tile-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-home-tile-title">{item.title}</span>
                {item.sub && <span className="cx-home-tile-sub">{item.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
