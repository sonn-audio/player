/**
 * The `/api/v1` HTTP client.
 *
 * One method per endpoint, and *only* endpoints that exist — no `/admin/api`, no port
 * 7091, no undocumented back doors. That is deliberate: this player doubles as the test
 * of whether the public contract is complete, and a private fallback smuggled in here
 * would hide exactly the gap we are looking for. Anything the API cannot do is reported
 * to the server rather than worked around here.
 *
 * Reading live state does **not** happen here — that is `events.ts`. This class is the
 * command surface plus the collection reads (queue, favourites, recents) that SSE does
 * not carry.
 */
import type {
  ContentAbout,
  ContentItem,
  ContentListing,
  ContentSearchResult,
  ContentService,
  SearchOptions,
} from './content';
import type {
  ApiAlertRequest,
  ApiDestination,
  ApiLocalDestination,
  ApiPlaylist,
  ApiFavorite,
  ApiFavorites,
  ApiGroupResult,
  ApiHealthReport,
  ApiInput,
  ApiQueue,
  ApiReadyReport,
  ApiRecents,
  ApiRepeatMode,
  ApiZoneEqualizer,
  ApiZoneState,
} from './types';

/**
 * A `4xx`/`5xx` from the API, carrying the server's own error code.
 *
 * The contract documents a closed-ish set of codes (`zone-not-found`, `invalid-volume`,
 * …), so `code` is what the UI branches on; `status` is kept for the cases where the
 * code is absent (a proxy error, an HTML 502).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

/** How long a command may take before we give up on it. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Whether a body is the about panel's own shape.
 *
 * The one route this client checks rather than trusts, because it is the one route that may not
 * exist: a proposed surface is answered by servers that predate it, and a wrong 200 there costs
 * a crash instead of a missing panel. `similar` is the field the page indexes into, so it is the
 * field that decides — a body without it is not an about, whatever else it is.
 */
function isAbout(body: unknown): body is ContentAbout {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  return Array.isArray((body as Partial<ContentAbout>).similar);
}

export class ApiClient {
  /** Absolute base without a trailing slash, e.g. `http://host:7090`. */
  private readonly origin: string;

  constructor(origin: string) {
    this.origin = origin.replace(/\/+$/, '');
  }

  /** Where `/api/v1` lives, for building URLs the UI needs directly (cover art). */
  get base(): string {
    return `${this.origin}/api/v1`;
  }

  // --- reading ---------------------------------------------------------------

  async getZones(): Promise<ApiZoneState[]> {
    const { zones } = await this.request<{ zones: ApiZoneState[] }>('GET', '/zones');
    return zones;
  }

  getZone(zoneId: number): Promise<ApiZoneState> {
    return this.request('GET', `/zones/${zoneId}`);
  }

  /** Server-level, not per zone: an input is selectable from anywhere. */
  async getInputs(): Promise<ApiInput[]> {
    const { inputs } = await this.request<{ inputs: ApiInput[] }>('GET', '/inputs');
    return inputs;
  }

  // --- destinations ----------------------------------------------------------

  /**
   * Everywhere audio can be sent: the configured zones, plus **your own** local destination.
   *
   * `clientId` is what makes a tab visible to itself. The list is otherwise zones only — a
   * browser tab is not a room, so it appears in nobody else's list, not in `GET /zones`, and not
   * in the event stream. Send nothing and you get the zones.
   */
  async getDestinations(clientId?: string): Promise<ApiDestination[]> {
    const { destinations } = await this.request<{ destinations: ApiDestination[] }>(
      'GET',
      '/destinations',
      undefined,
      clientId ? { 'X-Sonn-Client-Id': clientId } : undefined,
    );
    return destinations;
  }

  /**
   * Registers this client as somewhere audio can be sent, and returns how to connect.
   *
   * Pass a previously-issued `clientId` to reclaim the same registration. That is what a page
   * reload needs: without it every refresh leaves an orphan destination behind until it times
   * out, which is visible to everyone else browsing the destination list.
   */
  registerLocalDestination(name: string, clientId?: string): Promise<ApiLocalDestination> {
    return this.request('POST', '/destinations/local', {
      name,
      ...(clientId ? { clientId } : {}),
    });
  }

  /** Removes a local destination early. Refuses a configured zone — not this route's to delete. */
  unregisterLocalDestination(id: string): Promise<void> {
    return this.command('DELETE', `/destinations/local/${encodeURIComponent(id)}`);
  }

  /**
   * Transport on a destination rather than a zone.
   *
   * The same verbs as their `/zones/{id}/…` counterparts, and for a configured zone the same
   * thing — the id *is* the zone id. Needed because a local destination has no zone, so
   * `/zones/9000/play` would 404.
   */
  playDestination(id: string, uri?: string): Promise<void> {
    return this.command('POST', `/destinations/${encodeURIComponent(id)}/play`, uri ? { uri } : undefined);
  }

  pauseDestination(id: string): Promise<void> {
    return this.command('POST', `/destinations/${encodeURIComponent(id)}/pause`);
  }

  setDestinationVolume(id: string, volume: number): Promise<void> {
    return this.command('PUT', `/destinations/${encodeURIComponent(id)}/volume`, {
      volume: Math.round(volume),
    });
  }

  // --- content ---------------------------------------------------------------

  /** The configured content services, each with what it can actually search. */
  async getServices(): Promise<ContentService[]> {
    const { services } = await this.request<{ services: ContentService[] }>('GET', '/services');
    return services;
  }

  /**
   * Lists a container's children, or the services themselves when `id` is omitted.
   *
   * Paginates on **`offset`**, not `start` — the one place the content routes differ from the
   * zone collections, which take `start`. Worth not papering over: a client that sends the
   * wrong one silently gets page one forever.
   */
  browse(id?: string, offset = 0, limit = 100): Promise<ContentListing> {
    const path = id ? `/browse/${encodeURIComponent(id)}` : '/browse';
    return this.request(`GET`, `${path}?offset=${offset}&limit=${limit}`);
  }

  /** Describes one id without browsing its parent — the deep-link / stored-id case. */
  item(id: string): Promise<ContentItem> {
    return this.request('GET', `/items/${encodeURIComponent(id)}`);
  }

  /**
   * The story around an id — a biography, related items — when the server can tell one.
   *
   * A **proposed** route (`docs/PROPOSAL-item-about.md`): the server enriches from a cloud
   * metadata service and caches; this player renders whatever arrives. 404 is the ordinary
   * answer — an older server, no enrichment configured, an item nobody has written about — so it
   * resolves null the way `waveform` does, rather than throwing over a page that renders fine
   * without it.
   */
  async itemAbout(id: string): Promise<ContentAbout | null> {
    try {
      const body = await this.request<unknown>('GET', `/items/${encodeURIComponent(id)}/about`);
      // A proposed route is one a server may not have, and "does not have it" has been spelled
      // more than one way: a server whose `/items/{id}` route matched greedily answered 200 with
      // the *item* instead, whose shape has no `similar` — and a page that trusted the type
      // crashed on the panel it was about to skip. So the shape is checked rather than declared:
      // anything that is not an about is the same nothing a 404 is.
      return isAbout(body) ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * Searches across services, grouped by kind.
   *
   * `kinds` is more than a filter: a provider that cannot search a kind is skipped for it
   * rather than asked and ignored, so narrowing genuinely costs less.
   */
  search(query: string, opts: SearchOptions = {}): Promise<ContentSearchResult> {
    const params = new URLSearchParams({ q: query });
    if (opts.kinds?.length) {
      params.set('kind', opts.kinds.join(','));
    }
    if (opts.services?.length) {
      params.set('service', opts.services.join(','));
    }
    if (opts.limit) {
      params.set('limit', String(opts.limit));
    }
    return this.request('GET', `/search?${params.toString()}`);
  }

  getPlaylists(start = 0, limit = 100): Promise<{ items: ApiPlaylist[]; total: number }> {
    return this.request('GET', `/playlists?offset=${start}&limit=${limit}`);
  }

  createPlaylist(name: string): Promise<ApiPlaylist> {
    return this.request('POST', '/playlists', { name });
  }

  renamePlaylist(id: string, name: string): Promise<ApiPlaylist> {
    return this.request('PATCH', `/playlists/${encodeURIComponent(id)}`, { name });
  }

  deletePlaylist(id: string): Promise<void> {
    return this.command('DELETE', `/playlists/${encodeURIComponent(id)}`);
  }

  addToPlaylist(id: string, itemId: string): Promise<void> {
    return this.command('POST', `/playlists/${encodeURIComponent(id)}/items`, { id: itemId });
  }

  removeFromPlaylist(id: string, position: number): Promise<void> {
    return this.command('DELETE', `/playlists/${encodeURIComponent(id)}/items`, { position });
  }

  movePlaylistItem(id: string, from: number, to: number): Promise<void> {
    return this.command('PATCH', `/playlists/${encodeURIComponent(id)}/items`, { from, to });
  }

  getQueue(zoneId: number, start = 0, limit = 100): Promise<ApiQueue> {
    return this.request('GET', `/zones/${zoneId}/queue?start=${start}&limit=${limit}`);
  }

  getFavorites(zoneId: number, start = 0, limit = 50): Promise<ApiFavorites> {
    return this.request('GET', `/zones/${zoneId}/favorites?start=${start}&limit=${limit}`);
  }

  getRecents(zoneId: number, start = 0, limit = 50): Promise<ApiRecents> {
    return this.request('GET', `/zones/${zoneId}/recents?start=${start}&limit=${limit}`);
  }

  getEqualizer(zoneId: number): Promise<ApiZoneEqualizer> {
    return this.request('GET', `/zones/${zoneId}/equalizer`);
  }

  getHealth(): Promise<ApiHealthReport> {
    return this.request('GET', '/health');
  }

  /**
   * The cheap readiness probe. Resolves `ready: false` on a 503 rather than throwing —
   * "not ready yet" is an answer, not a failure, and the caller polls on it.
   */
  async getReady(): Promise<ApiReadyReport> {
    try {
      return await this.request<ApiReadyReport>('GET', '/ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        return { ready: false, phase: 'starting' };
      }
      throw err;
    }
  }

  /**
   * A stable URL for whatever a zone is playing, which follows the music instead of
   * changing per track.
   *
   * `cacheKey` exists because that stability is also the problem: the url does not change
   * when the picture does, so a browser holds the previous track's image. Vary it with
   * something that moves per track (`track.coverUrl` is the value the contract suggests)
   * and unknown parameters are ignored by the server.
   */
  coverUrl(zoneId: number, opts: { size?: number; cacheKey?: string } = {}): string {
    const params = new URLSearchParams();
    if (opts.size) {
      params.set('size', String(opts.size));
    }
    if (opts.cacheKey) {
      params.set('v', opts.cacheKey);
    }
    const query = params.toString();
    return `${this.base}/zones/${zoneId}/cover${query ? `?${query}` : ''}`;
  }

  /**
   * The prepared shape of a track, or null when the server has none.
   *
   * Null carries two situations the caller cannot separate and does not need to: this audio can never
   * have one (a streaming service hands its audio over as it plays, so there is nothing to scan ahead
   * of time), or it does not have one *yet* — asking is what starts the decode, and a second ask a
   * moment later gets it. So a caller retries once and then stops, rather than treating the first null
   * as final or polling forever.
   *
   * Keyed by the audio, not by the room: the same track has the same shape everywhere, so this URL is
   * cacheable per track and the server marks it as such.
   */
  async waveform(uri: string): Promise<number[] | null> {
    try {
      const result = await this.request<{ buckets: number[] }>(
        'GET',
        `/waveform?uri=${encodeURIComponent(uri)}`,
      );
      return Array.isArray(result?.buckets) ? result.buckets : null;
    } catch {
      // 404 is the normal answer for "no shape", not an error worth surfacing.
      return null;
    }
  }

  // --- transport -------------------------------------------------------------

  /**
   * Resumes what the zone already has queued, or **starts** `uri` when given one.
   *
   * `uri` is either a stream URL or a `source.id` this API handed out — resolving it and
   * rebuilding the queue is the server's job, which is what lets a client store an
   * opaque id and replay it later without knowing how content is modelled.
   */
  play(zoneId: number, uri?: string): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/play`, uri ? { uri } : undefined);
  }

  /** Keeps the zone's place; `play` resumes it. Live radio has none, so it reconnects. */
  pause(zoneId: number): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/pause`);
  }

  /** Gives the place up; `play` starts over. Both let power management switch an amp off. */
  stop(zoneId: number): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/stop`);
  }

  next(zoneId: number): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/next`);
  }

  previous(zoneId: number): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/previous`);
  }

  /** Moves the complete queue and current playback position to another zone. */
  handoff(sourceZoneId: number, targetZoneId: number): Promise<void> {
    return this.command('POST', `/zones/${sourceZoneId}/handoff`, { targetZoneId });
  }

  /** Absolute volume. A write above `volumeLimits.max` lands on the cap, not an error. */
  setVolume(zoneId: number, volume: number): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/volume`, { volume: Math.round(volume) });
  }

  /**
   * Relative volume — what a remote's up/down should send.
   *
   * Preferred over read-then-write: two clients stepping the same zone would otherwise
   * race, each basing its write on a value the other already changed.
   */
  nudgeVolume(zoneId: number, delta: number): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/volume`, { delta: Math.round(delta) });
  }

  /** Only meaningful when `source.seekable`; a live stream has no position to seek to. */
  seek(zoneId: number, position: number): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/position`, { position: Math.round(position) });
  }

  setPower(zoneId: number, power: 'on' | 'off'): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/power`, { power });
  }

  setRepeat(zoneId: number, repeat: ApiRepeatMode): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/repeat`, { repeat });
  }

  setShuffle(zoneId: number, shuffle: boolean): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/shuffle`, { shuffle });
  }

  /** Ten gains in dB, low band first, clamped server-side to -6..+6. */
  async setEqualizer(zoneId: number, bands: number[]): Promise<number[]> {
    const applied = await this.request<ApiZoneEqualizer>(
      'PUT',
      `/zones/${zoneId}/equalizer`,
      { bands },
    );
    return applied.bands;
  }

  /** Switches a zone to a configured input. There is no "leave" — you select something else. */
  selectInput(zoneId: number, inputId: string): Promise<void> {
    return this.command('PUT', `/zones/${zoneId}/input`, { input: inputId });
  }

  // --- queue -----------------------------------------------------------------

  queueAppend(zoneId: number, uri: string): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/queue`, { uri });
  }

  queueNext(zoneId: number, uri: string): Promise<void> {
    return this.command('POST', `/zones/${zoneId}/queue`, { uri, next: true });
  }

  /** Jumps to an entry by its *entry* id (the same track twice has two ids). */
  queuePlay(zoneId: number, itemId: string): Promise<void> {
    return this.command('PATCH', `/zones/${zoneId}/queue`, { play: itemId });
  }

  /** Moves an entry before another; omit `beforeId` to send it to the end. */
  queueMove(zoneId: number, itemId: string, beforeId?: string): Promise<void> {
    return this.command('PATCH', `/zones/${zoneId}/queue`, {
      move: itemId,
      ...(beforeId ? { before: beforeId } : {}),
    });
  }

  queueRemove(zoneId: number, itemId: string): Promise<void> {
    return this.command('DELETE', `/zones/${zoneId}/queue`, { id: itemId });
  }

  /** `all: true` is required: wiping a queue should be asked for, not implied. */
  queueClear(zoneId: number): Promise<void> {
    return this.command('DELETE', `/zones/${zoneId}/queue`, { all: true });
  }

  queueUndo(zoneId: number): Promise<void> {
    return this.command('DELETE', `/zones/${zoneId}/queue`, { undo: true });
  }

  // --- favourites & recents --------------------------------------------------

  /** `name` is optional: without one the server names it from what it knows. */
  addFavorite(zoneId: number, uri: string, name?: string): Promise<ApiFavorite> {
    return this.request('POST', `/zones/${zoneId}/favorites`, {
      uri,
      ...(name ? { name } : {}),
    });
  }

  renameFavorite(zoneId: number, id: number, name: string): Promise<void> {
    return this.command('PATCH', `/zones/${zoneId}/favorites`, { id, name });
  }

  /** Reordering is simply the order you send. */
  reorderFavorites(zoneId: number, order: number[]): Promise<void> {
    return this.command('PATCH', `/zones/${zoneId}/favorites`, { order });
  }

  playFavorite(zoneId: number, id: number): Promise<void> {
    return this.command('PATCH', `/zones/${zoneId}/favorites`, { play: id });
  }

  removeFavorite(zoneId: number, id: number): Promise<void> {
    return this.command('DELETE', `/zones/${zoneId}/favorites`, { id });
  }

  clearRecents(zoneId: number): Promise<void> {
    return this.command('DELETE', `/zones/${zoneId}/recents`);
  }

  // --- grouping & alerts -----------------------------------------------------

  /**
   * Puts `zoneId` at the head of a group, or ungroups it with an empty list.
   *
   * Returns the resulting group because members can be refused (protocol mismatch), and
   * reading `rejected` beats diffing what you asked for against the next zone event.
   */
  setGroup(zoneId: number, members: number[]): Promise<ApiGroupResult> {
    return this.request('PUT', `/zones/${zoneId}/group`, { members });
  }

  ungroup(zoneId: number): Promise<ApiGroupResult> {
    return this.setGroup(zoneId, []);
  }

  // --- output timing ---------------------------------------------------------

  /**
   * Sets the delay a zone's speaker chain adds after its audio output, in ms.
   *
   * Raising it makes that room play **earlier**: the client subtracts it from every timestamp to
   * compensate for delay downstream of it (an amp, an active speaker). Use it on a room that arrives
   * late; there is no negative form.
   *
   * Persisted *and* applied live — Sendspin pushes it to the client without restarting the stream,
   * so the change is audible immediately and survives a reboot. `applied: false` means it was
   * stored but no live output took it (the protocol has no delay, or the named satellite is not
   * configured), which is a success: a device connecting later picks it up.
   *
   * `clientId` targets one satellite instead of the zone's own output.
   */
  setOutputDelay(
    zoneId: number,
    delayMs: number,
    clientId?: string,
  ): Promise<{ delayMs: number; applied: boolean; clientId: string | null }> {
    return this.request('PUT', `/zones/${zoneId}/output/delay`, {
      delayMs,
      ...(clientId ? { clientId } : {}),
    });
  }

  /** Plays a sound or spoken message over whatever the zone was doing, then hands it back. */
  alert(zoneId: number, request: ApiAlertRequest): Promise<unknown> {
    return this.request('POST', `/zones/${zoneId}/alert`, request);
  }

  /** Stops a looping alert (`alarm`, `fire`), which otherwise plays until told to stop. */
  stopAlert(zoneId: number, kind: ApiAlertRequest['kind']): Promise<unknown> {
    return this.request('DELETE', `/zones/${zoneId}/alert`, { kind });
  }

  // --- plumbing --------------------------------------------------------------

  /** A command whose success is `204 No Content` — the new state arrives over SSE. */
  private async command(method: string, path: string, body?: unknown): Promise<void> {
    await this.request<void>(method, path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    /** Extra headers. Only `X-Sonn-Client-Id` so far, which makes a tab visible to itself. */
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      // A dropped connection and an aborted timeout look the same to the UI: the
      // server is not answering. Distinguished from ApiError, which means it did.
      throw new ApiError(0, 'network-error', err instanceof Error ? err.message : undefined);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The contract promises `{"error":"…"}` on 4xx, but a proxy or a crash can put
      // HTML here instead, so a failed parse must not mask the status code.
      let code = `http-${res.status}`;
      let message: string | undefined;
      try {
        const payload = (await res.json()) as { error?: string; message?: string };
        code = payload.error ?? code;
        message = payload.message;
      } catch {
        // Keep the status-derived code.
      }
      throw new ApiError(res.status, code, message);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }
}
