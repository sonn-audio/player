/**
 * Home: the house, as the records that are on in it.
 *
 * Every room with music is a poster of its record — the sleeve at full size, the room's name over it,
 * what is on, how loud, and the play button where a thumb expects it. The rooms with nothing on are a
 * quiet row underneath, and below them is what this room played lately, so a silent house still opens
 * on something to put on rather than on a floor plan of empty boxes.
 *
 * Press a poster to stand in that room and look at its record. Pull one onto another and they play
 * together — the same gesture and payload the rooms page has.
 */
import { useApi } from '@/state/ServerContext';
import { accentOf } from '@/art/accent';
import { itemCoverCss, zoneCoverCss } from '@/art/cover';
import { PauseGlyph, PlayGlyph, PowerGlyph, SpeakerGlyph } from '@/art/glyphs';
import { greeting } from '@/art/Stage';
import { ServiceMark } from '@/art/serviceMark';
import { mainTitle } from '@/lib/title';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';

/** `Tuesday 10 November` */
function dayLine(now = new Date()): string {
  return now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export type Shelf = { key: string; title: string; sub?: string; cover: string | undefined; play: () => void }[];

export function House({
  channels,
  currentLeaderId,
  drag,
  recents,
  favorites,
  services,
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
  /** What this room has been told to keep. */
  favorites: Shelf;
  /** The ways in: every service the server has, with its mark. */
  services: { id: string; name: string; open: () => void }[];
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
  /* A poster needs a record: something playing, or something paused that has a sleeve. A line-in with
     no signal is a room with nothing on, whatever its transport says. */
  const isLit = (channel: Channel): boolean =>
    channel.hasTrack && (channel.playing || Boolean(channel.leader.track?.coverUrl));
  const lit = channels.filter(isLit);
  const quiet = channels.filter((channel) => !isLit(channel));
  const playing = lit.filter((channel) => channel.playing).length;

  const dropProps = (channel: Channel) => ({
    'data-room-drop': channel.leader.id,
    'data-room-drop-kind': 'desk',
    'data-hot': (drag.active?.kind === 'room' && drag.active.zoneId !== channel.leader.id) || undefined,
    'data-over': drag.over === channel.leader.id || undefined,
  });

  return (
    <div className="cx-home">
      <header className="cx-home-head">
        <div>
          <span className="cx-home-day">{dayLine()}</span>
          <h1 className="disp cx-home-greet">{greeting()}.</h1>
        </div>
        <span className="cx-home-now">
          {playing > 0
            ? `Music in ${playing === 1 ? lit.find((channel) => channel.playing)!.leader.name : `${playing} rooms`}`
            : lit.length > 0
              ? 'Paused'
              : 'The house is quiet'}
        </span>
      </header>

      {lit.length > 0 && (
        <div className="cx-posters" data-n={Math.min(lit.length, 4)}>
          {lit.map((channel) => {
            const leader = channel.leader;
            const current = leader.id === currentLeaderId;
            const cover = zoneCoverCss(api, leader, 640);
            const colours = accentOf(leader.track);
            const max = leader.volumeLimits.max ?? 100;
            const level = max > 0 ? Math.round((leader.volume / max) * 100) : 0;
            const others = channel.members.slice(1).map((member) => member.name);
            return (
              <div
                className="cx-poster"
                key={leader.id}
                data-current={current || undefined}
                data-on={channel.playing || undefined}
                style={{ '--c': colours['--rec-accent'], '--pct': `${level}%` } as React.CSSProperties}
                {...dropProps(channel)}
              >
                <button
                  type="button"
                  className="cx-poster-hit"
                  onPointerDown={(event) => drag.begin({ kind: 'room', zoneId: leader.id, cover, name: leader.name }, event)}
                  onClick={() => !drag.consumed() && onOpen(leader.id)}
                  title={`${leader.name} — ${leader.track?.title ?? ''}`}
                >
                  <span className="cx-poster-back" style={{ backgroundImage: cover }} aria-hidden="true" />
                  <span className="cx-poster-art" style={{ backgroundImage: cover }} aria-hidden="true" />
                  <span className="cx-poster-txt">
                    <span className="cx-poster-room">
                      {channel.playing && <i aria-hidden="true" />}
                      {leader.name}
                      {others.length > 0 && <em> + {others.join(' + ')}</em>}
                    </span>
                    <span className="disp cx-poster-title">{leader.track?.title ? mainTitle(leader.track.title) : ''}</span>
                    <span className="cx-poster-artist">
                      {[leader.track?.artist, leader.track?.album].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="cx-poster-lvl" aria-hidden="true">
                    <i />
                  </span>
                </button>
                <button
                  type="button"
                  className="cx-poster-play"
                  aria-label={channel.playing ? `Pause ${leader.name}` : `Play ${leader.name}`}
                  onClick={() => void (channel.playing ? api.pause(leader.id) : api.play(leader.id))}
                >
                  {channel.playing ? <PauseGlyph size={18} /> : <PlayGlyph size={18} />}
                </button>
                {drag.active?.kind === 'room' && drag.over === leader.id && drag.active.zoneId !== leader.id && (
                  <span className="cx-poster-hint">Play together with {leader.name}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {quiet.length > 0 && (
        <div className="cx-quiets">
          {quiet.map((channel) => {
            const leader = channel.leader;
            const off = leader.powerState?.power === 'off';
            return (
              <button
                type="button"
                className="cx-quiet"
                key={leader.id}
                data-current={leader.id === currentLeaderId || undefined}
                data-off={off || undefined}
                onPointerDown={(event) => drag.begin({ kind: 'room', zoneId: leader.id, cover: undefined, name: leader.name }, event)}
                onClick={() => !drag.consumed() && onSelect(leader.id)}
                {...dropProps(channel)}
              >
                <span className="cx-quiet-ic" aria-hidden="true">
                  {off ? <PowerGlyph size={14} /> : <SpeakerGlyph size={14} />}
                </span>
                <span className="cx-quiet-txt">
                  <span className="cx-quiet-name">{leader.name}</span>
                  <span className="cx-quiet-line">{off ? 'Off' : leader.id === currentLeaderId ? 'You are here' : 'Quiet'}</span>
                </span>
                {drag.active?.kind === 'room' && drag.over === leader.id && drag.active.zoneId !== leader.id && (
                  <span className="cx-poster-hint">Play together with {leader.name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {scenes.length > 0 && (
        <section className="cx-home-sec">
          <div className="cx-home-sec-head">
            <h2 className="cx-home-sec-lbl">Set the scene</h2>
            {onSaveScene && (
              <button type="button" className="cx-home-sec-act" onClick={onSaveScene}>
                Save this moment
              </button>
            )}
          </div>
          <div className="cx-home-row">
            {scenes.map((item) => (
              <button type="button" className="cx-home-tile" key={item.key} onClick={item.play}>
                <span className="cx-home-tile-cov" style={{ backgroundImage: itemCoverCss(item.cover) }} />
                <span className="cx-home-tile-title">{item.title}</span>
                {item.sub && <span className="cx-home-tile-sub">{item.sub}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="cx-home-sec">
        <div className="cx-home-sec-head">
          <h2 className="cx-home-sec-lbl">{recents.length > 0 ? 'Pick up where you left off' : 'Put something on'}</h2>
          <button type="button" className="cx-home-sec-act" onClick={onBrowse}>
            Browse music
          </button>
          {scenes.length === 0 && onSaveScene && (
            <button type="button" className="cx-home-sec-act" onClick={onSaveScene}>
              Save this moment
            </button>
          )}
        </div>
        {recents.length > 0 && (
          <div className="cx-home-row">
            {recents.map((item) => (
              <button type="button" className="cx-home-tile" key={item.key} onClick={item.play} title={`Play ${item.title}`}>
                <span className="cx-home-tile-cov" style={{ backgroundImage: itemCoverCss(item.cover) }}>
                  <span className="cx-home-tile-play" aria-hidden="true">
                    <PlayGlyph size={14} />
                  </span>
                </span>
                <span className="cx-home-tile-title">{item.title}</span>
                {item.sub && <span className="cx-home-tile-sub">{item.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {favorites.length > 0 && (
        <section className="cx-home-sec">
          <div className="cx-home-sec-head">
            <h2 className="cx-home-sec-lbl">Kept</h2>
          </div>
          <div className="cx-home-row">
            {favorites.map((item) => (
              <button type="button" className="cx-home-tile" key={item.key} onClick={item.play} title={`Play ${item.title}`}>
                <span className="cx-home-tile-cov" style={{ backgroundImage: itemCoverCss(item.cover) }}>
                  <span className="cx-home-tile-play" aria-hidden="true">
                    <PlayGlyph size={14} />
                  </span>
                </span>
                <span className="cx-home-tile-title">{item.title}</span>
                {item.sub && <span className="cx-home-tile-sub">{item.sub}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {services.length > 0 && (
        <section className="cx-home-sec">
          <div className="cx-home-sec-head">
            <h2 className="cx-home-sec-lbl">Your music</h2>
          </div>
          <div className="cx-home-doors">
            {services.map((service) => (
              <button type="button" className="cx-home-door" key={service.id} onClick={service.open}>
                <ServiceMark id={service.id} name={service.name} size={40} />
                <span className="cx-home-door-name">{service.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
