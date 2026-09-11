/**
 * A long listing is an index, not a contact sheet.
 *
 * Three hundred and sixty-two artists were laid out as one flat grid of identical circles, in
 * alphabetical order, with the alphabet nowhere on the page and no way to reach the Ws except to
 * scroll past everything in front of them. Eight hundred albums were the same page with square
 * corners. A record shop prints divider cards, and they are the only reason anyone finds anything in
 * a rack of a thousand sleeves.
 *
 * So the letters are drawn. Each one heads what is filed under it and says how many there are, and a
 * rail of the letters that exist stands beside the page so any of them is one press away. Only the
 * letters that exist — a rail offering `Q` on a page with no Q is a promise the page cannot keep,
 * and a listing that arrives a page at a time (see `Browse`) grows its rail as its rows arrive.
 *
 * It draws a structure that is already there rather than imposing one: `alphabetical` is what decides
 * whether a listing gets an index at all, so a shelf ordered by when things were added keeps the
 * order it was given. What the index does claim is the order of the *letters* — see `group`.
 */
import { useMemo } from 'react';
import { Tile } from '@/art/Browse';
import type { ContentItem } from '@/api/content';

/** Anything that does not begin with a letter, filed at the end where a rack puts it. */
const OTHER = '#';

/** `The National` files under N, `A Rush of Blood to the Head` under R — as in every rack ever built. */
const LEADING = /^(the|a|an|los|las|les)\s+/i;

/** The name a row is filed under: no leading article, no accents — a spelling is not a letter. */
export function fileKey(name: string): string {
  return name
    .replace(LEADING, '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function letterOf(name: string): string {
  const first = fileKey(name)[0] ?? '';
  return /\p{L}/u.test(first) ? first.toUpperCase() : OTHER;
}

/**
 * Is this listing already in alphabetical order?
 *
 * The index is a reading of a listing, not a re-ordering of one. A shelf that arrives by date — most
 * recently added first — is in an order somebody chose, and cutting it into letters would throw that
 * away and call it tidying. So the page is asked, and only a listing that is already alphabetical on
 * the name it would be filed under gets divider cards.
 *
 * Nearly, not exactly: providers are inconsistent about the leading article and a run of eight
 * hundred rows will always hold a few that sit under the wrong one. Nine in ten in order is an
 * alphabetical listing with some noise in it; anything less is a different order altogether.
 */
export function alphabetical(items: ContentItem[]): boolean {
  if (items.length < 2) {
    return false;
  }
  const keys = items.map((item) => fileKey(item.name));
  let ordered = 0;
  for (let at = 1; at < keys.length; at += 1) {
    if (keys[at - 1]! <= keys[at]!) {
      ordered += 1;
    }
  }
  return ordered / (keys.length - 1) >= 0.9;
}

type Group = { letter: string; rows: ContentItem[] };

/**
 * The rows under each letter, with the letters in order.
 *
 * The order has to be stated here because the listing's own cannot be trusted to be one. Apple Music
 * files `The Blue Foundation` between `Blind Faith` and `Blur` — article stripped — and `The Animals`
 * between `Texas` and `The Basics` — article kept. Both in the same listing. An index that followed
 * that would open a B, close it, open a T inside it and open another T eighty names later, which is
 * not an index, it is a symptom. So the alphabet decides the order of the letters and the listing
 * decides the order inside each one.
 */
function group(items: ContentItem[]): Group[] {
  const byLetter = new Map<string, ContentItem[]>();
  for (const item of items) {
    const letter = letterOf(item.name);
    const pool = byLetter.get(letter);
    if (pool) {
      pool.push(item);
    } else {
      byLetter.set(letter, [item]);
    }
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => {
      if (a === b) {
        return 0;
      }
      if (a === OTHER || b === OTHER) {
        return a === OTHER ? 1 : -1;
      }
      return a < b ? -1 : 1;
    })
    .map(([letter, rows]) => ({ letter, rows }));
}

export function LetterIndex({
  items,
  returning,
  onOpen,
  onPlay,
}: {
  items: ContentItem[];
  /** The record just come back from: its sleeve lands on that tile. See `coverMorph`. */
  returning: string | null;
  onOpen: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
}) {
  const groups = useMemo(() => group(items), [items]);

  const jump = (letter: string): void => {
    document.getElementById(`cx-letter-${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="cx-index">
      <div className="cx-index-body">
        {groups.map(({ letter, rows }, at) => (
          <section className="cx-index-sec" key={letter} id={`cx-letter-${letter}`} data-first={at === 0 || undefined}>
            <div className="cx-index-head">
              <span className="disp cx-index-letter">{letter}</span>
              <span className="cx-index-rule" />
              <span className="mono cx-index-count">{rows.length}</span>
            </div>
            <div className="cx-grid">
              {rows.map((row, index) => (
                <Tile
                  key={row.id}
                  item={row}
                  index={index}
                  anchor={row.id === returning}
                  onOpen={() => onOpen(row)}
                  onPlay={() => onPlay(row)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {groups.length > 1 && (
        /* The rail runs the height of the index and sticks halfway down it, so it is beside the rows
           rather than parked above them. */
        <nav className="cx-index-rail" aria-label="Jump to a letter">
          <span className="cx-index-ruler mono">
            {groups.map(({ letter }) => (
              <button type="button" key={letter} onClick={() => jump(letter)}>
                {letter}
              </button>
            ))}
          </span>
        </nav>
      )}
    </div>
  );
}
