/**
 * Content browsing: `/services`, `/browse[/{id}]`, `/items/{id}` and `/search`.
 *
 * An `id` is opaque — the same rule as `ApiSource.id`. It may be stored and handed back, but
 * never parsed: its internal form (`b1.c.album.…`) is the server's business and explicitly not
 * part of the contract. Nothing above this file gets to look inside one.
 *
 * Three properties of the real API shape the interface, and each one removes work a client
 * would otherwise have to do:
 *
 *  - **`browsable` and `playable` are independent.** An album is both, an artist is both, a
 *    category is neither-but-openable. So "what does a tap do" is read off the item instead of
 *    inferred from its `kind` — which is what makes a single row component correct everywhere.
 *  - **`total` can be `null`,** meaning the provider genuinely cannot say. That is not the same
 *    as zero, and a client must page until it gets fewer items than it asked for rather than
 *    trusting a count that does not exist.
 *  - **Search is per-kind and per-service.** `searchableKinds` says what a provider can answer,
 *    so a kind is skipped rather than asked-and-ignored, and `services[].failed` says which
 *    provider let you down instead of silently returning less.
 */
import type { ApiClient } from './client';

/**
 * What a row is. Open set — the server documents `unknown` as the escape hatch, so this must
 * never be switched on exhaustively.
 */
export type ContentKind =
  | 'track'
  | 'album'
  | 'artist'
  | 'playlist'
  | 'radio'
  | 'show'
  | 'episode'
  | 'category'
  | 'folder'
  | 'unknown'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** One row in a listing or a search result. */
export interface ContentItem {
  /** Opaque. Hand back to browse, items, or play. Never parse it. */
  id: string;
  name: string;
  kind: ContentKind;
  /** Whether `browse(id)` will list anything inside it. */
  browsable: boolean;
  /** Whether it can be handed to `play`. */
  playable: boolean;
  /** The provider under its own name — `applemusic`, never a bridge disguise. */
  service: string;
  artist?: string;
  album?: string;
  /** Seconds, when known. */
  duration?: number;
  coverUrl?: string;
  animatedCoverUrl?: string;
}

/** A page of children. */
export interface ContentListing {
  /** The container that was listed, or null at the root, which has no id of its own. */
  container: ContentItem | null;
  items: ContentItem[];
  sections?: ContentSection[];
  start: number;
  /**
   * How many children the container holds, or **null when the provider cannot say**.
   * Null is not zero: page until a request returns fewer items than its limit.
   */
  total: number | null;
}

export interface ContentSection {
  id: string;
  name: string;
  items: ContentItem[];
}

/** Search results, bucketed by kind. */
export interface ContentSearchResult {
  query: string;
  /** A kind absent here was not searched — see `ContentService.searchableKinds`. */
  items: Partial<Record<ContentKind, ContentItem[]>>;
  /** Which services answered, and which failed. */
  services: Array<{ service: string; failed?: boolean }>;
}

/** A configured content service, with what it can actually do. */
export interface ContentService {
  id: string;
  name: string;
  /** The id to browse this service's top level. */
  rootId: string;
  /** Which kinds its search returns. Empty means it cannot search at all. */
  searchableKinds: ContentKind[];
}

export type SearchOptions = {
  /** Narrow to these kinds. Omit for everything the services support. */
  kinds?: ContentKind[];
  /** Narrow to these services. Omit to ask all of them. */
  services?: string[];
  limit?: number;
};

/**
 * What a player needs from a content surface.
 *
 * `item()` is the one that earns its place: a client that deep-links, restores a stored id or
 * receives one from elsewhere has no parent listing to take a name from. The server calls it
 * the capability neither Loxone nor Music Assistant has, and it is what lets a favourite or a
 * queue entry be displayed in place rather than only while playing.
 */
export interface ContentSource {
  /** Whether this server has a content API at all. */
  readonly available: boolean;
  services(): Promise<ContentService[]>;
  /** The root listing (the services) when `id` is omitted, otherwise that container's children. */
  browse(id?: string, offset?: number, limit?: number): Promise<ContentListing>;
  /** Describes one id without browsing its parent. Null when it no longer resolves. */
  item(id: string): Promise<ContentItem | null>;
  search(query: string, opts?: SearchOptions): Promise<ContentSearchResult>;
}

/** The empty listing, so callers never branch on null. */
const EMPTY_LISTING: ContentListing = { container: null, items: [], start: 0, total: 0 };

/**
 * `ContentSource` over the real endpoints.
 *
 * Thin on purpose: the wire shapes are already what a UI wants, so there is nothing to
 * normalise. The only judgement here is on failure — a provider timing out mid-browse should
 * leave the UI empty rather than thrown, since a browse tree is a place you navigate out of.
 */
export class HttpContentSource implements ContentSource {
  readonly available = true;

  constructor(private readonly api: ApiClient) {}

  services(): Promise<ContentService[]> {
    return this.api.getServices();
  }

  async browse(id?: string, offset = 0, limit = 100): Promise<ContentListing> {
    try {
      return await this.api.browse(id, offset, limit);
    } catch {
      return EMPTY_LISTING;
    }
  }

  async item(id: string): Promise<ContentItem | null> {
    try {
      return await this.api.item(id);
    } catch {
      // A 404 means the id no longer resolves, which is a normal outcome for a stored id.
      return null;
    }
  }

  async search(query: string, opts: SearchOptions = {}): Promise<ContentSearchResult> {
    try {
      return await this.api.search(query, opts);
    } catch {
      return { query, items: {}, services: [] };
    }
  }
}

/**
 * Stands in when the server has no content API.
 *
 * Kept even though `/api/v1` now has one: a player may be pointed at an older server, and
 * reporting emptiness lets the zone half — which is complete on its own — keep working.
 */
export class UnavailableContentSource implements ContentSource {
  readonly available = false;
  readonly reason =
    'This server does not expose a content API. Browsing and search need /api/v1/browse; ' +
    'until then, start playback from a zone’s favourites, its recents, or an input.';

  async services(): Promise<ContentService[]> {
    return [];
  }

  async browse(): Promise<ContentListing> {
    return EMPTY_LISTING;
  }

  async item(): Promise<ContentItem | null> {
    return null;
  }

  async search(query = ''): Promise<ContentSearchResult> {
    return { query, items: {}, services: [] };
  }
}
