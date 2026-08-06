/**
 * The browser's own media surface: the lock screen, the keyboard's media keys, earbuds.
 *
 * A tab that plays music is expected to answer the play button on a headset and to put the
 * artwork on the phone's lock screen. `navigator.mediaSession` is how a page does both, and
 * this hook keeps it pointed at **the zone this face controls** — its metadata, its playback
 * state, its position, and handlers that route each hardware press through the ordinary API
 * commands.
 *
 * Two things are deliberate about how little this does:
 *
 *  - **No optimistic state, here either.** A handler sends the command and nothing else; the
 *    lock screen's play/pause icon follows `zone.state` on the next `zone.changed`, exactly
 *    like every button in the page. The lock screen is just one more client.
 *  - **No silent-audio trick.** Browsers only *surface* these controls while the tab is
 *    genuinely producing sound — which it is when the local destination plays here, and is not
 *    when this tab is merely a remote for another room. Some remotes loop an inaudible file to
 *    claim the media keys anyway; that steals the keys from whatever the person is actually
 *    listening to in another tab, so the metadata is set unconditionally (it costs nothing and
 *    is correct the moment audio starts) and the keys are claimed only when the sound is ours.
 *
 * Which zone to pass is the caller's decision, and it is the group **leader** — a follower
 * mirrors its leader for everything a lock screen shows, and its own track fields can be stale.
 */
import { useEffect } from 'react';
import { useApi } from '@/state/ServerContext';
import type { ApiZoneState } from '@/api/types';

/** Every action this hook may have registered, for symmetric cleanup. */
const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto'];

/**
 * A browser that has never heard of an action throws on `setActionHandler` rather than
 * ignoring it — the same open-set posture the API contract takes with `kind`, so the same
 * answer: accept it and move on.
 */
function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // This browser does not know the action. Nothing to clean up either.
  }
}

export function useMediaSession(zone: ApiZoneState | null): void {
  const api = useApi();
  const session = 'mediaSession' in navigator ? navigator.mediaSession : null;

  const zoneId = zone?.id;
  const track = zone?.track ?? null;
  const sourceName = zone?.source?.name ?? '';
  const seekable = zone?.source?.seekable ?? false;
  const state = zone?.state ?? 'stopped';
  const position = zone?.position ?? 0;
  const duration = zone?.duration ?? 0;

  /*
   * What is playing. Keyed on the track's fields rather than the zone object, which is
   * replaced on every event — rebuilding `MediaMetadata` once a second for an unchanged
   * track makes some lock screens flicker.
   *
   * A station whose stream metadata has not landed yet has a `source.name` and no track;
   * that name is the honest title, the same stand-in `useCur` renders on the stage.
   */
  useEffect(() => {
    if (!session) {
      return;
    }
    if (!track && !sourceName) {
      session.metadata = null;
      return;
    }
    session.metadata = new MediaMetadata({
      title: track?.title || sourceName,
      artist: track?.artist ?? '',
      album: track?.album ?? '',
      // `coverUrl` is the absolute URL the contract hands out; empty string means no artwork,
      // and an empty list is how media session says so. No `sizes` claimed — we do not know them.
      artwork: track?.coverUrl ? [{ src: track.coverUrl }] : [],
    });
  }, [session, track?.title, track?.artist, track?.album, track?.coverUrl, sourceName]);

  /** Whether the platform's play/pause toggle shows a playing or a paused surface. */
  useEffect(() => {
    if (!session) {
      return;
    }
    session.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none';
  }, [session, state]);

  /*
   * The timeline under the lock screen's scrubber.
   *
   * Only for a source the contract says can seek — a live stream has no position to report, and
   * `setPositionState` with a zero duration is a validation error rather than "no bar". Position
   * is clamped for the same reason interpolation clamps it in `useCur`: the last tick can land a
   * fraction past the end.
   */
  useEffect(() => {
    if (!session || typeof session.setPositionState !== 'function') {
      return;
    }
    try {
      if (seekable && duration > 0) {
        session.setPositionState({
          duration,
          position: Math.min(position, duration),
          playbackRate: 1,
        });
      } else {
        session.setPositionState();
      }
    } catch {
      // A state the browser rejects is worth nothing; the metadata above still stands.
    }
  }, [session, seekable, position, duration]);

  /*
   * The keys themselves. Registered per zone id, not per zone object, so a `zone.changed`
   * every second does not re-register six handlers — only switching rooms does.
   */
  useEffect(() => {
    if (!session || zoneId === undefined) {
      return;
    }
    setHandler(session, 'play', () => void api.play(zoneId));
    setHandler(session, 'pause', () => void api.pause(zoneId));
    setHandler(session, 'stop', () => void api.stop(zoneId));
    setHandler(session, 'previoustrack', () => void api.previous(zoneId));
    setHandler(session, 'nexttrack', () => void api.next(zoneId));
    // Absent rather than a no-op when the source cannot seek: an unregistered action is how
    // the platform knows not to draw a scrubber it cannot honour.
    setHandler(
      session,
      'seekto',
      seekable
        ? (details) => {
            if (typeof details.seekTime === 'number') {
              void api.seek(zoneId, details.seekTime);
            }
          }
        : null,
    );
    return () => {
      for (const action of ACTIONS) {
        setHandler(session, action, null);
      }
    };
  }, [session, api, zoneId, seekable]);
}
