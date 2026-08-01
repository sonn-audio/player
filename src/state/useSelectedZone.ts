/**
 * Which zone the UI is pointed at.
 *
 * The player's one piece of genuinely local state: the server has no concept of "the zone
 * this browser tab is looking at", and should not — that is a property of the client, not
 * of the installation. Persisted per browser so a reload comes back to the same room.
 *
 * Zones are addressed by id, which the contract calls stable across restarts. That is what
 * makes a stored selection safe; a name or a list index would not be.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiZoneState } from '@/api/types';

const STORAGE_KEY = 'sonn.player.zone';

function readStored(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const id = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(id) ? id : null;
  } catch {
    // Private-mode Safari throws on localStorage. Selection falls back to the first zone.
    return null;
  }
}

export type SelectedZone = {
  /** The chosen zone, or null while no zone exists yet. */
  zone: ApiZoneState | null;
  zoneId: number | null;
  select: (zoneId: number) => void;
};

/**
 * @param synced whether the server has published its zone list yet. Without it, a stored room that
 * has not arrived yet is indistinguishable from one that no longer exists — see the effect below.
 */
export function useSelectedZone(zones: ApiZoneState[], synced: boolean): SelectedZone {
  const stored = readStored();
  const [zoneId, setZoneId] = useState<number | null>(stored);
  /**
   * Whether a room has been *decided* — stored from a previous visit, or picked in this one.
   *
   * Until it has, the player follows the music (below). After it has, nothing moves the selection
   * except the user or the room disappearing.
   */
  const decided = useRef(stored !== null);

  /*
   * Until someone chooses, land on the room that is playing.
   *
   * Two things make this worth more than "the first zone". The list arrives in pieces — the local
   * browser destination exists on the first render and the server's zones land with the event
   * stream's opening snapshot — so a one-shot "pick zones[0]" ran before the real rooms were even
   * known, and settled on a browser tab that by definition is not playing anything. And in a house
   * with one room going, that room is overwhelmingly the one you meant when you opened the player.
   *
   * Re-picking is bounded on both sides: it stops for good the moment `select` is called, and it
   * only ever moves *away from an idle room*, so a room you are watching is never yanked out from
   * under you because something started elsewhere.
   */
  useEffect(() => {
    if (zones.length === 0) {
      return;
    }
    const current = zones.find((zone) => zone.id === zoneId) ?? null;
    if (current && (decided.current || current.track)) {
      return;
    }
    /*
     * A stored room that has not arrived is not a room that is gone.
     *
     * The list starts with the local browser destination and the server's rooms land with the event
     * stream's opening snapshot, so on every reload there is a window where the remembered id matches
     * nothing. Falling back then handed the player to the browser tab — and because that *is* in the
     * list, the rule below saw a valid selection from then on and never went back. The room the user
     * chose was silently replaced by a tab, on a reload, by a race.
     *
     * So the fallback waits for the server to have said what exists. After that an absent id really
     * is a room that was removed, and moving off it is right.
     */
    if (!current && decided.current && !synced) {
      return;
    }
    const playing = zones.find((zone) => zone.state === 'playing' && zone.track);
    const next = playing ?? current ?? zones[0]!;
    if (next.id !== zoneId) {
      setZoneId(next.id);
    }
  }, [zones, zoneId]);

  const select = useCallback((next: number) => {
    // From here on the selection is the user's, and the follow-the-music rule above stands down.
    decided.current = true;
    setZoneId(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Not persisting is survivable; the selection still works for this session.
    }
  }, []);

  const zone = zones.find((candidate) => candidate.id === zoneId) ?? null;
  return { zone, zoneId: zone?.id ?? null, select };
}
