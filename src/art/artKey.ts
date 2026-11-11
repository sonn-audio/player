import type { ApiTrack } from '@/api/types';

/**
 * A stable identity for "the artwork changed", for every cross-dissolve.
 *
 * The cover address is not a reliable trigger on its own: the per-zone cover url deliberately does
 * not change when the picture does. The album's own artwork url does, and pairing it with the title
 * covers a single sleeve with a queue behind it — a dissolve per track on one album is right, because
 * the dissolve is what says "something happened".
 */
export function artKeyOf(track: ApiTrack | null | undefined): string {
  return track ? `${track.coverUrl}|${track.title}` : 'none';
}
