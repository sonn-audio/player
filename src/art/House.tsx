/**
 * The house, as light.
 *
 * Home was a row of cards, and a house is not a list. This is the house seen at night: every room a
 * window, a playing room lit in the colour of its own record, its volume the brightness of the light,
 * a group one light across the rooms that share it. The room you stand in is the largest window; the
 * rest take their size from whether anything is on in them. Press a window to stand in that room; pull
 * one onto another and they play together — the same gesture the wall has, with the same payload.
 *
 * The colours come from `accentOf` per room, so the window is lit by the record the way the frame is.
 */
import { useApi } from '@/state/ServerContext';
import { accentOf } from '@/art/accent';
import { zoneCoverCss } from '@/art/cover';
import { PowerGlyph, SpeakerGlyph } from '@/art/glyphs';
import { greeting } from '@/art/Stage';
import { mainTitle } from '@/lib/title';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';

/** `Tuesday 10 November · 21:40` */
function nowLine(now = new Date()): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function House({
  channels,
  currentLeaderId,
  drag,
  onSelect,
  onOpen,
  onSaveScene,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  drag: RoomDrag;
  /** Stand in this room. */
  onSelect: (zoneId: number) => void;
  /** Stand in it and look at its record. */
  onOpen: (zoneId: number) => void;
  /** Keep this evening: the rooms, what is on, how loud. Absent when nothing is on anywhere. */
  onSaveScene?: (() => void) | undefined;
}) {
  const api = useApi();
  const playing = channels.filter((channel) => channel.playing && channel.hasTrack).length;
  const rooms = channels.reduce((sum, channel) => sum + channel.members.length, 0);
  const currentHasTrack = channels.some((channel) => channel.leader.id === currentLeaderId && channel.hasTrack);
  const firstLit = currentHasTrack ? -1 : channels.findIndex((channel) => channel.hasTrack);

  return (
    <div className="cx-home">
      <div className="cx-home-head">
        <h1 className="disp cx-home-greet">{greeting()}.</h1>
        <span className="cx-home-now">
          {nowLine()} · <b>{playing === 0 ? 'nothing' : `${playing} of ${rooms} rooms`}</b> playing
        </span>
      </div>

      <div className="cx-home-plan" data-dragging={drag.active?.kind === 'room' || undefined}>
        {channels.map((channel, index) => {
          const leader = channel.leader;
          const current = leader.id === currentLeaderId;
          const lit = channel.playing && channel.hasTrack;
          const off = leader.powerState?.power === 'off';
          const cover = zoneCoverCss(api, leader, 320);
          const palette = accentOf(leader.track);
          const max = leader.volumeLimits.max ?? 100;
          const level = max > 0 ? Math.round((leader.volume / max) * 100) : 0;
          /* The largest window is the room with music in it — this one if it has any, else the first that
             plays; a quiet room you happen to stand in is not the subject of the house. */
          const size = channel.hasTrack && (current || index === firstLit) ? 'large' : channel.hasTrack || current ? 'medium' : 'small';
          const line = channel.hasTrack
            ? `${channel.playing ? '' : 'paused · '}${[leader.track?.title ? mainTitle(leader.track.title) : '', leader.track?.artist].filter(Boolean).join(' · ')}`
            : off
              ? 'off'
              : 'quiet';
          return (
            <button
              type="button"
              className="cx-win"
              key={leader.id}
              data-size={size}
              data-current={current || undefined}
              data-on={lit || undefined}
              data-paused={(!channel.playing && channel.hasTrack) || undefined}
              data-off={off || undefined}
              data-quiet={!channel.hasTrack || undefined}
              data-room-drop={leader.id}
              data-room-drop-kind="desk"
              data-hot={(drag.active?.kind === 'room' && drag.active.zoneId !== leader.id) || undefined}
              data-over={drag.over === leader.id || undefined}
              style={
                {
                  '--c': palette['--rec-accent'],
                  '--cm': palette['--rec-mid'],
                  '--v': level,
                  '--pct': `${level}%`,
                } as React.CSSProperties
              }
              onPointerDown={(event) => drag.begin({ kind: 'room', zoneId: leader.id, cover, name: leader.name }, event)}
              onClick={() => {
                if (drag.consumed()) {
                  return;
                }
                if (current && channel.hasTrack) {
                  onOpen(leader.id);
                } else {
                  onSelect(leader.id);
                }
              }}
              onDoubleClick={() => channel.hasTrack && onOpen(leader.id)}
              title={channel.hasTrack ? `${leader.name} — ${leader.track?.title ?? ''}` : leader.name}
            >
              <span className="cx-win-lit" aria-hidden="true" />
              <span className="cx-win-cov" style={cover && channel.hasTrack ? { backgroundImage: cover } : undefined} aria-hidden="true">
                {!channel.hasTrack && (off ? <PowerGlyph size={18} /> : <SpeakerGlyph size={18} />)}
              </span>
              <span className="cx-win-name">
                {leader.name}
                {channel.members.length > 1 && (
                  <i className="cx-win-plus"> + {channel.members.slice(1).map((member) => member.name).join(' + ')}</i>
                )}
              </span>
              <span className="cx-win-line">{line}</span>
              {!off && (
                <span className="cx-win-lvl" aria-hidden="true">
                  <i />
                </span>
              )}
              {drag.active?.kind === 'room' && drag.over === leader.id && drag.active.zoneId !== leader.id && (
                <span className="cx-win-hint">Play together with {leader.name}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="cx-home-foot">
        <span>
          {channels.length > 1 ? 'Drag a room onto another to play them together · press a room to stand in it' : 'Press the room to stand in it'}
        </span>
        {onSaveScene && (
          <button type="button" className="cx-home-save" onClick={onSaveScene}>
            <b>Save this {greeting().toLowerCase().replace('good ', '')}</b> as a scene
          </button>
        )}
      </div>
    </div>
  );
}
