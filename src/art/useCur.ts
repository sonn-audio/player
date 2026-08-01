/**
 * The art player's derived model: one room, as the stage needs it.
 *
 * The technical player reads `ApiZoneState` directly, field by field, because being able to see the
 * wire shape *is* the point over there. The art player wants the opposite — one flat object with
 * everything already decided (is it live, what is the source called, how far through are we, who is
 * playing along) so a component can be markup and nothing else. Every derivation that would
 * otherwise be repeated in the desktop stage, the mobile stage, the mini bar and the room chips
 * happens once here.
 *
 * Two rules from the contract shape all of it:
 *
 *  - **The leader owns playback.** A grouped zone mirrors its leader, so transport, artwork,
 *    position and queue all come from `group.leader`; only volume and the room's own name come from
 *    the zone you selected. Binding a follower's own (stale, zeroed) track fields is the classic
 *    grouping bug, and it looks like the group is broken rather than like the client is.
 *  - **`source.seekable` decides whether there is a timeline** — not `duration === 0`. A live
 *    stream is not a zero-length track, and reading it off the duration makes every station look
 *    like a broken file.
 */
import { useMemo } from 'react';
import { useLiveProgress } from '@/state/useLiveProgress';
import { formatTime } from '@/lib/format';
import type { ApiZoneState } from '@/api/types';

export type Cur = {
  /** The room the UI is pointed at — its name, its volume. */
  zone: ApiZoneState | null;
  /** Where playback actually lives: the group's leader, or the zone itself when solo. */
  leader: ApiZoneState | null;
  name: string;
  hasTrack: boolean;
  isPlaying: boolean;
  /** Radio, a line-in, anything the server says cannot be seeked. */
  isLive: boolean;
  /** Whether to draw a timeline at all. */
  showBar: boolean;
  title: string;
  artist: string;
  album: string;
  /** The provenance line: a station, a service, an input. Uppercased for the mono chip. */
  source: string;
  elapsedSec: number;
  durationSec: number;
  /** `43%`, ready to drop into a `width`. */
  pct: string;
  elapsed: string;
  /** `-2:04`, or empty when there is nothing to count down to. */
  remain: string;
  volume: number;
  volumePct: string;
  /** The zone's own ceiling — sliders run to this, never to 100. */
  volumeMax: number;
  grouped: boolean;
  /** How many *other* rooms are playing along. */
  groupExtra: number;
  shuffle: boolean;
  repeat: boolean;
  /** Why the last attempt failed, when it did. */
  error: string | null;
  /** Motion artwork for the sleeve, when the provider has any. See `art/motion`. */
  motion: string | undefined;
};

const IDLE_TITLE = 'Nothing playing';

/** The room a zone's playback belongs to: its group leader, or itself. */
export function leaderOf(zone: ApiZoneState | null, zones: ApiZoneState[]): ApiZoneState | null {
  if (!zone) {
    return null;
  }
  const leaderId = zone.group?.leader ?? zone.id;
  return zones.find((candidate) => candidate.id === leaderId) ?? zone;
}

export function useCur(zone: ApiZoneState | null, zones: ApiZoneState[]): Cur {
  const leader = useMemo(() => leaderOf(zone, zones), [zone, zones]);

  // Interpolated between the server's once-a-second ticks, so the timeline is smooth without the
  // client ever becoming the authority on where we are.
  const elapsedSec = useLiveProgress(leader);

  return useMemo<Cur>(() => {
    const track = leader?.track ?? null;
    const source = leader?.source ?? null;
    const duration = leader?.duration ?? 0;
    // Clamped, because interpolation can run a fraction past the end between the last tick and the
    // track change that follows it.
    const elapsed = duration > 0 ? Math.min(elapsedSec, duration) : elapsedSec;
    const live = Boolean(source && !source.seekable);
    const members = leader?.group?.members ?? [];
    const max = zone?.volumeLimits.max ?? 100;
    const volume = Math.min(zone?.volume ?? 0, max);

    return {
      zone,
      leader,
      name: zone?.name ?? '',
      hasTrack: Boolean(track),
      isPlaying: leader?.state === 'playing',
      isLive: live,
      showBar: Boolean(track) && !live && duration > 0,
      // A station usually has no track title until the stream's metadata arrives; the source name
      // is the honest stand-in, and it is what the room is actually playing.
      title: track?.title || source?.name || IDLE_TITLE,
      artist: track?.artist ?? '',
      album: track?.album ?? '',
      /*
       * The provenance chip, or nothing at all.
       *
       * `source.kind` is deliberately *not* a fallback: it is a machine word for what the audio is
       * (`track`, `radio`, `linein`) and a chip reading "TRACK" beside a track title says nothing.
       * Several real sources arrive with an empty `name` — a radio station whose metadata has not
       * landed, the local library — and for those the honest render is no
       * chip, which is what an empty string produces here.
       */
      source: (source?.name ?? '').toUpperCase(),
      elapsedSec: elapsed,
      durationSec: duration,
      pct: duration > 0 ? `${Math.max(0, Math.min(100, (elapsed / duration) * 100))}%` : '0%',
      elapsed: formatTime(elapsed),
      remain: duration > 0 ? `-${formatTime(Math.max(0, duration - elapsed))}` : '',
      volume,
      // Percent of the room's *own* range, so a zone capped at 60 still fills its slider.
      volumePct: `${max > 0 ? (volume / max) * 100 : 0}%`,
      volumeMax: max,
      grouped: members.length > 1,
      groupExtra: Math.max(0, members.length - 1),
      motion: track?.animatedCoverUrl,
      shuffle: leader?.shuffle ?? false,
      repeat: (leader?.repeat ?? 'off') !== 'off',
      error: leader?.error ?? zone?.error ?? null,
    };
  }, [zone, leader, elapsedSec]);
}

/**
 * A channel: one group (or one solo room) as the strip and the chip row show it.
 *
 * Built from `group` rather than from a client-side notion of grouping, so what the strip draws is
 * what the server thinks is synchronised. The leader is the identity — selecting a channel means
 * selecting its leader — which is what makes a group act as one cell rather than as three that
 * happen to move together.
 */
export type Channel = {
  leader: ApiZoneState;
  /** Leader first, then followers, in zone order. */
  members: ApiZoneState[];
  /** A short label that is still unique across the strip. */
  short: string;
  playing: boolean;
  hasTrack: boolean;
};

/**
 * Shortens room names for the chip row, keeping them distinguishable.
 *
 * "Living room" and "Living room upstairs" both truncate to "LIVING RO…", which is worse than not
 * shortening at all — so a name only loses its tail while the result stays unique among the others.
 */
function shortName(name: string, all: string[]): string {
  const target = name.trim();
  const others = all.filter((candidate) => candidate !== target);
  for (let length = 4; length < target.length; length += 1) {
    const prefix = target.slice(0, length);
    if (!others.some((other) => other.startsWith(prefix))) {
      return prefix;
    }
  }
  return target;
}

export function channelsOf(zones: ApiZoneState[]): Channel[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const seen = new Set<number>();
  const channels: Channel[] = [];

  for (const zone of zones) {
    const leaderId = zone.group?.leader ?? zone.id;
    if (seen.has(leaderId)) {
      continue;
    }
    seen.add(leaderId);
    const leader = byId.get(leaderId) ?? zone;
    const memberIds = leader.group?.members ?? [leader.id];
    const members = memberIds
      .map((id) => byId.get(id))
      .filter((member): member is ApiZoneState => Boolean(member));
    channels.push({
      leader,
      members: members.length > 0 ? members : [leader],
      short: leader.name,
      playing: leader.state === 'playing',
      hasTrack: Boolean(leader.track),
    });
  }

  const names = channels.map((channel) => channel.leader.name.trim());
  return channels.map((channel) => ({
    ...channel,
    short: shortName(channel.leader.name, names).toUpperCase(),
  }));
}
