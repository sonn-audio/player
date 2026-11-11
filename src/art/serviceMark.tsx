/**
 * A service, as a mark rather than a panel.
 *
 * Five services once took the whole front of the catalogue: five tall panels with a rack of records
 * in each, which is a great deal of room spent saying *there are five services*. A service is a place
 * you go through, not a thing you look at — so it is a mark in a row, the way every music app that
 * has thought about it draws one, and the room that buys goes to music you can actually press.
 * It is a ring on the panel, in silver like everything else that is not a sleeve: a logo sits in it
 * in grey and takes its own colour when it is pointed at.
 *
 * The mark is the service's own logo, from `public/icons/service-<id>.svg`. A logo is a trademark
 * and not something a player gets to draw from memory, so it is the real file or nothing: the three
 * that ship are the official app icons. A service with no file — the library, the radio shelf, both
 * of which are ours rather than anyone's brand — falls back to a drawing of what it is, or its monogram. `.png` is tried after `.svg`, so which kind
 * a file is never has to be configured.
 */
const TAG: Record<string, string> = {
  spotify: 'SP',
  applemusic: 'AM',
  ytmusic: 'YT',
  radio: 'RA',
  library: 'LIB',
};

/** Two or three capitals for a service, for a row that has to say where it came from. */
export function serviceTag(service: string): string {
  return TAG[service] ?? service.slice(0, 2).toUpperCase();
}

/** The drawn marks: the library as a record, the radio as waves. Null for a service with a logo file. */
export function serviceGlyph(service: string): React.ReactNode | null {
  if (service === 'library') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <circle cx="24" cy="24" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
        <circle cx="24" cy="24" r="3.6" fill="currentColor" />
      </svg>
    );
  }
  if (service === 'radio') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="26" r="3.4" fill="currentColor" />
        <path d="M15.5 34.5a12 12 0 0 1 0-17M32.5 17.5a12 12 0 0 1 0 17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M9.5 40.5a20.5 20.5 0 0 1 0-29M38.5 11.5a20.5 20.5 0 0 1 0 29" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }
  return null;
}
