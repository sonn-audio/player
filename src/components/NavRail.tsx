/**
 * The left rail: the room, the search field, and every way into the content.
 *
 * **The nav is the provider tree, not a menu.** It is built from `GET /services` and from each
 * service's own children rather than from a hand-written list, so it cannot offer a Genres or
 * Composers entry that dead-ends — those are conventions of other players, and this server's
 * library reports what it reports. A provider added server-side appears here with no change to
 * this file, for the same reason browse rows read `browsable`/`playable` instead of switching on
 * `kind`.
 *
 * **Closed by default, and it remembers.** An earlier version opened every service and the first
 * branch of each on load, which put thirty rows in a 244px column before anyone had asked for one
 * — the rail became the browser it is supposed to be a shortcut *to*. Now nothing is opened for
 * you and the open set is persisted, so the rail is three service rows on a first run and exactly
 * the shape you left it on every run after that. Children are still *fetched* eagerly, which is
 * what keeps the disclosure carets honest and expansion instant; fetching is cheap, drawing is
 * what costs attention.
 *
 * Three groups, each under a mono label: the room, its collections, and the catalogue. The labels
 * are the structure — there are no boxes — which is the same trick the rest of the player uses.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { Icon, type IconName } from '@/components/Icon';
import { ServiceBadge } from '@/components/ServiceBadge';
import { ZoneMenu } from '@/components/ZonePicker';
import type { ContentItem } from '@/api/content';
import type { ApiZoneState } from '@/api/types';

export type NavTarget =
  /** What the selected room is playing. The default, and where the now-bar sends you. */
  | { kind: 'playing' }
  /**
   * A browse id — a service root or any node inside it.
   *
   * `id` absent means the catalogue's own root, the list of services. That is a real destination
   * (it is where search lands, and where the breadcrumb "Services" goes), so it gets the same shape
   * rather than a kind of its own.
   */
  | { kind: 'browse'; id?: string; label?: string }
  /** A zone-scoped collection, rendered by the panels rather than the browser. */
  | { kind: 'collection'; id: 'favorites' | 'recents' }
  /**
   * The physical inputs — a turntable, a CD player, a line-in jack.
   *
   * Grouped with the catalogue and *not* with the room, which is the same distinction the two
   * headings already make: the room's entries are its own state (its queue, its favourites, its
   * group), while `GET /inputs` is server-level and every room sees the identical list. That the
   * chosen input then plays *in* the selected room is not a counter-argument — an album from any
   * service behaves exactly the same way.
   *
   * Offered only when the server has one configured (see `hasInputs`), because most do not.
   */
  | { kind: 'inputs' }
  /**
   * Which rooms play together, and the per-room delay that lines them up.
   *
   * A destination rather than a modal: it is the screen you sit on while adjusting by ear, so it has
   * to survive a reload and be linkable — neither of which a sheet over the player can do.
   */
  | { kind: 'grouping' };

/** Where the open branches are remembered, so a reload keeps the rail you had. */
const OPEN_KEY = 'sonn.player.nav.open';

function readOpen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    // Private-mode Safari throws, and a malformed value is not worth a crash: start closed.
    return new Set();
  }
}

function writeOpen(open: Set<string>): void {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Not persisting is survivable — the tree still opens for this session.
  }
}

/** A node in the rail's tree. `children` is undefined until it has been fetched. */
type Node = {
  id: string;
  name: string;
  service: string;
  children?: Node[];
};

function toNode(item: ContentItem): Node {
  return { id: item.id, name: item.name, service: item.service };
}

export function NavRail({
  active,
  onNavigate,
  onSearch,
  zones,
  selectedZoneId,
  onSelectZone,
}: {
  active: NavTarget | null;
  onNavigate: (target: NavTarget) => void;
  onSearch: () => void;
  zones: ApiZoneState[];
  selectedZoneId: number | null;
  onSelectZone: (zoneId: number) => void;
}) {
  const api = useApi();
  const hasZone = selectedZoneId !== null;
  const [roots, setRoots] = useState<Node[]>([]);
  const [open, setOpen] = useState<Set<string>>(readOpen);
  /** Children by node id, filled as nodes are fetched. */
  const [children, setChildren] = useState<Record<string, Node[]>>({});
  /** Whether this server has any physical input at all — the Inputs entry exists only then. */
  const [hasInputs, setHasInputs] = useState(false);

  /*
   * The inputs, read once and only counted.
   *
   * Server-level rather than per zone, so this does not re-run when the room changes; the panel
   * fetches the list itself when it is opened. All the rail needs is whether the entry should be
   * there, and a rail row leading to "nothing configured" is worse than no row.
   */
  useEffect(() => {
    let cancelled = false;
    api
      .getInputs()
      .then((list) => {
        if (!cancelled) {
          setHasInputs(list.length > 0);
        }
      })
      .catch(() => {
        // A server without the route is a server without inputs.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /*
   * The services, and one level inside each, read once.
   *
   * Fetched but not opened — see the note at the top. One request per service, none of them
   * blocking the render, and the result is what tells each row whether it has a caret at all.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let services: Awaited<ReturnType<typeof api.getServices>>;
      try {
        services = await api.getServices();
      } catch {
        // No services is a legitimate server; the rail then carries search and the collections.
        return;
      }
      if (cancelled) {
        return;
      }
      setRoots(
        services.map((service) => ({
          id: service.rootId,
          name: service.name,
          service: service.id,
        })),
      );

      await Promise.all(
        services.map(async (service) => {
          try {
            const listing = await api.browse(service.rootId, 0, 50);
            if (cancelled) {
              return;
            }
            setChildren((prev) => ({
              ...prev,
              [service.rootId]: listing.items.filter((item) => item.browsable).map(toNode),
            }));
          } catch {
            // A service that cannot be listed keeps its row and simply opens onto nothing.
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  /** Opens or closes a node, fetching its children the first time. */
  const toggle = useCallback(
    (node: Node) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        writeOpen(next);
        return next;
      });
      if (children[node.id]) {
        return;
      }
      void api
        .browse(node.id, 0, 50)
        .then((listing) => {
          setChildren((prev) => ({
            ...prev,
            [node.id]: listing.items.filter((item) => item.browsable).map(toNode),
          }));
        })
        .catch(() => {
          // Mark it as fetched-and-empty so the disclosure stops offering to expand nothing.
          setChildren((prev) => ({ ...prev, [node.id]: [] }));
        });
    },
    [api, children],
  );

  const isActive = (id: string): boolean =>
    active?.kind === 'browse' && active.id === id;

  /**
   * One row, and its children when open.
   *
   * The row is two controls, not one: the label navigates and the caret expands. Conflating them
   * is the usual mistake — it makes reaching a parent node impossible once it has children.
   */
  const renderNode = (node: Node, depth: number): React.ReactNode => {
    const kids = children[node.id];
    const isOpen = open.has(node.id);
    // A node not yet fetched may still have children, so it keeps its caret; one fetched and
    // found empty loses it, because an expander that opens onto nothing reads as broken.
    const expandable = kids === undefined || kids.length > 0;

    return (
      <li key={node.id}>
        <div className="nav-row" data-depth={depth}>
          <button
            type="button"
            className="nav-item"
            data-active={isActive(node.id) || undefined}
            onClick={() => onNavigate({ kind: 'browse', id: node.id, label: node.name })}
            title={node.name}
          >
            {/*
              The service's mark at the root, and *nothing* below it.
              Icons on the inner nodes were a guess at what a provider's own node means — the map
              rendered "Albums" as a queue glyph and "Artists" as a speaker — so a row of them said
              less than the indentation and the guide line already do.
            */}
            {depth === 0 && <ServiceBadge service={node.service} className="nav-badge" />}
            <span className="nav-label">{node.name}</span>
          </button>

          {expandable ? (
            <button
              type="button"
              className="nav-caret"
              onClick={() => toggle(node)}
              aria-expanded={isOpen}
              title={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            >
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
            </button>
          ) : (
            <span className="nav-caret-spacer" aria-hidden="true" />
          )}
        </div>

        {isOpen && kids && kids.length > 0 && (
          <ul className="nav-list">{kids.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  /** One flat entry: no children, no caret. Used for the room-scoped destinations. */
  const leaf = (target: NavTarget, icon: IconName, label: string, isOn: boolean) => (
    <li>
      <div className="nav-row" data-depth={0}>
        <button
          type="button"
          className="nav-item"
          data-active={isOn || undefined}
          onClick={() => onNavigate(target)}
        >
          <Icon name={icon} />
          <span className="nav-label">{label}</span>
        </button>
        <span className="nav-caret-spacer" aria-hidden="true" />
      </div>
    </li>
  );

  return (
    <nav className="nav-rail">
      {/*
        The head does not scroll — and it is not merely a preference.
        `overflow-y: auto` clips absolutely-positioned descendants, so the room picker's popover
        would be trapped inside the scroll box. Keeping the overflow on the tree below instead is
        what lets that popover escape the rail, and it usefully pins the picker and the search field
        while a long catalogue scrolls past.
      */}
      <div className="nav-head">
        {/* No wordmark and no status badge: both moved to the bar above, which is where a product
            says its own name. What is left here is navigation, and only navigation. */}

        {/* Which room everything on this page acts on. First, because it scopes what follows. */}
        {zones.length > 0 && (
          <ZoneMenu zones={zones} selectedId={selectedZoneId} onSelect={onSelectZone} />
        )}

        {/* Above the scroll line so it stays put, and above the tree because it is the faster way
            in once a library is more than a few hundred albums. */}
        <button type="button" className="nav-search" onClick={onSearch}>
          <Icon name="search" />
          <span>Search music…</span>
        </button>
      </div>

      <div className="nav-scroll">
        {hasZone && (
          <section className="nav-group">
            <h2 className="nav-group-head">This room</h2>
            <ul className="nav-list">
              {leaf({ kind: 'playing' }, 'speaker', 'Now playing', active?.kind === 'playing')}
              {leaf(
                { kind: 'collection', id: 'favorites' },
                'star',
                'Favourites',
                active?.kind === 'collection' && active.id === 'favorites',
              )}
              {leaf(
                { kind: 'collection', id: 'recents' },
                'clock',
                'Recents',
                active?.kind === 'collection' && active.id === 'recents',
              )}
              {leaf({ kind: 'grouping' }, 'group', 'Grouping', active?.kind === 'grouping')}
            </ul>
          </section>
        )}

        {(roots.length > 0 || hasInputs) && (
          <section className="nav-group">
            <h2 className="nav-group-head">Catalogue</h2>
            <ul className="nav-list nav-tree">
              {roots.map((root) => renderNode(root, 0))}
              {/* Last, and without a caret: the services are trees you walk into, this is a flat
                  list of sockets. Same group because both answer "where does the audio come from". */}
              {hasInputs && leaf({ kind: 'inputs' }, 'input', 'Inputs', active?.kind === 'inputs')}
            </ul>
          </section>
        )}
      </div>
    </nav>
  );
}
