/**
 * The house, as faders — and the sheet where you group it.
 *
 * `ChannelsStrip` is the desktop's one concession to being a multiroom player: every group in the
 * house as a vertical fader with the artwork it is playing, along the bottom, always. Its point is
 * that changing the kitchen's volume must not cost you the room you are looking at — the strip is a
 * control surface, not a status board, which is why every cell is draggable rather than clickable
 * only.
 *
 * Cells scale with activity (playing rooms get a taller track and a bigger chip, silent ones
 * recede), because a strip where eight rooms all shout equally is a strip nobody reads. A group is
 * drawn as one run of cells under a bracket, so "these three are one thing" is visible without a
 * label saying so.
 *
 * `RoomsSheet` is where grouping actually happens. Grouping is the one operation in this player that
 * can be *refused* — the server matches output protocols unless mixed groups are enabled — so the
 * sheet reports what was rejected instead of silently dropping a room.
 */
import { useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { zoneCoverCss } from '@/art/cover';
import { useVolumeControl } from '@/art/volume';
import { Bars, EmptyArtGlyph, SpeakerGlyph } from '@/art/glyphs';
import type { Channel } from '@/art/useCur';
import type { ApiZoneState } from '@/api/types';

// --- the strip --------------------------------------------------------------

/** One fader plus its chip: a group, or a single room. */
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
  /** Playing → paused → silent, which is what the cell's size is keyed off. */
  const activity = playing ? 'playing' : channel.hasTrack ? 'paused' : 'silent';

  const leaderIsThis = channel.leader.id === zone.id;
  const cover = zoneCoverCss(api, channel.leader, 160);
  const progress =
    channel.leader.duration > 0 ? Math.min(1, channel.leader.position / channel.leader.duration) : 0;

  return (
    <div className="cx-ch" data-current={current || undefined} data-activity={activity}>
      <span className="cx-fader" onPointerDown={control.onPointerDownV}>
        <span className="cx-fader-ro mono" data-show={control.active || undefined}>
          {control.value}
        </span>
        <span className="cx-fader-track">
          <span className="cx-fader-fill" style={{ height: control.pct }}>
            {/* The shimmer at the top of a playing fader's fill — a VU flicker, not a spinner. It
                exists only while audio is actually flowing, so a still strip means a quiet house. */}
            {playing && <span className="cx-fader-vu" />}
            <span className="cx-fader-cap" />
          </span>
        </span>
      </span>

      {/* Only the leader carries the artwork chip: a follower is playing the same thing, and three
          copies of one cover reads as three different rooms playing three different tracks. */}
      <button type="button" className="cx-ch-chip-btn" onClick={onSelect} title={zone.name}>
        {leaderIsThis && cover ? (
          <span className="cx-ch-chip" style={{ backgroundImage: cover }}>
            {progress > 0 && (
              <span className="cx-ch-prog">
                <i style={{ width: `${progress * 100}%` }} />
              </span>
            )}
          </span>
        ) : (
          <span className="cx-ch-chip cx-ch-chip-empty">
            {leaderIsThis ? <EmptyArtGlyph size={16} /> : <SpeakerGlyph size={14} />}
          </span>
        )}
        <span className="cx-ch-name mono">{zone.name}</span>
      </button>
    </div>
  );
}

export function ChannelsStrip({
  channels,
  currentLeaderId,
  onSelect,
}: {
  channels: Channel[];
  currentLeaderId: number | null;
  onSelect: (zoneId: number) => void;
}) {
  if (channels.length === 0) {
    return null;
  }
  return (
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
  );
}

// --- the rooms sheet --------------------------------------------------------

/**
 * One room in the sheet — and the idea the whole sheet is built on: **the volume is the rule under the
 * room's name.**
 *
 * This was a rounded, filled panel with an accent bar down its left edge and a separate slider widget
 * inside it, in a face whose first rule is that nothing is boxed. Every room was a card and the sheet was
 * a stack of cards. What a room actually needs is its name, what it is doing, and how loud — and the
 * third of those can *be* the line that separates it from the next room, which removes a widget and a
 * divider at once. Drag anywhere along the 20px strip at the bottom of the row.
 *
 * The fill stays neutral on purpose (see this file's own note): a fader is furniture. What marks the room
 * you are in is that its name is the brightest text in the sheet and it carries the accent dot — the same
 * way every other selection in this face is expressed.
 *
 * The slider must stop the row's click, or adjusting the kitchen's volume also moves you into the
 * kitchen, which is a different room than the one you were adjusting from.
 */
function RoomRow({
  zone,
  selected,
  playingLabel,
  live,
  onSelect,
  action,
}: {
  zone: ApiZoneState;
  selected: boolean;
  playingLabel: string;
  /** Audio is actually flowing here — the bars move rather than the row being merely marked. */
  live: boolean;
  onSelect: () => void;
  action?: React.ReactNode;
}) {
  const api = useApi();
  const control = useVolumeControl(zone);
  const cover = zoneCoverCss(api, zone, 120);

  return (
    <div className="cx-room" data-selected={selected || undefined}>
      {/*
       * The whole row selects the room — as one flat button underneath it rather than a wrapper around
       * the text, because the text is laid out by the row's own grid and a wrapper would have to be
       * `display: contents` to stay out of it, which browsers treat inconsistently on form controls.
       * The labels are `pointer-events: none` so a click on the name lands here; the volume strip and
       * the join link sit above it and keep their own.
       */}
      <button type="button" className="cx-room-hit" onClick={onSelect} aria-label={zone.name} />

      <span className="cx-room-art" style={{ backgroundImage: cover }} data-empty={!cover || undefined}>
        {!cover && <SpeakerGlyph size={15} />}
      </span>
      <span className="cx-room-name">
        {live && <Bars className="cx-bars cx-room-bars" />}
        {zone.name}
      </span>
      <span className="cx-room-state">{playingLabel}</span>

      <span className="cx-room-num mono" data-active={control.active || undefined}>
        {control.value}
      </span>
      <span className="cx-room-act">{action}</span>

      <span
        className="cx-room-vol"
        data-active={control.active || undefined}
        onPointerDown={(event) => {
          event.stopPropagation();
          control.onPointerDownH(event);
        }}
      >
        <span className="cx-room-rail">
          <span className="cx-room-fill" style={{ width: control.pct }} />
          <span className="cx-room-knob" style={{ left: control.pct }} />
        </span>
      </span>
    </div>
  );
}

/** What a room is doing, in the words someone standing in it would use. */
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

export function RoomsSheet({
  zones,
  selectedId,
  onSelect,
}: {
  zones: ApiZoneState[];
  selectedId: number | null;
  onSelect: (zoneId: number) => void;
}) {
  const api = useApi();
  const selected = zones.find((zone) => zone.id === selectedId) ?? null;
  const [rejected, setRejected] = useState<string[]>([]);

  const group = selected?.group ?? null;
  const members = group
    ? group.members.map((id) => zones.find((zone) => zone.id === id)).filter((zone): zone is ApiZoneState => Boolean(zone))
    : selected
      ? [selected]
      : [];
  const others = zones.filter((zone) => !members.some((member) => member.id === zone.id));

  /**
   * Adds a room to the selected room's group.
   *
   * The leader is always the room you are looking at: `PUT /zones/{id}/group` puts that id at the
   * head, so grouping *from* the kitchen means the kitchen's music continues and the others join it
   * — which is what someone pressing "+" in the kitchen means, every time.
   */
  const add = (zone: ApiZoneState): void => {
    if (!selected) {
      return;
    }
    const next = [...members.map((member) => member.id), zone.id];
    void api
      .setGroup(selected.id, next)
      .then((result) => {
        setRejected(
          result.rejected.map(
            (entry) =>
              /*
               * In the words someone standing in the room would use.
               *
               * This said `different output type — cannot play in sync`, which names a fact about the
               * equipment rather than about the music, and "output type" is the other face's vocabulary.
               * What actually happened is that these two rooms cannot be kept in step, and the useful
               * half of that is: play it there on its own instead.
               */
              `${zones.find((candidate) => candidate.id === entry.id)?.name ?? entry.id}: ${
                entry.reason === 'protocol-mismatch'
                  ? 'these speakers can’t stay in step with this room — play it there on its own'
                  : 'not there any more'
              }`,
          ),
        );
      })
      .catch(() => setRejected(['That did not work — the room may have gone.']));
  };

  const remove = (zone: ApiZoneState): void => {
    if (!selected) {
      return;
    }
    // Removing the leader is ungrouping the whole thing; there is no "promote a follower" in the
    // contract and inventing one here would be a client-side group the server does not have.
    if (zone.id === selected.id) {
      void api.ungroup(selected.id);
      return;
    }
    const next = members.filter((member) => member.id !== zone.id).map((member) => member.id);
    void api.setGroup(selected.id, next.length > 1 ? next : []);
  };

  const grouped = members.length > 1;

  return (
    <div className="cx-rooms">
      {/*
       * Grouped rooms are drawn as one object: a bracket down their left edge, in the accent.
       *
       * The old sheet said so with a heading — `playing together` over a run of identical cards — which
       * is a caption for a relationship the eye could have been shown directly. The bracket is the same
       * device the desktop strip uses for a group of faders, so "these three are one thing" means the
       * same thing in both places.
       *
       * The heading only survives *because* of the group: it is where `ungroup` lives, and there is
       * nowhere better for it. Ungrouped, the room you are in is simply the first row and is marked as
       * such, so it gets no heading at all — a two-room house had three labels for two rooms.
       */}
      {selected && grouped && (
        <div className="cx-sec-head cx-rooms-head">
          <span className="cx-sec-lbl mono">playing together</span>
          <span className="cx-sec-rule" />
          <button type="button" className="mono cx-disband" onClick={() => void api.ungroup(selected.id)}>
            ungroup
          </button>
        </div>
      )}

      {selected && (
        <div className="cx-room-set" data-grouped={grouped || undefined}>
          {members.map((member) => {
            /*
             * Inside a group, only the leader says what is playing.
             *
             * The others are playing the same thing by definition — that is what the bracket down the
             * left edge means — so repeating the title once per room turns a group of three into the
             * same sentence written three times. `in step` is the house's own word for it, the one the
             * refusal message uses when two rooms *cannot* be.
             */
            const follower = grouped && member.id !== (group?.leader ?? selected.id);
            return (
              <RoomRow
                key={member.id}
                zone={member}
                selected={member.id === selected.id}
                playingLabel={follower ? 'in step' : stateLabel(member)}
                live={member.state === 'playing' && Boolean(member.track)}
                onSelect={() => onSelect(member.id)}
                action={
                  // Only a follower can leave; the leader leaving *is* ungrouping, which the head owns.
                  follower ? (
                    <button type="button" className="cx-room-link mono" onClick={() => remove(member)}>
                      release
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <>
          <div className="cx-sec-head cx-rooms-head">
            <span className="cx-sec-lbl mono">elsewhere</span>
            <span className="cx-sec-rule" />
          </div>

          {others.map((zone) => (
            <RoomRow
              key={zone.id}
              zone={zone}
              selected={false}
              playingLabel={stateLabel(zone)}
              live={zone.state === 'playing' && Boolean(zone.track)}
              onSelect={() => onSelect(zone.id)}
              action={
                selected ? (
                  /*
                   * A word, not a circled play triangle.
                   *
                   * The triangle meant "play what this room is playing, there too", which is not what a
                   * triangle means anywhere else in this player — everywhere else it starts the thing it
                   * is drawn on. `join` says the actual operation, and it is the only word in the sheet
                   * that carries the accent because it is the only one with a consequence.
                   */
                  <button
                    type="button"
                    className="cx-room-link mono"
                    data-accent
                    onClick={() => add(zone)}
                    title={`Play ${selected.name} here too`}
                  >
                    join
                  </button>
                ) : undefined
              }
            />
          ))}
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
