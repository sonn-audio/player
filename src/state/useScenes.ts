/**
 * Scenes: a moment in the house, saved and replayed in one press.
 *
 * "Dinner" is not a track — it is the kitchen and the living room in step, that playlist, at
 * *that* volume. Every part of it already exists in the contract: `PUT /zones/{id}/group` builds
 * the room set, `PUT /zones/{id}/volume` sets each level, and `POST /zones/{id}/play` with a
 * stored `source.id` replays the music — the contract explicitly promises that id is safe to
 * store and hand back later. A scene is nothing but those three calls with remembered arguments,
 * which is why recalling one needs no new server capability at all.
 *
 * Stored **in this browser**, not on the server. The API has no store for client preferences —
 * a real finding, and the honest answer until it grows one is the same place the selected room
 * and the face choice already live. The consequence is stated rather than hidden: scenes made on
 * the kitchen panel are the kitchen panel's. (`storage` events keep two tabs of the *same*
 * browser agreeing, since a wall panel and a phone are never the same browser anyway.)
 *
 * What a scene deliberately does not save: repeat, shuffle, EQ, power. Those are settings of a
 * room, not of a moment — a scene that silently rewrote the equalizer would be doing more than
 * anyone pressing "save this moment" meant by it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useApi } from '@/state/ServerContext';
import type { ApiClient } from '@/api/client';
import type { ApiZoneState } from '@/api/types';

const STORAGE_KEY = 'sonn.player.scenes';

/** One room's part in a scene. `name` is kept for display, so a listed scene never needs a lookup. */
export type SceneRoom = {
  id: number;
  name: string;
  volume: number;
};

export type Scene = {
  id: string;
  /** What the person called the moment. */
  name: string;
  /** What it plays, for the sub-line: "So What — Miles Davis", a station name. */
  what: string;
  /** The leader's `source.id` at capture — the opaque handle `play` accepts back. */
  uri: string;
  /** The leader's artwork at capture. May go stale; a stale sleeve still names the record. */
  coverUrl: string;
  /** Leader first, then the rooms playing along, each at the volume it had. */
  rooms: SceneRoom[];
};

// --- the store ---------------------------------------------------------------
//
// Module-level for the same reason `useLocalPlayback`'s live state is: there is one list per
// browser, read from more than one component (the rooms sheet, the quiet-house welcome), and
// per-component copies would disagree the moment one of them saved.

function load(): Scene[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Enough validation to survive a hand-edited or older payload; a malformed entry is
    // dropped rather than letting one bad row take the whole list down.
    return parsed.filter(
      (entry): entry is Scene =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Scene).id === 'string' &&
        typeof (entry as Scene).name === 'string' &&
        typeof (entry as Scene).uri === 'string' &&
        Array.isArray((entry as Scene).rooms) &&
        (entry as Scene).rooms.length > 0,
    );
  } catch {
    // Private-mode Safari throws; broken JSON parses like broken JSON. Either way: no scenes.
    return [];
  }
}

let scenes: Scene[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const notify of listeners) {
    notify();
  }
}

function replace(next: Scene[]): void {
  scenes = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not persisting only costs the list on the next load; this tab keeps working.
  }
}

let watchingStorage = false;

function subscribe(notify: () => void): () => void {
  // Another tab of this browser saving a scene should show up here without a reload. Attached
  // on first subscription rather than at import, so merely importing the module stays inert.
  if (!watchingStorage) {
    watchingStorage = true;
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        scenes = load();
        emit();
      }
    });
  }
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function getScenes(): Scene[] {
  return scenes;
}

// --- capture & recall --------------------------------------------------------

/**
 * Whether this moment can be a scene at all: the leader must carry a `source.id`, because that
 * id is the only thing the contract lets a client store and replay. A line-in or an AirPlay
 * stream has none — there is nothing to start again later.
 */
export function sceneable(leader: ApiZoneState | null): boolean {
  return Boolean(leader?.source?.id);
}

/** The moment, read off the live zones. Null when the leader has nothing replayable. */
function captureFrom(leader: ApiZoneState, zones: ApiZoneState[], name: string): Scene | null {
  const uri = leader.source?.id;
  if (!uri) {
    return null;
  }
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const memberIds = leader.group?.members ?? [leader.id];
  const rooms = memberIds
    .map((id) => byId.get(id))
    .filter((zone): zone is ApiZoneState => Boolean(zone))
    .map((zone) => ({ id: zone.id, name: zone.name, volume: zone.volume }));
  if (rooms.length === 0) {
    return null;
  }
  const track = leader.track;
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    // The sub-line: the track when there is one, else the source's own name (a station that
    // has not sent metadata yet is still worth naming).
    what: track
      ? [track.title, track.artist].filter(Boolean).join(' — ')
      : (leader.source?.name ?? ''),
    uri,
    coverUrl: track?.coverUrl ?? '',
    rooms,
  };
}

/**
 * The three calls, in the order that sounds right.
 *
 * Group first, so the music lands in every room of the scene from its first note. Volumes
 * second and *before* play, so nothing blasts at last night's level and then ducks. Play last.
 *
 * Best-effort on purpose: a room that has left the house since capture makes its own call fail
 * (`setGroup` reports it in `rejected`, a volume write 404s) and the rest of the scene is still
 * worth having — so partial failures are ridden over and only a failure to *play* is an error,
 * because a scene that stays silent did not happen.
 */
async function recallScene(api: ApiClient, scene: Scene): Promise<void> {
  const leader = scene.rooms[0];
  if (!leader) {
    return;
  }
  try {
    if (scene.rooms.length > 1) {
      await api.setGroup(leader.id, scene.rooms.map((room) => room.id));
    } else {
      // A solo scene means *alone*: recalled onto a currently-grouped room it must release the
      // others, or "jazz in the study" quietly becomes "jazz everywhere the study was grouped".
      await api.ungroup(leader.id);
    }
  } catch {
    // The grouping is the scene's shape, not its substance; keep going.
  }
  await Promise.allSettled(scene.rooms.map((room) => api.setVolume(room.id, room.volume)));
  await api.play(leader.id, scene.uri);
}

// --- the hook ----------------------------------------------------------------

export function useScenes(): {
  scenes: Scene[];
  /** Saves the leader's current moment under `name`. Null when there is nothing replayable. */
  save: (leader: ApiZoneState, zones: ApiZoneState[], name: string) => Scene | null;
  recall: (scene: Scene) => Promise<void>;
  forget: (id: string) => void;
} {
  const api = useApi();
  const list = useSyncExternalStore(subscribe, getScenes, getScenes);

  const save = useCallback((leader: ApiZoneState, zones: ApiZoneState[], name: string) => {
    const scene = captureFrom(leader, zones, name);
    if (scene) {
      replace([...scenes, scene]);
      emit();
    }
    return scene;
  }, []);

  const recall = useCallback((scene: Scene) => recallScene(api, scene), [api]);

  const forget = useCallback((id: string) => {
    replace(scenes.filter((scene) => scene.id !== id));
    emit();
  }, []);

  return { scenes: list, save, recall, forget };
}
