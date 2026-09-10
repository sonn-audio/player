/**
 * Reading a stream format: is it lossless, and what does it say out loud.
 *
 * All that is left of a file that also drew the format chips and the source badge under a track
 * title. That nameplate belonged to the technical player; the one surface that still asks these
 * questions is the signal view's chain, and it asks them as *questions* — two pure functions over
 * `ApiStreamFormat` — rather than as components.
 */
import type { ApiStreamFormat } from '@/api/types';

/** Codecs that carry every bit of the source. Used only to label, never to hide anything. */
const LOSSLESS = new Set(['pcm', 'flac', 'alac', 'wav', 'aiff', 'dsd']);

export function isLosslessCodec(codec: string): boolean {
  return LOSSLESS.has(codec.toLowerCase());
}

/**
 * The engraved-nameplate form: `FLAC 24/192`.
 *
 * Depth over rate in kHz, the way hi-fi has always written it, so two of these can be compared
 * character by character across an arrow. `describeFormat` is the prose version for a line that
 * has room; this is the version for a line that does not.
 */
export function shortFormat(format: ApiStreamFormat): string {
  const khz = format.sampleRate > 0 ? Math.round(format.sampleRate / 1000) : 0;
  const codec = format.codec.toUpperCase();
  if (!khz) {
    return codec;
  }
  return format.bitDepth > 0 ? `${codec} ${format.bitDepth}/${khz}` : `${codec} ${khz}k`;
}

/** `44100` → `44.1 kHz`, dropping a trailing `.0` so 48 kHz is not `48.0 kHz`. */
function formatSampleRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) {
    return '';
  }
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

/**
 * The one-line summary, e.g. `FLAC · 44.1 kHz · 16-bit`.
 *
 * Channels are only mentioned when they are *not* plain stereo: "2 channels" on every row is
 * noise, while "1 channel" or "6 channels" is the surprising thing worth saying.
 */
export function describeFormat(format: ApiStreamFormat): string {
  const parts = [format.codec.toUpperCase()];
  const rate = formatSampleRate(format.sampleRate);
  if (rate) {
    parts.push(rate);
  }
  if (format.bitDepth > 0) {
    parts.push(`${format.bitDepth}-bit`);
  }
  if (format.channels === 1) {
    parts.push('mono');
  } else if (format.channels > 2) {
    parts.push(`${format.channels} channels`);
  }
  return parts.join(' · ');
}

/**
 * The identity of what you are hearing, as chips: `LOSSLESS · PCM · 44.1 kHz · 16-bit`.
 *
 * Returns the chips themselves rather than a row, so the caller can put something in front of them —
 * the provider is the first chip in the now-playing block, because "where did this come from" belongs
 * with "what is it" rather than trailing the album title.
 *
 * One fact per chip, verdict first. The alternative — one chip and a sentence — was what the hero
 * used to carry, and it read as a caption; separating them makes each value findable at a glance,
 * which is how a nameplate on a piece of equipment works and is the whole point of putting this
 * under the title rather than in a panel.
 *
 * This is not a second copy of the signal path. The path in the rail answers "what happened to this
 * audio, in order" and ends in the measured bitrate; these four chips answer "am I hearing the good
 * version", which is the question that belongs beside the track name. The verdict lives here only —
 * the rail no longer repeats it.
 */
