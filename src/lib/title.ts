/**
 * A track's name, and the version notes stores hang off it.
 *
 * `Natural Blues (TECIE) [Extended Mix]`, `Heaven (feat. Raphaella) [Mixed]`, `Blue Lines (2012 Mix/Master)`,
 * `Majesty - Live`: the record is called one thing and the catalogue appends what edition of it this is.
 * On a poster the name is the title and the edition is a line of small type under it — a 96px title that
 * breaks onto a second line for `[Extended Mix]` has let the filing system set the type.
 *
 * Only *trailing* groups are taken, and a round-bracketed one only when it says something edition-like:
 * `(Don't Fear) The Reaper` and `Time (Clock of the Heart)` keep their brackets, because those are the
 * name. Square brackets are always an aside. A ` - Extended Mix` suffix (the Spotify spelling) is the
 * same aside in a different coat. What is taken is kept, in order, as tags.
 */
export type TitleParts = { main: string; tags: string[] };

const EDITION =
  /\b(remix|mix|edit|live|version|remaster(?:ed)?|feat\.?|featuring|ft\.?|acoustic|radio|extended|instrumental|demo|mono|stereo|deluxe|bonus|session|dub|rework|cut|edition|mixed|explicit|clean|unplugged|orchestral|reprise|rmx|vip|\d{4})\b/i;

export function splitTitle(title: string): TitleParts {
  let main = title.trim();
  const tags: string[] = [];
  for (;;) {
    const match = main.match(/\s*([([])([^()[\]]+)[)\]]\s*$/);
    if (!match || match.index === undefined) {
      break;
    }
    const inner = match[2]!.trim();
    const square = match[1] === '[';
    if (!square && !EDITION.test(inner)) {
      break;
    }
    tags.unshift(inner);
    main = main.slice(0, match.index).trim();
  }
  const dash = main.match(/\s+[-–—]\s+([^-–—]+)$/);
  if (dash && dash.index !== undefined && EDITION.test(dash[1]!) && main.slice(0, dash.index).trim()) {
    tags.unshift(dash[1]!.trim());
    main = main.slice(0, dash.index).trim();
  }
  return main ? { main, tags } : { main: title, tags: [] };
}

/** The name alone, for a line that has no room for the edition. */
export function mainTitle(title: string): string {
  return splitTitle(title).main;
}

/** `Single` and `EP` are what a store calls a record with one track on it: not a name, a shape. */
export function bareAlbum(album: string): string {
  return splitTitle(album.replace(/\s+-\s+(single|ep)$/i, '')).main;
}
