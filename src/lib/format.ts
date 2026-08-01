/** Small display helpers. No API knowledge beyond what the contract already states. */

/**
 * Seconds as `m:ss`, or `h:mm:ss` past an hour.
 *
 * A duration of `0` means open-ended (live radio) rather than a zero-length track, so
 * callers show `liveLabel` instead of `0:00` — that distinction is in the contract and
 * losing it here would make every radio station look like a broken track.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** What to show for a zone's position when `duration` is 0. */
export const LIVE_LABEL = 'Live';

/**
 * What to call a queue entry whose title is empty.
 *
 * Real entries arrive with `title: ''`: a station queued before its stream metadata lands, a local
 * file with no tags. The row then rendered as a highlighted bar with nothing in it, which reads as a
 * rendering bug rather than as "we do not know yet" — and it is the *playing* row that this happens
 * to most, since that is the one queued a second ago.
 *
 * The fallbacks are in order of how much they say, ending at the one thing that is always true: an
 * entry with no duration is open-ended, which is a live stream.
 */
export function entryTitleOf(entry: {
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}): string {
  return (
    entry.title.trim() ||
    entry.artist?.trim() ||
    entry.album?.trim() ||
    (entry.duration ? 'Untitled' : 'Live stream')
  );
}

/**
 * The line under a track title.
 *
 * Both `artist` and `album` are empty strings on plenty of real sources (a bare stream, a
 * line-in), so this joins whatever is actually there rather than emitting ` — `.
 */
export function subtitleOf(track: { artist: string; album: string } | null): string {
  if (!track) {
    return '';
  }
  return [track.artist, track.album].filter(Boolean).join(' — ');
}

/**
 * A title split into what it is and what edition it is.
 *
 * Streaming catalogues carry the qualifier inside the title — `Choose Life (Radio Version)`,
 * `Father Figure (2010 Remastered Version)`, `Play (Extended Edition)`, `[Explicit]` — and at display
 * size that parenthetical arrives with the same weight as the song's name. It is the least important
 * half of the string and typographically the loudest, because it is usually the longest.
 *
 * Only the *last* trailing group counts, and only when it trails. Two rules, both learned from real
 * catalogue strings:
 *
 *  - `(Don't Fear) The Reaper` opens with a parenthesis that is part of the name, so a group that is
 *    not at the end is left alone.
 *  - `Money (That's What I Want) [Stereo Mix]` has both kinds at once, which is why the match is greedy
 *    and takes only `[Stereo Mix]`. Taking every trailing group would shrink half the song's name.
 *
 * An unbalanced bracket is left as it is: a title is not worth guessing at.
 */
export function splitQualifier(title: string): { main: string; qualifier: string } {
  const raw = (title ?? '').trim();
  // Main text, then one or more bracketed groups with nothing but the closing bracket after them.
  const match = /^(.*\S)\s*((?:[([][^()[\]]*[)\]]\s*)+)$/.exec(raw);
  if (!match || !match[1]) {
    return { main: raw, qualifier: '' };
  }
  return { main: match[1], qualifier: match[2]!.trim() };
}
