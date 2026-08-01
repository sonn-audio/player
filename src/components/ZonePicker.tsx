/**
 * The room list.
 *
 * Zones are first-class here rather than a setting: a multiroom player's primary question
 * is "which room", so the list is always visible and always live. It doubles as a status
 * board — every row shows what that room is playing, from the same SSE feed.
 *
 * Group membership is drawn as a badge rather than by nesting rows. `group.members` lists
 * the leader first, so a member can show which room it is following without the list
 * reordering itself every time someone groups two rooms.
 */
import { useEffect, useRef, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import { ItemCover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { describeFormat } from '@/components/StreamFormat';
import type { ApiZoneState } from '@/api/types';

export function ZonePicker({
  zones,
  selectedId,
  onSelect,
}: {
  zones: ApiZoneState[];
  selectedId: number | null;
  onSelect: (zoneId: number) => void;
}) {
  const { status } = useServer();

  if (zones.length === 0) {
    return (
      <div className="zone-list empty">
        {status === 'open'
          ? 'This server has no zones configured yet.'
          : 'Connecting to the server…'}
      </div>
    );
  }

  return (
    <ul className="zone-list">
      {zones.map((zone) => (
        <ZoneRow
          key={zone.id}
          zone={zone}
          zones={zones}
          selected={zone.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

/**
 * The same room list, as a control that states the current room and opens on demand.
 *
 * This is the header's shape rather than the rail's. The room being controlled has to be visible
 * at all times — every action on the page is scoped to it — but the *other* rooms only matter at
 * the moment of switching, and a permanently expanded list in the chrome pushes the content down
 * for information nobody is reading. So the trigger carries the answer and the popover carries
 * the choice, reusing `ZoneRow` so the rows cannot drift from the rail's.
 */
export function ZoneMenu({
  zones,
  selectedId,
  onSelect,
}: {
  zones: ApiZoneState[];
  selectedId: number | null;
  onSelect: (zoneId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const selected = zones.find((zone) => zone.id === selectedId) ?? null;

  // Close on an outside click or Escape. Both, because a menu that only closes by re-clicking
  // its own trigger is a menu people leave open by accident.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="zone-menu" ref={wrapper}>
      <button
        type="button"
        className="zone-menu-trigger"
        data-open={open || undefined}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon name="speaker" />
        <span className="zone-menu-text">
          <span className="zone-menu-name">{selected?.name ?? 'No room'}</span>
          {/* What that room is doing, so the trigger is a status line and not just a label. */}
          <span className="zone-menu-sub">
            {selected?.track?.title ||
              (selected?.powerState.power === 'off' ? 'Off' : selected ? 'Idle' : 'Pick a room')}
          </span>
        </span>
        <Icon name="chevron-down" className="zone-menu-caret" />
      </button>

      {open && (
        <div className="zone-menu-pop" role="menu">
          <ul className="zone-list">
            {zones.map((zone) => (
              <ZoneRow
                key={zone.id}
                zone={zone}
                zones={zones}
                selected={zone.id === selectedId}
                onSelect={(id) => {
                  onSelect(id);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ZoneRow({
  zone,
  zones,
  selected,
  onSelect,
}: {
  zone: ApiZoneState;
  zones: ApiZoneState[];
  selected: boolean;
  onSelect: (zoneId: number) => void;
}) {
  const grouped = zone.group !== null;
  const isLeader = grouped && zone.group!.leader === zone.id;
  const leaderName = grouped
    ? (zones.find((candidate) => candidate.id === zone.group!.leader)?.name ?? '')
    : '';

  // `output.device.connected` is reported whether or not the zone is playing, so an
  // unreachable player is visible before someone presses play and hears nothing.
  const offline = zone.output?.device?.connected === false;

  return (
    <li>
      <button
        type="button"
        className="zone-row"
        data-selected={selected || undefined}
        data-playing={zone.state === 'playing' || undefined}
        onClick={() => onSelect(zone.id)}
      >
        <ItemCover url={zone.track?.coverUrl ?? ''} className="tiny" />
        <span className="zone-row-text">
          <span className="zone-row-name">
            <span className="zone-row-label">{zone.name}</span>
            {grouped && (
              <span className="badge" title={isLeader ? 'Group leader' : `Following ${leaderName}`}>
                <Icon name="group" />
                {isLeader ? zone.group!.members.length : leaderName}
              </span>
            )}
            {offline && (
              <span className="badge warn" title="This zone’s player is not connected">
                offline
              </span>
            )}
          </span>
          <span className="zone-row-sub">
            {zone.track?.title || (zone.powerState.power === 'off' ? 'Off' : 'Idle')}
          </span>
          {/* Codec, rate and depth — one line, and it answers "which room is getting the
              lossless feed" at a glance. Shares `describeFormat` with the now-playing view so
              the two cannot drift; the bitrate is deliberately not here, since a per-second
              reading has no business in a list. */}
          {zone.format?.output && (
            <span className="zone-row-format">{describeFormat(zone.format.output)}</span>
          )}
        </span>
        <span className="zone-row-state">{zone.state === 'playing' ? '▶' : ''}</span>
      </button>
    </li>
  );
}
