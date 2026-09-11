/**
 * From the record that is playing to the page it came from.
 *
 * The contract carries a track's album and artist as *names*, not as ids: `ApiTrack` has
 * `title`/`artist`/`album`, and the zone's source id is the provider's handle for the audio, which the
 * catalogue's `/items/{id}` does not answer for. So the way from a playing record to its album page is
 * a search — by name, in the service the record is playing from, which the server answers in about a
 * third of a second and which lands exactly on anything the provider has a page for.
 *
 * Resolved in the background as the record changes and cached for the session by service, kind and
 * name, so an album's twelve tracks resolve it once. The words on the page only become doors when
 * there is somewhere to go: a door that leads nowhere is worse than plain type. A live source has no
 * album to go to, and a service that cannot search simply answers nothing.
 */
import { useEffect, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import type { ContentItem, ContentKind, ContentService } from '@/api/content';
import type { ApiZoneState } from '@/api/types';

/** How long the record has to stay put before we go looking, so skipping does not storm the server. */
const SETTLE_MS = 400;

const cache = new Map<string, Promise<ContentItem | null>>();

const norm = (value: string): string => value.trim().toLowerCase();

/**
 * The best of what the search answered, or nothing.
 *
 * Strict on purpose. Four records are called `Carry On` and only one of them is Chris Cornell's; a
 * door that opens the wrong record is worse than a word that is not a door, because it is wrong
 * silently. So an album has to carry the right artist's name and an artist has to be called exactly
 * what the record says they are called. Providers rank their own catalogue well, but ranking is not
 * identity.
 */
function pick(items: ContentItem[], name: string, artist?: string): ContentItem | null {
  const named = items.filter((item) => norm(item.name) === norm(name));
  if (!artist) {
    return named[0] ?? null;
  }
  const byArtist = (pool: ContentItem[]): ContentItem | undefined =>
    pool.find((item) => item.artist && norm(item.artist) === norm(artist));
  /* The record's own name and the right artist; failing that, the right artist under a name the
     provider spells differently (`… (Deluxe)`), which is still that artist's record. */
  return byArtist(named) ?? byArtist(items) ?? null;
}

/**
 * The container a name stands for, in one service, or null while it is being looked up (and when
 * there is none).
 */
export function useResolved(
  kind: 'album' | 'artist',
  name: string | undefined,
  service: string | undefined,
  artist?: string | undefined,
): ContentItem | null {
  const { content } = useServer();
  const [found, setFound] = useState<ContentItem | null>(null);
  /* The artist is part of the question, not a tie-break applied after the fact — see `pick`. */
  const key = name && service ? `${service}|${kind}|${norm(name)}|${artist ? norm(artist) : ''}` : null;

  useEffect(() => {
    setFound(null);
    if (!key || !name || !service || !content.available) {
      return undefined;
    }
    let live = true;
    /* Cached answers land at once; an unknown one waits out the settle so a run of skips asks once. */
    const hit = cache.get(key);
    const start = (): void => {
      const lookup =
        cache.get(key) ??
        content
          .search(name, { kinds: [kind as ContentKind], services: [service], limit: 12 })
          .then((result) => pick(result.items[kind] ?? [], name, artist))
          .catch(() => null);
      cache.set(key, lookup);
      void lookup.then((item) => {
        if (live) {
          setFound(item);
        }
      });
    };
    if (hit) {
      start();
      return () => {
        live = false;
      };
    }
    const timer = window.setTimeout(start, SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `artist` only sharpens the pick for a name we are already looking up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, content]);

  return found;
}

/**
 * Which service a room is playing from.
 *
 * The zone's source names the service in words (`Apple Music`) and prefixes its id with the service's
 * own handle (`applemusic:track:…`) — except where it does not (a Spotify source is `track:…`), so
 * both are tried against the catalogue's own list.
 */
export function serviceOf(zone: ApiZoneState | null | undefined, services: ContentService[]): string | undefined {
  const source = zone?.source;
  if (!source) {
    return undefined;
  }
  const byName = services.find((service) => service.name === source.name);
  if (byName) {
    return byName.id;
  }
  const prefix = source.id?.includes(':') ? source.id.split(':')[0] : undefined;
  return services.find((service) => service.id === prefix)?.id;
}
