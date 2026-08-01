/**
 * What the listener is actually hearing.
 *
 * This is the one thing a player could not tell you before: sendspin showed its own client the
 * format and the admin UI had it under `tech`, but the public API did not. It answers the
 * question a person with good speakers actually asks — "am I getting the lossless one?"
 *
 * Two properties of the field decide how it is drawn:
 *
 *  - **It is the format on the wire, not the file's.** A zone whose output cannot take 192 kHz
 *    gets it resampled, so two zones playing one track legitimately differ. That makes this
 *    per-zone information, shown next to the output, rather than a property of the track.
 *  - **`bitrate` is a live measurement.** It is null on a stream's first event and then moves
 *    every second (48 → 58 → 59 kbps observed on one FLAC stream). Rendering it raw would
 *    flicker, so it is rounded to kbps, and the codec/rate/depth — which are stable — carry the
 *    meaning. A quiet passage genuinely encodes smaller; that is not a glitch to smooth away.
 */
import { ServiceBadge, sourceServiceId } from '@/components/ServiceBadge';
import type { ApiAudioFormat, ApiSource, ApiStreamFormat } from '@/api/types';

/** Codecs that carry every bit of the source. Used only to label, never to hide anything. */
const LOSSLESS = new Set(['pcm', 'flac', 'alac', 'wav', 'aiff', 'dsd']);

/**
 * Whether a codec name carries every bit of its input.
 *
 * Exported because the signal path needs the same judgement and a second list would drift from
 * this one. `codec` is an open set — an unrecognised name is treated as lossy, which is the safe
 * direction: claiming lossless for something we have never heard of is the one wrong answer.
 */
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
export function FormatChips({ format }: { format: ApiAudioFormat | null }) {
  const output = format?.output;
  if (!format || !output) {
    return null;
  }

  const source = format.source;
  const sourceLossless = source ? isLosslessCodec(source.codec) : null;
  const outputLossless = isLosslessCodec(output.codec);
  /*
   * The verdict, strongest true statement first.
   *
   * `bitPerfect` outranks everything: the lossless source reached the output untouched. A *lossy*
   * source outranks what happened downstream, because no conversion puts back what an encoder threw
   * away — and saying "lossless" about an MP3 upsampled to 24/96 would be the one genuinely
   * misleading thing this row could do.
   */
  const verdict = format.bitPerfect
    ? 'bit-perfect'
    : sourceLossless === false
      ? `from ${source!.codec.toUpperCase()}`
      : format.dspApplied
        ? 'converted'
        : outputLossless
          ? 'lossless'
          : 'lossy';
  const good = format.bitPerfect || (!format.dspApplied && outputLossless && sourceLossless !== false);

  return (
    <>
      <span className="chip" data-lossless={good || undefined}>
        {verdict}
      </span>
      <span className="chip">{output.codec.toUpperCase()}</span>
      {output.sampleRate > 0 && <span className="chip">{formatSampleRate(output.sampleRate)}</span>}
      {output.bitDepth > 0 && <span className="chip">{output.bitDepth}-bit</span>}
      {output.highRes && <span className="chip">high-res</span>}
    </>
  );
}

/**
 * Where it came from, as the first chip of that row.
 *
 * `source.name` is the display name the zone reports ("Apple Music", a station, an input's label) and
 * the logo is matched on it, since a zone carries no service *id*. When the name is empty — a station
 * whose metadata has not arrived — the `kind` stands in, because there the machine word genuinely is
 * the only thing known. And when even that is missing there is no chip, rather than an empty box.
 */
export function SourceChip({ source }: { source: ApiSource }) {
  const name = source.name.trim();
  if (!name) {
    return source.kind ? <span className="chip">{source.kind}</span> : null;
  }
  return (
    <span className="chip chip-source" title={name}>
      <ServiceBadge service={sourceServiceId(name)} label={name} />
    </span>
  );
}

export function StreamFormat({
  format,
  /**
   * One line: the verdict chip and the codec/rate/depth, nothing else.
   *
   * The full block answers "what exactly is happening to this audio", which is worth a paragraph
   * in the now-playing view and is noise in a 48px-tall bar — there the question is only "is this
   * still the good version". The DSP/source line and the drifting bitrate are what go; both are a
   * scroll away in the signal path, which is where someone asking that question is looking.
   */
  compact = false,
}: {
  format: ApiAudioFormat | null;
  compact?: boolean;
}) {
  // Null while the zone streams nothing — the same "absent means absent" convention as
  // `track`, so there is nothing to draw rather than an empty row to draw.
  if (!format) {
    return null;
  }

  const output = format.output;
  if (!output) return null;
  const source = format.source;
  const sourceLossless = source ? isLosslessCodec(source.codec) : false;
  const outputLossless = isLosslessCodec(output.codec);
  /*
   * The chip is a **verdict**, never a codec.
   *
   * It used to fall back to `output.codec`, which sits immediately beside it in `describeFormat` —
   * so a PCM stream rendered as "PCM · PCM · 44.1 kHz · 24-bit". A chip that repeats its
   * neighbour is worse than no chip: it costs the same room and answers nothing. Every branch
   * here says something the detail line cannot.
   */
  const label = format.bitPerfect
    ? 'bit-perfect'
    : // A lossy origin is the fact that outranks everything downstream: no amount of
      // upsampling puts back what the encoder threw away, so name the source codec.
      source && !sourceLossless
      ? `from ${source.codec.toUpperCase()}`
      : format.dspApplied
        ? 'converted'
        : outputLossless
          ? 'lossless'
          : 'lossy';
  const kbps = output.bitrate === null ? null : Math.round(output.bitrate / 1000);

  const lossless =
    format.bitPerfect || (sourceLossless && !format.dspApplied) || undefined;

  if (compact) {
    return (
      <p className="stream-format compact">
        <span className="chip" data-lossless={lossless}>
          {label}
        </span>
        <span className="stream-format-detail">{describeFormat(output)}</span>
      </p>
    );
  }

  return (
    <div className="stream-format-block">
      <p className="stream-format">
        <span className="chip" data-lossless={lossless}>
          {label}
        </span>
        <span className="stream-format-detail">
          {describeFormat(output)}
          {output.highRes && <span className="stream-format-rate"> · high-res</span>}
          {kbps !== null && <span className="stream-format-rate"> · {kbps} kbps</span>}
        </span>
      </p>
      <p className="format-flags">
        {format.dspApplied ? 'DSP applied' : 'No server DSP'}
        {format.source && ` · source ${describeFormat(format.source)}`}
      </p>
    </div>
  );
}
