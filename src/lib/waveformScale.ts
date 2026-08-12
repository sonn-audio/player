/**
 * How a measured level becomes the height of a waveform bar.
 *
 * The server measures in dB and sends it that way — the analysis stream's u16 and the prepared
 * waveform's byte are both a position in the [floor, 0] dB window. That is the right thing to send:
 * it is a measurement, it matches the meters, and a client that wants levels can have them.
 *
 * It is the wrong thing to *draw*. Measured over two mastered tracks, the median bucket sits at 79%
 * of a 60 dB window and the 5th-to-95th percentile spans 16% of it, so the whole song lives in the
 * top fifth and the timeline is a block with a texture on it — the quiet intro, the chorus and the
 * outro all render the same height. Scaling that up does not help: multiplying a 16% spread by any
 * gain leaves it a 16% spread of whatever it is now.
 *
 * A waveform is a picture of amplitude, and amplitude is linear — which is why the one in Audacity
 * shows a chorus and a dB meter does not. Undoing the log restores the dynamics that were always in
 * the reading: the same two tracks go from an 16% spread to 53% and 70%.
 *
 * The two callers differ in one honest way, and it is why this is shared code rather than a helper in
 * each of them. A **prepared** shape is the whole track, so it can be normalised against that track's
 * own peak, which is what every waveform display does. A **recorded** envelope is being written as the
 * music plays and cannot know a peak it has not reached yet; renormalising every time a louder passage
 * arrives would rescale every bar on screen. So it uses a fixed reference chosen to land where
 * normalising a mastered track lands, and clips above it. Same curve, same character; one is exact
 * and the other is close, and no track's picture changes shape depending on which drew it.
 */

/** The dB floor the server's analysis window starts at. Mirrors `ANALYSIS_DB_FLOOR`. */
export const ANALYSIS_DB_FLOOR = -60;

/**
 * Full height for a live recording, in dBFS.
 *
 * Short-term RMS on mastered music peaks around here, so a track being recorded reaches the top of
 * the display at about the point a prepared one would after normalising. Chosen to make the two look
 * alike rather than from anything in the signal.
 */
const RECORDED_FULL_SCALE_DB = -9;

/** The tallest bar of a prepared shape, leaving a little air under the top edge. */
const HEADROOM = 0.94;

/**
 * Below this peak a track is treated as silence rather than normalised.
 *
 * Without it, a file that is 40 dB down — a mis-ripped track, a long fade, an empty recording — would
 * be stretched into a full-height picture of its own noise floor, which is a confident-looking lie.
 */
const SILENCE_PEAK = 0.01;

/** A position in the analysis dB window (0…1) to linear amplitude (0…1). */
export function dbPositionToAmplitude(position: number): number {
  if (position <= 0) {
    return 0;
  }
  const db = ANALYSIS_DB_FLOOR + Math.min(1, position) * -ANALYSIS_DB_FLOOR;
  return 10 ** (db / 20);
}

/** One live reading to a bar height, against the fixed reference. */
export function recordedBarHeight(position: number): number {
  const amplitude = dbPositionToAmplitude(position);
  return Math.min(1, amplitude / 10 ** (RECORDED_FULL_SCALE_DB / 20));
}

/**
 * Reduce a set of levels to exactly as many bars as are being drawn.
 *
 * The count of levels and the count of bars are different questions, and treating them as one is
 * what broke the display: the prepared shape arrives as 400 buckets and the recorded envelope as
 * 220, while the strip they are drawn in is whatever the layout gives it. Rendering one bar per
 * bucket made the picture's width a property of the *data*, so on any strip narrower than the bars
 * needed it ran past the timeline and, worse, stopped agreeing with the playhead — which is
 * positioned as a percentage of the strip, not of the bars.
 *
 * The reduction takes the **maximum** of each group, not the mean. A waveform is a picture of peaks;
 * averaging a drum hit with the silence either side of it is how a dynamic track ends up looking
 * like a flat block. It also keeps the "nothing recorded here" marker intact: -1 loses to any real
 * reading, so a group is only void when all of it is.
 *
 * Never invents detail — asked for more bars than there are levels, it returns what it has and the
 * bars simply come out wider.
 *
 * Takes `ArrayLike` because the two sources are not the same kind of array: a prepared shape is a
 * `number[]` and a live recording is a `Float32Array`.
 */
export function fitLevels(levels: ArrayLike<number>, count: number): number[] {
  if (count <= 0 || levels.length === 0) {
    return [];
  }
  if (count >= levels.length) {
    return Array.from(levels);
  }
  const out = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor((index * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / count));
    let peak = -1;
    for (let at = from; at < to; at += 1) {
      const value = levels[at] ?? -1;
      if (value > peak) {
        peak = value;
      }
    }
    out[index] = peak;
  }
  return out;
}

/** A whole prepared track to bar heights, normalised to its own peak. */
export function preparedBarHeights(positions: number[]): number[] {
  const amplitudes = positions.map(dbPositionToAmplitude);
  const peak = amplitudes.reduce((max, value) => (value > max ? value : max), 0);
  if (peak < SILENCE_PEAK) {
    return amplitudes;
  }
  const gain = HEADROOM / peak;
  return amplitudes.map((value) => Math.min(1, value * gain));
}
