/**
 * A service in two or three capitals, for a row on a page that mixes services and has to say where
 * each came from. Letters rather than a colour or a logo: the sleeve is the only colour on this face.
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
