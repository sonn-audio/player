/**
 * What is inside a folder, fetched so the folder can be drawn as its contents.
 *
 * A service root is a listing of *navigation*: seven browsable folders that carry no artwork,
 * because "Popular Playlists" is not a record and has no sleeve. Drawn as covers they are seven
 * identical empty squares — the page says nothing about the music behind it. So the folder is
 * asked what it holds, and the answer is what gets drawn: a shelf of real artwork, or a mosaic of
 * the first four sleeves on the tile itself.
 *
 * Two things make that affordable:
 *
 *  - **One cache for the whole session, keyed by id and limit.** A shelf and a tile mosaic asking
 *    about the same folder share one request, and walking back up the tree redraws from memory
 *    instead of asking Spotify again. Browse ids are opaque but stable, so they are a sound key.
 *  - **In-flight requests are shared,** so the two consumers above racing on mount produce one
 *    call rather than two. Without this, mounting a page of shelves is a burst of duplicates.
 *
 * Never a spinner's worth of state: a folder that has not been asked yet and a folder that came
 * back empty are different (`state`), because an empty shelf should say so and a pending one
 * should not.
 */
import { useEffect, useState } from 'react';
import { useServer } from '@/state/ServerContext';
import type { ContentItem, ContentSource } from '@/api/content';

export type FolderPreview = {
  items: ContentItem[];
  /** How many the folder holds, or null when the provider cannot count. */
  total: number | null;
  state: 'idle' | 'loading' | 'ready';
};

const IDLE: FolderPreview = { items: [], total: null, state: 'idle' };

type Cached = { items: ContentItem[]; total: number | null };

const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<Cached>>();

function load(content: ContentSource, id: string, limit: number): Promise<Cached> {
  const key = `${id}#${limit}`;
  const hit = cache.get(key);
  if (hit) {
    return Promise.resolve(hit);
  }
  const running = inFlight.get(key);
  if (running) {
    return running;
  }
  const request = content
    .browse(id, 0, limit)
    .then((page) => {
      const result: Cached = { items: page.items, total: page.total };
      cache.set(key, result);
      return result;
    })
    /*
     * A provider that fails is remembered as empty rather than left uncached.
     *
     * `HttpContentSource.browse` already swallows the failure into an empty listing, so this only
     * catches a source that throws — but either way the folder must not become a retry loop that
     * hammers a provider which is down every time a shelf scrolls past.
     */
    .catch((): Cached => {
      const result: Cached = { items: [], total: null };
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/**
 * The first `limit` children of `id`, once `enabled`.
 *
 * `enabled` is how the caller defers work it cannot yet justify — a shelf below the fold, a
 * mosaic in a listing too long to preview. Passing `false` costs one render and no request.
 */
export function useFolderPreview(id: string, limit: number, enabled = true): FolderPreview {
  const { content } = useServer();
  const key = `${id}#${limit}`;
  const [preview, setPreview] = useState<FolderPreview>(() => {
    const hit = cache.get(key);
    return hit ? { ...hit, state: 'ready' } : IDLE;
  });

  useEffect(() => {
    if (!enabled || !id) {
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      // Straight from memory, without a frame of "loading" between two identical pictures.
      setPreview({ ...hit, state: 'ready' });
      return;
    }
    let live = true;
    setPreview({ items: [], total: null, state: 'loading' });
    void load(content, id, limit).then((result) => {
      if (live) {
        setPreview({ ...result, state: 'ready' });
      }
    });
    return () => {
      live = false;
    };
  }, [content, id, limit, enabled, key]);

  return preview;
}
