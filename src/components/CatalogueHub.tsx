/**
 * What a folder-of-folders is drawn as: shelves of the music inside it.
 *
 * A service root — Spotify's, Apple Music's, the library's — is a listing of *doorways*. Seven
 * items, all browsable, none playable, not one of them carrying artwork, because "Popular
 * Playlists" is a place and places have no sleeve. Rendered by the ordinary grid that is seven
 * identical empty squares and a screen of nothing: the page that is supposed to introduce a music
 * service manages not to show a single record.
 *
 * So each doorway opens itself one row deep. The shelf shows what is actually behind it right now
 * — this week's releases, the playlists you kept — and the header is still the way in. Which is
 * the arrangement every good catalogue uses, and it is not decoration: the seven rows are only
 * distinguishable from each other once they are made of their own contents.
 *
 * Three things keep it honest:
 *
 *  - **A shelf is the same list as everywhere else** (`ItemGrid`), turned sideways. A track in a
 *    shelf plays, favourites and adds to a playlist exactly as it does in a grid, because it is
 *    the same row.
 *  - **Shelves load as they are reached.** Seven folders on one page is seven provider round
 *    trips; firing them together on mount is how a browse screen becomes slower than the grid it
 *    replaced. Each waits until it is nearly in view, and the answers are cached for the session.
 *  - **A provider that sends its own rows keeps them.** `ContentListing.sections` is editorial —
 *    Apple Music sends eleven of them, made of what this account actually listens to — and no
 *    amount of opening folders one row deep competes with that. Where they exist they *are* the
 *    page, and the folders step aside into a strip of chips. See `curated` below.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ItemGrid, type BrowseActions } from '@/components/ItemGrid';
import { ServiceBadge, serviceLogoUrl } from '@/components/ServiceBadge';
import { useFolderPreview } from '@/state/useFolderPreview';
import { useInView } from '@/state/useInView';
import type { ContentItem, ContentSection } from '@/api/content';

/**
 * How far along a shelf you can see before it stops.
 *
 * Wider than one screenful on purpose: a shelf that ends exactly where the column does looks like
 * the whole folder, and the scroll is what says there is more.
 */
const SHELF_SIZE = 14;

/** Placeholder tiles, so a shelf occupies its final height before its artwork lands. */
const SKELETON = [0, 1, 2, 3, 4, 5, 6, 7];

export function CatalogueHub({
  title,
  service,
  serviceName,
  folders,
  sections,
  actions,
}: {
  /** The name we walked in with — never the container's own, which providers fill with junk. */
  title: string;
  service: string | undefined;
  serviceName: string | undefined;
  folders: ContentItem[];
  /** Rows the *provider* composed, when it composes any. Apple Music sends eleven. */
  sections: ContentSection[];
  actions: BrowseActions;
}) {
  const logo = service ? serviceLogoUrl(service) : null;
  /*
   * The artwork behind the title.
   *
   * Reads the *first* shelf, which is already being fetched a few lines below and answers from the
   * same cache — so the page's one decorative flourish costs nothing. Blurred past recognition on
   * purpose: it is the colour of what is in there, not a claim about any particular record, and
   * the stylesheet's own rule is that artwork is the only bright thing on screen. A service root
   * with a black-and-white top shelf gets a black-and-white header, which is the point.
   */
  const first = folders[0];
  const bloom = useFolderPreview(first?.id ?? '', SHELF_SIZE, Boolean(first));
  const bloomArt = bloom.items
    .map((item) => item.coverUrl)
    .filter((url): url is string => !!url)
    .slice(0, 5);
  /*
   * A provider that already sent rows has written the page, and it did it with the one thing we
   * cannot: editorial. So its rows are the body, and the folders — which are navigation — become a
   * strip of chips above them rather than eight more shelves. Eleven curated rows plus eight
   * borrowed ones is nineteen rows of scrolling to reach a listing you could have reached in one
   * press, and the curated ones are the better rows.
   *
   * Where a provider sends none (Spotify, YouTube, the library), the folders *are* the page and
   * are opened one row deep each, which is the case this whole component was built for.
   */
  const curated = sections.length > 0;

  return (
    <div className="hub">
      <header className="hub-head" data-bloom={bloomArt.length > 0 || undefined}>
        {bloomArt.length > 0 && (
          <span className="hub-bloom" aria-hidden="true">
            {bloomArt.map((url, index) => (
              <img key={`${url}#${index}`} src={url} alt="" decoding="async" />
            ))}
          </span>
        )}
        {/* The mark at a size that reads as identity rather than as a row badge. An unbranded
            provider (the library, the radio directory) has none, and gets the title alone —
            which is the honest answer, not a grey square where a logo would go. */}
        {logo && <img className="hub-mark" src={logo} alt="" width={44} height={44} decoding="async" />}
        <div className="hub-titles">
          <h1 className="hub-title">{title}</h1>
          <p className="hub-sub">
            {folders.length} {folders.length === 1 ? 'collection' : 'collections'}
            {serviceName && serviceName !== title ? ` · ${serviceName}` : ''}
          </p>
        </div>
      </header>

      {curated ? (
        <>
          <nav className="hub-chips">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="shelf-chip"
                onClick={() => actions.onOpen(folder)}
              >
                {folder.name}
              </button>
            ))}
          </nav>
          {sections.map((section) => (
            <section key={section.id} className="shelf">
              <header className="shelf-head">
                <h2 className="shelf-static">{section.name}</h2>
              </header>
              {/* No fetch and no way in: a section is a row the provider handed over whole, and it
                  has no id of its own to browse. */}
              <ShelfTrack>
                <ItemGrid {...actions} items={section.items} layout={shelfLayout(section.items)} />
              </ShelfTrack>
            </section>
          ))}
        </>
      ) : (
        folders.map((folder) => <Shelf key={folder.id} folder={folder} actions={actions} />)
      )}
    </div>
  );
}

function Shelf({ folder, actions }: { folder: ContentItem; actions: BrowseActions }) {
  const [ref, seen] = useInView<HTMLElement>();
  const preview = useFolderPreview(folder.id, SHELF_SIZE, seen);
  const open = () => actions.onOpen(folder);

  /*
   * `total` is null whenever the provider cannot count, so the count is shown only when it is
   * real. "More" without a number is still true, and a fabricated one would not be.
   */
  const counted = preview.total !== null && preview.total > preview.items.length;

  return (
    <section className="shelf" ref={ref}>
      <header className="shelf-head">
        <button type="button" className="shelf-open" onClick={open} title={`Open ${folder.name}`}>
          <h2>{folder.name}</h2>
          <Icon name="chevron-right" />
        </button>
        {preview.total !== null && preview.state === 'ready' && (
          <span className="shelf-count mono">{preview.total}</span>
        )}
      </header>

      {preview.state !== 'ready' ? (
        <div className="shelf-body shelf-scroller" aria-hidden="true">
          <div className="shelf-skeleton">
            {SKELETON.map((index) => (
              <span key={index} />
            ))}
          </div>
        </div>
      ) : preview.items.length === 0 ? (
        /* An empty shelf says so rather than collapsing: a folder that is there but holds nothing
           is a fact about the account, and a row that silently disappears looks like a bug. */
        <p className="shelf-empty">
          Nothing in here yet
          {folder.service && (
            <ServiceBadge
              service={folder.service}
              label={actions.serviceNames[folder.service]}
              className="shelf-empty-badge"
            />
          )}
        </p>
      ) : !preview.items.some((item) => item.coverUrl) ? (
        /*
         * A folder of more folders — the local library's shares are this, and so is anything a
         * provider nests two deep. Drawing them as covers would put the empty square back, one
         * level lower, having spent a request to find out there was nothing to show. So the way on
         * is drawn as what it is: the names, as a row of chips. It reads as a table of contents,
         * which is what it is, and it is honest about there being no artwork down here rather than
         * implying some failed to load.
         */
        <ul className="shelf-chips">
          {preview.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="shelf-chip"
                onClick={() => (item.browsable ? actions.onOpen(item) : actions.onPlay(item))}
                disabled={!item.browsable && !actions.zone}
              >
                {item.name}
              </button>
            </li>
          ))}
          {counted && (
            <li>
              <button type="button" className="shelf-chip ghost" onClick={open}>
                All {preview.total}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <ShelfTrack>
          <ItemGrid {...actions} items={preview.items} layout={shelfLayout(preview.items)} />
          {counted && (
            <button type="button" className="shelf-all" onClick={open}>
              <span className="shelf-all-mark">
                <Icon name="chevron-right" />
              </span>
              <span className="shelf-all-label">All {preview.total}</span>
            </button>
          )}
        </ShelfTrack>
      )}
    </section>
  );
}

/**
 * A row of tracks is stacked three deep; anything else runs as one row of artwork.
 *
 * A track's square is its album's, which the row above it probably already showed — so for tracks
 * the artwork is the least informative thing on the card, and three names in the height of one
 * cover is both denser and easier to read down.
 */
function shelfLayout(items: ContentItem[]): 'shelf' | 'shelf-rows' {
  return items.length > 3 && items.every((item) => item.kind === 'track') ? 'shelf-rows' : 'shelf';
}

/**
 * The scrolling track, with the two arrows a mouse needs.
 *
 * A trackpad flicks sideways and a phone swipes, but a wheel mouse — which is what is in front of
 * most of these screens — has no gesture for a horizontal overflow at all, so without these the
 * far end of every shelf is unreachable for a large share of people. They appear on hover, sit
 * over the ends, and each one is hidden when there is nothing that way: an arrow pointing at the
 * end of the row is a button that lies.
 *
 * Position is read from the element on scroll rather than tracked in state as it moves, because
 * the browser is the one moving it — `scrollLeft` is the truth and anything else is a copy that
 * drifts the moment someone flicks the row by hand.
 */
function ShelfTrack({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    // A pixel of slack: fractional layout widths mean `scrollLeft + clientWidth` lands just short
    // of `scrollWidth` at the real end, which would leave a dead arrow lit.
    setEnds({
      start: el.scrollLeft > 1,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    // The column resizes with the rails, and a shelf that fitted at one width overflows at another.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, children]);

  const nudge = (direction: 1 | -1) => {
    const el = ref.current;
    if (el) {
      // Not a full page: leaving part of a card visible is what tells you the row moved rather
      // than swapped.
      el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
    }
  };

  return (
    <div className="shelf-track">
      <div ref={ref} className="shelf-body shelf-scroller" onScroll={measure}>
        {children}
      </div>
      {ends.start && (
        <button
          type="button"
          className="shelf-nudge back"
          aria-label="Scroll back"
          onClick={() => nudge(-1)}
        >
          <Icon name="chevron-right" />
        </button>
      )}
      {ends.end && (
        <button
          type="button"
          className="shelf-nudge on"
          aria-label="Scroll on"
          onClick={() => nudge(1)}
        >
          <Icon name="chevron-right" />
        </button>
      )}
    </div>
  );
}
