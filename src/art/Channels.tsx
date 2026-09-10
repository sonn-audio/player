/**
 * The desk: every room as a channel strip, the groups as blocks of strips.
 *
 * The rooms sheet used to be a list — a row per room with a hairline fader under it, `JOIN` at the end of
 * the rows that were not in your group, a heading over the ones that were. It said everything and showed
 * nothing: a house with three rooms and a group in it looked exactly like a settings page.
 *
 * A mixing desk is the picture this is actually of. Each room is a strip: its sleeve, its name, what it
 * is doing, a vertical fader with the level above it, and one word at the foot for the one decision the
 * strip offers (`join`, `leave`, `turn on`). Rooms that play together stand in one block, drawn with the
 * record's own colour, with a master strip at the end of it — the group's transport and a fader that
 * moves every member by the same amount, so a balance you set between two rooms survives turning the
 * evening down. Drag a strip onto another and they play together.
 *
 * On a phone the same strips lie down: a row each, the fader running under the name, the block the same.
 * One component, two orientations; `phone` picks the drag axis and the stylesheet does the rest.
 */
import { useMemo, useRef, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { DELAY_MAX_MS, DELAY_NUDGE_MS, useOutputDelay } from '@/state/useOutputDelay';
import { sceneable, useScenes } from '@/state/useScenes';
import { itemCoverCss, zoneCoverCss } from '@/art/cover';
import { clamp, horizontalDrag, verticalDrag } from '@/art/drag';
import { useVolumeControl } from '@/art/volume';
import { EmptyArtGlyph, PauseGlyph, PlayGlyph, PowerGlyph, SpeakerGlyph } from '@/art/glyphs';
import type { Channel } from '@/art/useCur';
import type { RoomDrag } from '@/art/useRoomDrag';
import type { ApiZoneState } from '@/api/types';

/** How long a written level stays on screen before the server's own reading takes over again. */
const SETTLE_MS = 700;

function stateLabel(zone: ApiZoneState): string {
  if (zone.track) {
    const parts = [zone.track.title, zone.track.artist].filter(Boolean);
    return `${zone.state === 'playing' ? '' : 'paused · '}${parts.join(' — ')}`;
  }
  if (zone.powerState.power === 'off') {
    return 'off';
  }
  return 'quiet';
}

// --- one strip ----------------------------------------------------------------

/**
 * A fader, either way up. The value sits above a vertical one and at the end of a horizontal one; the
 * pointer maths comes from `drag.ts`, which is what the stage's own faders use.
 */
function Fader({
  pct,
  value,
  active,
  onPointerDown,
  lit,
  muted,
}: {
  pct: string;
  value: number | string;
  active: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  /** Filled in the record's colour rather than silver: the strip is playing. */
  lit: boolean;
  /** The room is off or silent — the fader is drawn, but faintly. */
  muted: boolean;
}) {
  return (
    <span className="cx-desk-fader" data-lit={lit || undefined} data-muted={muted || undefined} data-active={active || undefined}>
      <span className="cx-desk-fader-val mono">{value}</span>
      <span className="cx-desk-fader-rail" onPointerDown={onPointerDown} role="presentation">
        <span className="cx-desk-fader-fill" style={{ '--pct': pct } as React.CSSProperties} />
        <span className="cx-desk-fader-knob" style={{ '--pct': pct } as React.CSSProperties} />
      </span>
      <SpeakerGlyph size={14} />
    </span>
  );
}

function Strip({
  zone,
  channel,
  role,
  current,
  phone,
  onSelect,
  drag,
  action,
}: {
  zone: ApiZoneState;
  channel: Channel;
  role: 'solo' | 'leader' | 'follower';
  current: boolean;
  phone: boolean;
  onSelect: () => void;
  drag: RoomDrag;
  /** The one word at the foot, or nothing. */
  action?: { label: string; run: () => void; glyph?: React.ReactNode } | undefined;
}) {
  const api = useApi();
  const control = useVolumeControl(zone);
  const playing = channel.playing && channel.hasTrack;
  const off = zone.powerState.power === 'off';
  const cover = zoneCoverCss(api, channel.leader, 160);
  const line = role === 'follower' ? `following ${channel.leader.name}` : stateLabel(zone);

  return (
    <div
      className="cx-desk-strip"
      data-role={role}
      data-current={current || undefined}
      data-on={playing || undefined}
      data-quiet={!channel.hasTrack || undefined}
      data-room-drop={zone.id}
      data-room-drop-kind="desk"
      data-hot={(drag.active?.kind === 'room' && drag.active.zoneId !== zone.id) || undefined}
      data-over={drag.over === zone.id || undefined}
    >
      {/* The sleeve and the name are the handle: press to stand in the room, pull to move it. */}
      <button
        type="button"
        className="cx-desk-hit"
        onPointerDown={(event) => drag.begin({ kind: 'room', zoneId: zone.id, cover, name: zone.name }, event)}
        onClick={() => {
          if (!drag.consumed()) {
            onSelect();
          }
        }}
        title={zone.name}
      >
        <span className="cx-desk-cov" style={cover ? { backgroundImage: cover } : undefined} data-empty={!cover || undefined}>
          {!cover && (off ? <PowerGlyph size={16} /> : <SpeakerGlyph size={16} />)}
        </span>
        <span className="cx-desk-txt">
          <span className="cx-desk-name mono">{zone.name}</span>
          <span className="cx-desk-line">{line}</span>
        </span>
      </button>

      <Fader
        pct={control.pct}
        value={control.value}
        active={control.active}
        onPointerDown={phone ? control.onPointerDownH : control.onPointerDownV}
        lit={playing}
        muted={off}
      />

      <span className="cx-desk-foot">
        {action ? (
          <button type="button" className="cx-desk-word mono" onClick={action.run}>
            {action.glyph}
            {action.label}
          </button>
        ) : (
          <span className="cx-desk-word mono" data-quiet>
            {current ? 'this room' : ''}
          </span>
        )}
      </span>
    </div>
  );
}

// --- the master --------------------------------------------------------------

/**
 * The group's own strip: its transport and a fader that moves every member by the same amount.
 *
 * There is no group volume in the contract, so this is the client's arithmetic: the fader shows the
 * members' mean, and a drag applies the *change* in that mean to each member, clamped to its own limit.
 * Setting every room to one number would be simpler and wrong — the whole point of two faders beside
 * each other is that they are not at the same height.
 */
function Master({
  channel,
  phone,
  onUngroup,
}: {
  channel: Channel;
  phone: boolean;
  onUngroup: () => void;
}) {
  const api = useApi();
  const leader = channel.leader;
  const playing = channel.playing && channel.hasTrack;
  const max = leader.volumeLimits.max ?? 100;
  const mean = channel.members.reduce((sum, member) => sum + member.volume, 0) / channel.members.length;

  const [dragging, setDragging] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const start = useRef<{ mean: number; volumes: Map<number, { volume: number; max: number }> } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>();

  const value = dragging ?? Math.round(mean);
  const pct = `${max > 0 ? (value / max) * 100 : 0}%`;

  const begin = (): void => {
    setActive(true);
    start.current = {
      mean,
      volumes: new Map(channel.members.map((member) => [member.id, { volume: member.volume, max: member.volumeLimits.max ?? 100 }])),
    };
  };
  const write = (fraction: number): void => {
    const from = start.current;
    if (!from) {
      return;
    }
    const target = fraction * max;
    const delta = target - from.mean;
    setDragging(Math.round(target));
    for (const [id, was] of from.volumes) {
      void api.setVolume(id, Math.round(clamp(was.volume + delta, 0, was.max)));
    }
  };
  const end = (): void => {
    setActive(false);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setDragging(null), SETTLE_MS);
  };
  const onPointerDown = useMemo(
    () => (phone ? horizontalDrag(write, begin, end) : verticalDrag(write, begin, end)),
    // The handlers close over the latest members through `channel`; rebuilt when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phone, channel],
  );

  return (
    <div className="cx-desk-strip cx-desk-master" data-on={playing || undefined}>
      <button
        type="button"
        className="cx-desk-ring"
        aria-label={playing ? 'Pause the group' : 'Play the group'}
        onClick={() => void (playing ? api.pause(leader.id) : api.play(leader.id))}
      >
        {playing ? <PauseGlyph size={22} /> : <PlayGlyph size={22} />}
      </button>
      <span className="cx-desk-txt">
        <span className="cx-desk-name mono">group volume</span>
        <span className="cx-desk-line">
          moves {channel.members.length === 2 ? 'both' : `all ${channel.members.length}`} rooms
        </span>
      </span>
      <Fader pct={pct} value={value} active={active} onPointerDown={onPointerDown} lit={false} muted={false} />
      <span className="cx-desk-foot">
        <button type="button" className="cx-desk-word mono" onClick={onUngroup}>
          ungroup
        </button>
      </span>
    </div>
  );
}

// --- alignment ------------------------------------------------------------------

function AlignRow({ zone, leader }: { zone: ApiZoneState; leader: boolean }) {
  const { delayMs, settable, failed, drag, commit } = useOutputDelay(zone);
  return (
    <li className="cx-align-row">
      <span className="cx-align-name">
        {zone.name}
        {leader && <i className="mono">reference</i>}
      </span>
      <span className="cx-align-axis">
        <button
          type="button"
          className="cx-align-step mono"
          disabled={!settable || delayMs <= 0}
          aria-label={`${DELAY_NUDGE_MS} ms less — ${zone.name} plays later`}
          onClick={() => commit(delayMs - DELAY_NUDGE_MS)}
        >
          −
        </button>
        <input
          type="range"
          className="cx-align-range"
          min={0}
          max={DELAY_MAX_MS}
          step={DELAY_NUDGE_MS}
          value={delayMs}
          disabled={!settable}
          style={{ '--fill': `${(delayMs / DELAY_MAX_MS) * 100}%` } as React.CSSProperties}
          onChange={(event) => drag(Number(event.target.value))}
          onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
          onKeyUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
          aria-label={`Delay for ${zone.name}, milliseconds`}
        />
        <button
          type="button"
          className="cx-align-step mono"
          disabled={!settable || delayMs >= DELAY_MAX_MS}
          aria-label={`${DELAY_NUDGE_MS} ms more — ${zone.name} plays earlier`}
          onClick={() => commit(delayMs + DELAY_NUDGE_MS)}
        >
          +
        </button>
        <span className="cx-align-value mono">{settable ? `${delayMs} ms` : 'no clock'}</span>
      </span>
      {failed && <span className="cx-align-warn mono">that delay could not be applied</span>}
    </li>
  );
}

// --- the sheet ------------------------------------------------------------------

export function RoomsSheet({
  zones,
  channels,
  selectedId,
  phone,
  onSelect,
  drag,
}: {
  zones: ApiZoneState[];
  /** The house as groups — see `channelsOf`. The desk draws one block per channel. */
  channels: Channel[];
  selectedId: number | null;
  phone: boolean;
  onSelect: (zoneId: number) => void;
  /** The same gesture the wall has: a strip dragged onto another joins its group. */
  drag: RoomDrag;
}) {
  const api = useApi();
  const selected = zones.find((zone) => zone.id === selectedId) ?? null;
  const [rejected, setRejected] = useState<string[]>([]);
  const { scenes, save, recall, forget } = useScenes();

  const mine = channels.find((channel) => channel.members.some((member) => member.id === selectedId)) ?? null;
  const [alignOpen, setAlignOpen] = useState(false);

  const said = (result: { rejected: Array<{ id: number; reason: string }> }): void => {
    setRejected(
      result.rejected.map(
        (entry) =>
          `${zones.find((candidate) => candidate.id === entry.id)?.name ?? entry.id}: ${
            entry.reason === 'protocol-mismatch'
              ? 'these speakers can’t stay in step with this room — play it there on its own'
              : 'not there any more'
          }`,
      ),
    );
  };
  const failed = (): void => setRejected(['That did not work — the room may have gone.']);

  /** Put `zone` into the selected room's group. */
  const join = (zone: ApiZoneState): void => {
    if (!mine) {
      return;
    }
    void api
      .setGroup(mine.leader.id, [...mine.members.map((member) => member.id), zone.id])
      .then(said)
      .catch(failed);
  };
  /** Take a follower out of its group. */
  const leave = (channel: Channel, zone: ApiZoneState): void => {
    const next = channel.members.filter((member) => member.id !== zone.id).map((member) => member.id);
    void api
      .setGroup(channel.leader.id, next.length > 1 ? next : [])
      .then(said)
      .catch(failed);
  };
  const ungroup = (channel: Channel): void => {
    void api.ungroup(channel.leader.id).then(said).catch(failed);
  };

  const leader = mine?.leader ?? selected;
  const saveScene = (): void => {
    if (!leader) {
      return;
    }
    const suggestion = leader.track?.title || leader.source?.name || '';
    const name = window.prompt('Name this moment', suggestion);
    if (!name?.trim()) {
      return;
    }
    save(leader, zones, name.trim());
  };

  /** What one strip offers, given where it stands. */
  const actionFor = (channel: Channel, zone: ApiZoneState, role: 'solo' | 'leader' | 'follower') => {
    if (zone.powerState.power === 'off') {
      return { label: 'turn on', glyph: <PowerGlyph size={12} />, run: () => void api.setPower(zone.id, 'on') };
    }
    if (role === 'follower') {
      return { label: 'leave', run: () => leave(channel, zone) };
    }
    if (role === 'solo' && mine && channel.leader.id !== mine.leader.id) {
      return { label: 'join', run: () => join(zone) };
    }
    return undefined;
  };

  return (
    <div className="cx-desk" data-phone={phone || undefined}>
      <div className="cx-desk-row">
        {channels.map((channel) =>
          channel.members.length > 1 ? (
            <div
              className="cx-desk-group"
              key={channel.leader.id}
              data-current={channel.leader.id === mine?.leader.id || undefined}
            >
              <span className="cx-desk-group-lbl mono">
                group
                <i>playing together</i>
              </span>
              <div className="cx-desk-group-row">
                {channel.members.map((member) => {
                  const role = member.id === channel.leader.id ? 'leader' : 'follower';
                  return (
                    <Strip
                      key={member.id}
                      zone={member}
                      channel={channel}
                      role={role}
                      current={member.id === selectedId}
                      phone={phone}
                      onSelect={() => onSelect(member.id)}
                      drag={drag}
                      action={actionFor(channel, member, role)}
                    />
                  );
                })}
                <Master channel={channel} phone={phone} onUngroup={() => ungroup(channel)} />
              </div>
            </div>
          ) : (
            <Strip
              key={channel.leader.id}
              zone={channel.leader}
              channel={channel}
              role="solo"
              current={channel.leader.id === selectedId}
              phone={phone}
              onSelect={() => onSelect(channel.leader.id)}
              drag={drag}
              action={actionFor(channel, channel.leader, 'solo')}
            />
          ),
        )}

        {/* Said once, where the empty desk space is, and only while there is something to drag. */}
        {channels.length > 1 && !phone && (
          <div className="cx-desk-hint mono">drag a room onto another to group them</div>
        )}
      </div>

      {/*
       * Alignment, for a group: one row per member with the output delay. Behind a word, because it
       * is the one thing here you set once and then leave alone, and open it is a row of sliders under
       * the faders.
       */}
      {mine && mine.members.length > 1 && (
        <>
          <div className="cx-hsec-head cx-desk-head">
            <span className="cx-hsec-lbl mono">line them up</span>
            <span className="cx-hsec-rule" />
            <button type="button" className="cx-hsec-right mono cx-desk-toggle" onClick={() => setAlignOpen((open) => !open)}>
              {alignOpen ? 'hide' : 'show'}
            </button>
          </div>
          {alignOpen && (
            <>
              <ul className="cx-align">
                {mine.members.map((member) => (
                  <AlignRow key={member.id} zone={member} leader={member.id === mine.leader.id} />
                ))}
              </ul>
              <p className="cx-align-note">
                Stand where the rooms are equally far away, then raise the one that sounds late.
              </p>
            </>
          )}
        </>
      )}

      {(scenes.length > 0 || sceneable(leader)) && (
        <>
          <div className="cx-hsec-head cx-desk-head">
            <span className="cx-hsec-lbl mono">scenes</span>
            <span className="cx-hsec-rule" />
            {sceneable(leader) && (
              <button type="button" className="cx-hsec-right mono cx-desk-toggle" onClick={saveScene}>
                save this moment
              </button>
            )}
          </div>
          {scenes.length > 0 && (
            <div className="cx-desk-scenes">
              {scenes.map((scene) => {
                const cover = itemCoverCss(scene.coverUrl);
                return (
                  <div className="cx-desk-scene" key={scene.id}>
                    <button
                      type="button"
                      className="cx-desk-scene-hit"
                      onClick={() =>
                        void recall(scene).catch(() =>
                          setRejected(['That scene did not start — a room in it may have gone.']),
                        )
                      }
                      title={`Play ${scene.name}`}
                    >
                      <span className="cx-desk-scene-art" style={{ backgroundImage: cover }} data-empty={!cover || undefined}>
                        {!cover && <EmptyArtGlyph size={13} />}
                      </span>
                      <span className="cx-desk-scene-txt">
                        <span className="cx-desk-scene-name mono">{scene.name}</span>
                        <span className="cx-desk-scene-sub">
                          {[scene.what, scene.rooms.map((room) => room.name).join(' + ')].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                    <button type="button" className="cx-desk-word mono" onClick={() => forget(scene.id)}>
                      forget
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* A refusal is information, not an error state: it says why the house cannot do what was
          asked, in terms of the equipment. */}
      {rejected.length > 0 && (
        <p className="cx-rooms-note">
          {rejected.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      )}
    </div>
  );
}
