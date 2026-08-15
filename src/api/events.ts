/**
 * The live state feed: `GET /api/v1/events` over `EventSource`.
 *
 * The contract's first rule is that reading state never requires polling, and this is
 * the whole of it. Two properties make the consumer simpler than a socket client:
 *
 *  - The stream **opens with a `server.snapshot` snapshot**, so there is no bootstrap
 *    request to sequence against the first change. `GET /zones` exists for one-shot
 *    scripts; a live client never needs it.
 *  - `zone.changed` carries the **complete zone**, never a patch, so a reconnect is
 *    immediately correct and no prior state is needed to interpret an event.
 *
 * Together those mean a dropped connection needs no recovery logic beyond reconnecting:
 * the next snapshot replaces everything. That is why this class does not buffer, diff or
 * replay — it just re-opens and lets the server re-assert the truth.
 */
import type { ApiEvent } from './types';

/** Backoff bounds for reconnecting. Starts quick, because a restart is usually brief. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export type EventStreamStatus = 'connecting' | 'open' | 'closed';

export type EventStreamHandlers = {
  onEvent: (event: ApiEvent) => void;
  onStatus?: (status: EventStreamStatus) => void;
};

export class EventStream {
  private source: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RECONNECT_MIN_MS;
  private closed = false;

  constructor(
    private readonly base: string,
    private readonly handlers: EventStreamHandlers,
  ) {}

  open(): void {
    this.closed = false;
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.handlers.onStatus?.('closed');
  }

  private connect(): void {
    this.handlers.onStatus?.('connecting');
    // `EventSource` reconnects by itself, but only for a clean server-side close — not
    // for a connection that never opened (server down, DNS failure). Handling `onerror`
    // ourselves covers both with one policy.
    const source = new EventSource(`${this.base}/events`);
    this.source = source;

    source.onopen = () => {
      this.retryDelay = RECONNECT_MIN_MS;
      this.handlers.onStatus?.('open');
    };

    source.onmessage = (message: MessageEvent<string>) => {
      let event: ApiEvent;
      try {
        event = JSON.parse(message.data) as ApiEvent;
      } catch {
        // A truncated frame is not worth tearing the stream down for; the next full
        // zone.changed makes us correct again.
        return;
      }
      this.handlers.onEvent(event);
    };

    source.onerror = () => {
      source.close();
      if (this.source === source) {
        this.source = null;
      }
      if (this.closed) {
        return;
      }
      this.handlers.onStatus?.('connecting');
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
    };
  }
}
