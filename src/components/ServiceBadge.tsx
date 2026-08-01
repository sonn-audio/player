/**
 * Which service a result came from.
 *
 * Search asks every provider at once and returns them interleaved inside each kind bucket, so
 * "Lana Del Rey" yields Apple Music and SoundCloud rows side by side. Without a mark they are
 * indistinguishable, and the difference matters: it decides the audio quality, whether the
 * artwork is real, and whether an account is involved.
 *
 * The logos are the server's own — `/admin/providers/*.svg`, the same assets the admin UI uses
 * — rather than redrawn here. Real brand marks are recognised pre-attentively in a way a
 * generic glyph never is, and reusing them means one place to update.
 *
 * `service` is an open set: it is whatever `ApiBrowseItem.service` says, and a provider added
 * server-side must not need a change here. So an unknown id falls back to its own initial on a
 * neutral chip — legible and honest, rather than a broken image or nothing at all.
 */
import { useState } from 'react';

/**
 * Service id → logo file under `/admin/providers/`.
 *
 * Keyed on the ids `/api/v1/services` actually reports (`applemusic`, `soundcloud`), with the
 * spellings the adminui uses kept alongside so the two cannot disagree about a provider.
 */
const LOGOS: Record<string, string> = {
  applemusic: 'apple-music.svg',
  soundcloud: 'soundcloud.svg',
  tidal: 'tidal.svg',
  deezer: 'deezer.svg',
  ytmusic: 'youtube-music.svg',
  youtube: 'youtube.svg',
  musicassistant: 'music-assistant.png',
  // No `spotify` entry: the server ships no spotify asset, and a mapping to a file that does
  // not exist is a broken image rather than a missing one. It falls back to the letter chip
  // until an asset is added, and the `onError` below covers the same mistake generally.
};

/**
 * Services that are not streaming services.
 *
 * The local library and the radio directory are first-class content sources but have no brand,
 * so they get a lettered chip rather than a logo. Listing them explicitly keeps them out of the
 * "unknown provider" path, which would otherwise imply something is missing.
 */
const UNBRANDED = new Set(['library', 'radio', 'local']);

/** Where the server serves the shared provider assets from. */
const LOGO_BASE = '/admin/providers/';

export function serviceLogoUrl(service: string): string | null {
  const file = LOGOS[service.toLowerCase()];
  return file ? `${LOGO_BASE}${file}` : null;
}

/**
 * Guesses a service id from a display name.
 *
 * Needed because a **zone** does not report one: `source.name` is a label chosen for humans
 * ("Apple Music", a station's name, a line-in's label) and there is no `source.service`. Browse
 * items do carry the id, so this is only for the now-playing line.
 *
 * Deliberately a normalise-and-lookup rather than a fuzzy match: anything that is not exactly a
 * known provider falls through to the letter chip, which is the right answer for a radio station
 * or a turntable — those genuinely are not streaming services.
 */
export function sourceServiceId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function ServiceBadge({
  service,
  label,
  className,
}: {
  /** Provider id, from `item.service`. */
  service: string;
  /**
   * Display name when known — `GET /services` has it; a bare item only carries the id.
   *
   * Explicitly `| undefined` rather than just optional: the caller looks this up in a map that
   * can miss (a provider added server-side since `/services` was read), and the id is a
   * perfectly good fallback.
   */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const name = label || service;

  /*
   * Nothing to show without a name.
   *
   * The letter chip is the right fallback for a source that is genuinely not a streaming service
   * (a station, a turntable), but only when there is a letter to put in it. Some sources arrive
   * with an empty `name` — the local library is one — and an empty chip
   * renders as a small dark square beside the track, which reads as a broken image rather than as
   * "no provider".
   */
  if (!name.trim()) {
    return null;
  }
  const mapped = UNBRANDED.has(service.toLowerCase()) ? null : serviceLogoUrl(service);
  const logo = logoFailed ? null : mapped;

  return (
    <span className={`service-badge ${className ?? ''}`} title={name}>
      {logo ? (
        // `alt` is empty and the name is on the wrapper's `title`: the logo is decorative
        // reinforcement of a label that is already there, so announcing it twice is noise.
        <img
          src={logo}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          // A logo this build maps but the server does not ship degrades to the letter chip,
          // rather than leaving a broken-image glyph beside every row of that provider.
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="service-badge-letter" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="service-badge-name">{name}</span>
    </span>
  );
}
