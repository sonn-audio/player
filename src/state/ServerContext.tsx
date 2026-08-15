/**
 * Wires one server into React: the API client, the live zone feed, and the content
 * source.
 *
 * Everything the app talks to comes from here, so a component never constructs a client
 * or a URL of its own. That is what keeps the "only `/api/v1`" rule enforceable by
 * reading one file instead of grepping the tree.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient } from '@/api/client';
import { EventStream, type EventStreamStatus } from '@/api/events';
import {
  HttpContentSource,
  UnavailableContentSource,
  type ContentSource,
} from '@/api/content';
import { ZoneStore } from '@/state/zoneStore';
import type { ApiZoneState } from '@/api/types';

export type ServerContextValue = {
  api: ApiClient;
  /** Browsing and search over `/services`, `/browse`, `/items`, `/search`. */
  content: ContentSource;
  zones: ApiZoneState[];
  status: EventStreamStatus;
  /**
   * Whether the server has said what zones exist.
   *
   * The difference between "this room is not in the list yet" and "this room is gone", which no
   * consumer can tell from an empty lookup — and one of them must not throw away a stored choice.
   */
  synced: boolean;
  /** The live store, for subscribing to collection invalidations. */
  store: ZoneStore;
};

const ServerContext = createContext<ServerContextValue | null>(null);

/**
 * Where the server lives.
 *
 * Same-origin by default, because the built bundle is served by the audioserver itself,
 * and the dev server proxies `/api` to it. An explicit origin is for pointing a local dev
 * build at a real server — the API sets `Access-Control-Allow-Origin: *`, so that works
 * without a proxy.
 */
export function ServerProvider({
  origin = '',
  children,
}: {
  origin?: string;
  children: ReactNode;
}) {
  const api = useMemo(() => new ApiClient(origin || window.location.origin), [origin]);

  /**
   * Which content source to use, decided by asking.
   *
   * `/services` either answers or 404s, and that is a better test than a version check: it
   * says what *this* server can do rather than what its version number implies. Starts as
   * unavailable so the first render has something to show, and swaps once the answer is in.
   */
  const [content, setContent] = useState<ContentSource>(() => new UnavailableContentSource());
  useEffect(() => {
    let current = true;
    api
      .getServices()
      .then(() => {
        if (current) {
          setContent(new HttpContentSource(api));
        }
      })
      .catch(() => {
        if (current) {
          setContent(new UnavailableContentSource());
        }
      });
    return () => {
      current = false;
    };
  }, [api]);

  const storeRef = useRef<ZoneStore>();
  storeRef.current ??= new ZoneStore();
  const store = storeRef.current;

  const [zones, setZones] = useState<ApiZoneState[]>(store.snapshot);
  const [status, setStatus] = useState<EventStreamStatus>('connecting');
  /** Flipped by the opening snapshot and never cleared: a reconnect re-sends it, it is never unlearned. */
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const unsubscribe = store.subscribe(setZones);
    // No bootstrap fetch: the stream opens with a `server.snapshot` snapshot, so a
    // `GET /zones` here would only race it and render the same thing twice.
    const stream = new EventStream(api.base, {
      onEvent: (event) => {
        store.apply(event);
        if (event.type === 'server.snapshot') {
          setSynced(true);
        }
      },
      onStatus: setStatus,
    });
    stream.open();
    return () => {
      unsubscribe();
      stream.close();
    };
  }, [api, store]);

  const value = useMemo<ServerContextValue>(
    () => ({ api, content, zones, status, synced, store }),
    [api, content, zones, status, synced, store],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerContextValue {
  const value = useContext(ServerContext);
  if (!value) {
    throw new Error('useServer must be used inside a ServerProvider');
  }
  return value;
}

/** The API client on its own, for the many components that only send commands. */
export function useApi(): ApiClient {
  return useServer().api;
}
