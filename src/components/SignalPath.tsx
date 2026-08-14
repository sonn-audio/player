/**
 * What happens to the audio between the source and the speaker, stage by stage.
 *
 * This panel used to be built from two booleans — `bitPerfect` and `dspApplied` — and its own comment
 * admitted the cost: the genre convention (Roon's signal path) lists the resampler, the requantisation,
 * the gain and the analogue stage, and none of that existed in `/api/v1`, so the panel showed "DSP
 * applied" over a chain that might have done any of six different things. The contract now carries the
 * chain itself (`format.processing`, added for this), which is why every row below is a fact the server
 * reported rather than an inference:
 *
 *  - `resampled` + `resampler` — soxr, and how it was configured.
 *  - `requantised` / `channelsRemapped` — depth and channel count changing.
 *  - `gainDb` — split by origin: the source's own loudness normalisation, and the output's fixed trim.
 *  - `delayMs` — pre-delay for aligning this room against another.
 *  - `equalizer` — the ten bands, when any is off zero.
 *  - `reencoded` — the output codec throwing samples away.
 *  - `crossfading` — the blend, which requantises by definition.
 *
 * Two rules keep it honest:
 *
 *  - **A stage that did nothing still shows.** "None" and "not needed" are answers; hiding the row
 *    would make "we did not resample" indistinguishable from "we cannot tell you", and the difference
 *    is the whole point of the panel. Only stages that do not *apply* are absent — a crossfade that is
 *    not happening, a delay of zero.
 *  - **Nothing is inferred.** When `processing` is null (an older server, or a zone streaming nothing)
 *    the chain says so instead of reporting a tidy row of "no".
 *
 * The dots carry the state: `on` for a stage that is doing something, `idle` for one that is present
 * and passive — no DSP is *good* news — and `off` for one that cannot report, which is the case worth
 * seeing before pressing play.
 */
import { useEffect, useRef } from 'react';
import { describeFormat, isLosslessCodec } from '@/components/StreamFormat';
import { useServer } from '@/state/ServerContext';
import type { ApiProcessingChain, ApiStreamFormat, ApiZoneState } from '@/api/types';

/**
 * Each room's recent lead readings, module-level so a room switch does not forget the other room's
 * trace and a re-mount does not start the line over. One entry per zone event — the stream ticks
 * once a second while playing, so the buffer is roughly the last two minutes.
 */
const leadTraces = new Map<number, number[]>();

/** How many readings the trace keeps. */
const TRACE_LENGTH = 120;

type Stage = {
  label: string;
  value: string;
  /**
   * Secondary facts, rendered under the value and quieter.
   *
   * The resampler's settings, an equalizer's bands, the measured bitrate. The bitrate in particular is
   * a live reading that moves every second, so putting it in `value` makes
   * the main line twitch — the wrong quality for a panel whose job is "this is what is happening,
   * steadily".
   */
  detail?: string | undefined;
  /** `on` — active; `idle` — present and passive; `off` — absent or unreachable. */
  state: 'on' | 'idle' | 'off';
};

/** `44100` → `44.1 kHz`. Local to this file: the chain compares rates, it does not describe formats. */
function khz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) {
    return '—';
  }
  const value = hz / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} kHz`;
}

/** `+3.0 dB` / `-2.5 dB` / `0 dB`, with the sign always shown because its direction is the point. */
function db(value: number): string {
  if (value === 0) {
    return '0 dB';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

/** Which bands are off flat, as `63 Hz +2 · 4 kHz -3`. Ten ISO centres, low band first. */
const EQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function describeEqualizer(bands: number[]): string {
  const set = bands
    .map((gain, index) => ({ gain, hz: EQ_BANDS[index] ?? 0 }))
    .filter((band) => band.gain !== 0)
    .map((band) => `${band.hz >= 1000 ? `${band.hz / 1000}k` : band.hz} ${band.gain > 0 ? '+' : ''}${band.gain}`);
  return set.join(' · ');
}

/**
 * The conversion rows, from the reported chain.
 *
 * Split out because this is where the panel earns its keep, and because the *order* is the pipeline's
 * rather than the payload's: delay, then gain, then the resampler, then the equalizer — which is the
 * order the filters actually run in (`buildFilterArgs` server-side), so reading down the list is
 * reading the signal.
 */
function conversionStages(
  chain: ApiProcessingChain,
  source: ApiStreamFormat | null,
  output: ApiStreamFormat | null,
): Stage[] {
  const stages: Stage[] = [];

  // Only when there is one: a delay of zero is not a stage, it is the absence of one.
  if (chain.delayMs !== null && chain.delayMs > 0) {
    stages.push({
      label: 'Delay',
      value: `${Math.round(chain.delayMs)} ms`,
      detail: 'aligning this room against another output',
      state: 'on',
    });
  }

  stages.push(
    chain.gainDb
      ? {
          label: 'Gain',
          value: db(chain.gainDb.source + chain.gainDb.output),
          // Where it came from, because the two are set in different places and fixed differently:
          // one is the provider's loudness normalisation, the other is this output's trim.
          detail: [
            chain.gainDb.source !== 0 ? `${db(chain.gainDb.source)} source` : null,
            chain.gainDb.output !== 0 ? `${db(chain.gainDb.output)} output trim` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          state: 'on',
        }
      : { label: 'Gain', value: 'Unity — no change', state: 'idle' },
  );

  const rateChanged = Boolean(source && output && source.sampleRate !== output.sampleRate);
  /*
   * Why the resampler ran when the rates match.
   *
   * Two causes, and they are worth telling apart: a filter in the chain forces the path, or nobody
   * declared the source format in time — the bypass is decided when the command line is built, so a
   * format learned afterwards (from ffmpeg's own probe) cannot un-run the resampler. Radio is the second
   * case, and "ran at the same rate" without the reason reads as a bug in the server.
   */
  const forcedByFilter = Boolean(chain.equalizer || chain.gainDb || chain.delayMs);
  stages.push(
    chain.resampled
      ? {
          label: 'Resample',
          /*
           * Three different truths, and they must not be collapsed. Rates differ: name both. Rates are
           * equal and the resampler still ran: a filter forced the path, which is worth saying. The
           * source rate is unknown (a stream that declares nothing): say *that*, rather than claiming
           * the rates matched — which we cannot know.
           */
          value:
            rateChanged && source && output
              ? `${khz(source.sampleRate)} → ${khz(output.sampleRate)}`
              : 'Ran at the same rate',
          detail: [
            chain.resampler
              ? `${chain.resampler.name} · precision ${chain.resampler.precision} · cutoff ${chain.resampler.cutoff}`
              : null,
            rateChanged
              ? null
              : forcedByFilter
                ? 'a filter in the chain forced it'
                : 'the source was undeclared, so the bypass could not be taken',
          ]
            .filter(Boolean)
            .join(' · '),
          state: 'on',
        }
      : { label: 'Resample', value: 'Not needed — bypassed', state: 'idle' },
  );

  /*
   * Depth: read off the two formats rather than off the flag.
   *
   * `requantised` is the engine's own decision, made from what it knew when it built the chain — so a
   * stream whose depth was learned later reports `false` while the numbers plainly change. And the two
   * directions are not the same thing: 24 → 16 throws information away, 16 → 24 pads and loses nothing,
   * and a row that calls both "requantised" is the kind of alarm people learn to ignore.
   */
  const depthChanged =
    source?.bitDepth != null && output?.bitDepth != null && source.bitDepth !== output.bitDepth;
  const reduced = depthChanged && (output?.bitDepth ?? 0) < (source?.bitDepth ?? 0);
  stages.push(
    depthChanged || chain.requantised
      ? {
          label: 'Depth',
          value:
            source?.bitDepth != null && output?.bitDepth != null
              ? `${source.bitDepth}-bit → ${output.bitDepth}-bit`
              : 'Changed',
          detail: reduced ? 'reduced — information dropped' : 'padded — nothing lost',
          // Padding is not an alteration worth an accent: it is a wider container for the same audio.
          state: reduced ? 'on' : 'idle',
        }
      : { label: 'Depth', value: 'Kept', state: 'idle' },
  );

  // Stereo in, stereo out is the overwhelming case and says nothing; a remap is worth a row.
  if (chain.channelsRemapped && source && output) {
    stages.push({
      label: 'Channels',
      value: `${source.channels} → ${output.channels}`,
      detail: output.channels < source.channels ? 'downmixed' : 'upmixed',
      state: 'on',
    });
  }

  stages.push(
    chain.equalizer
      ? {
          label: 'Equalizer',
          value: `${chain.equalizer.bands.filter((gain) => gain !== 0).length} bands`,
          detail: describeEqualizer(chain.equalizer.bands),
          state: 'on',
        }
      : { label: 'Equalizer', value: 'Flat', state: 'idle' },
  );

  // Transient, so it is absent rather than "not crossfading": a row that is false 99% of the time
  // teaches people to stop reading the panel.
  if (chain.crossfading) {
    stages.push({
      label: 'Crossfade',
      value: 'Blending two tracks',
      detail: 'the blend requantises by definition',
      state: 'on',
    });
  }

  stages.push(
    chain.reencoded && output
      ? {
          label: 'Encode',
          value: `${output.codec.toUpperCase()} — re-encoded`,
          detail: output.bitrate === null ? 'lossy' : `lossy · ${Math.round(output.bitrate / 1000)} kbps`,
          state: 'on',
        }
      : {
          label: 'Encode',
          value: output ? `${output.codec.toUpperCase()} — samples carried` : 'Nothing streaming',
          detail: output && isLosslessCodec(output.codec) ? 'lossless container' : undefined,
          state: output ? 'idle' : 'off',
        },
  );

  return stages;
}

function stagesOf(zone: ApiZoneState): Stage[] {
  const format = zone.format;
  const source = format?.source ?? null;
  const output = format?.output ?? null;
  const chain = format?.processing ?? null;
  const device = zone.output?.device;

  const stages: Stage[] = [
    {
      label: 'Source',
      /*
       * `format.source` is null in two different situations and they must not read alike: nothing
       * is playing, or something is playing and the server did not report what it came from.
       * The second is normal — a re-encoding path often does not carry the origin — and marking
       * it as a fault put an orange dot on a healthy stream.
       */
      value: source ? describeFormat(source) : output ? 'Not reported' : 'Nothing playing',
      ...(source
        ? { detail: isLosslessCodec(source.codec) ? 'lossless' : 'lossy — encoded before it reached us' }
        : {}),
      state: source ? 'on' : output ? 'idle' : 'off',
    },
  ];

  if (chain) {
    stages.push(...conversionStages(chain, source, output));
  } else {
    /*
     * The server did not describe its chain.
     *
     * Reported rather than filled in with a tidy row of "no": an older server and a server that did
     * nothing to the audio are different claims, and only one of them is knowable here. `dspApplied`
     * is all there is to fall back on, so that is exactly what this row says.
     */
    stages.push({
      label: 'Processing',
      value: format
        ? format.dspApplied
          ? 'Applied by this server'
          : 'None — passed through'
        : 'Nothing streaming',
      // The claim about the server belongs only where it is true: a zone streaming nothing has no chain
      // to describe, which is not the same as a server that cannot describe one.
      ...(format ? { detail: 'this server does not report the individual stages' } : {}),
      state: format?.dspApplied ? 'on' : format ? 'idle' : 'off',
    });
  }

  if (zone.output) {
    // The device name is worth more than the protocol to someone reading this, so it leads
    // when there is one; `connected === false` is the reason this row can be `off`.
    const name = device?.name;
    stages.push({
      label: 'Output',
      value: name ? `${name} · ${zone.output.protocol}` : zone.output.protocol,
      ...(device?.connected === false ? { detail: 'not connected' } : {}),
      state: device?.connected === false ? 'off' : 'on',
    });
  }

  /*
   * What is on the wire, at the end of the chain, because that is the point at which it is true.
   * The measured throughput lands in `detail` — it moves every second and the main line should not.
   */
  const wireDetail = output
    ? [
        output.highRes ? 'high-res' : null,
        output.bitrate === null ? null : `${Math.round(output.bitrate / 1000)} kbps`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  stages.push({
    label: 'On the wire',
    value: output ? describeFormat(output) : 'Nothing streaming',
    ...(wireDetail ? { detail: wireDetail } : {}),
    state: output ? 'on' : 'off',
  });

  return stages;
}

/**
 * Which rooms cannot play the source as it arrived, this one first.
 *
 * A speaker is only ever handed a format it declared: the server checks `supported_formats` before
 * it follows the source's own rate, and a grouped room is fed the leader's stream verbatim — so one
 * member that never declared 44.1 kHz holds the whole group at 48 kHz, and the room you are looking
 * at may not be the one that cannot do it. Naming the wrong device is worse than naming none: the
 * point of the reason line is that it tells you what to change.
 *
 * Read off each room's own `output.capabilities.formats` — the devices' own word, not a second copy
 * of the server's negotiation rule, so it stays true if that rule changes. A room that declared no
 * formats at all is not accused; no answer is not a no. An empty result means nothing can be pinned
 * on a device, and the caller says what happened without blaming anyone.
 */
function roomsThatCannotPlay(
  zone: ApiZoneState,
  zones: ApiZoneState[],
  target: { sampleRate: number; bitDepth: number; channels: number },
): ApiZoneState[] {
  const byId = new Map(zones.map((entry) => [entry.id, entry]));
  const others = (zone.group?.members ?? []).filter((id) => id !== zone.id);
  return [zone, ...others.map((id) => byId.get(id))]
    .filter((room): room is ApiZoneState => room != null)
    .filter((room) => {
      const formats = room.output?.capabilities?.formats;
      if (!formats?.length) {
        return false;
      }
      return !formats.some(
        (fmt) =>
          fmt.sampleRate === target.sampleRate &&
          fmt.bitDepth === target.bitDepth &&
          fmt.channels === target.channels,
      );
    });
}

/**
 * The headline: is this the file, or something we made from it?
 *
 * The goal this player is built around is that the source reaches the speaker unaltered — every stage in
 * the chain below is a way that can fail, and a list of eight rows does not tell you at a glance whether
 * it did. So the panel leads with the answer and, when the answer is "no", with the *reason*, which is
 * what turns a readout into something you can act on: "grouped with Kitchen, which cannot play 44.1 kHz"
 * names the thing to change. It said "this output is fixed at 48 kHz" for a while, which named nothing —
 * the rate was not a setting on this output at all, it was another room in the group.
 *
 * Three verdicts, and the distinction between the first two is the one audiophiles actually care about:
 *
 *  - **Bit-perfect** — a lossless source arrived and nothing here touched it. The file's own samples.
 *  - **Untouched** — nothing here touched it either, but the source was already lossy. Our chain is
 *    clean; the loss happened before it reached us, and no amount of care downstream undoes it.
 *  - **Altered** — this server changed the samples, and the reason says which stage did it.
 */
function Verdict({ zone }: { zone: ApiZoneState }) {
  // The other rooms, for the resample reason: a group shares one format, so the device that cannot
  // take the source's rate may be any of them.
  const { zones } = useServer();
  const format = zone.format;
  // Absent rather than "false" when nothing is streaming: "not bit-perfect" reads as a fault in a room
  // that is simply idle.
  if (!format?.output) {
    return null;
  }
  const chain = format.processing ?? null;
  const source = format.source;
  const output = format.output;

  /*
   * Why it was altered — the first cause in the order that matters to the ear.
   *
   * Re-encoding throws information away outright, a depth *reduction* dithers or truncates, and a
   * resample rewrites every sample; an equalizer and gain are deliberate and reversible choices, and a
   * delay moves audio in time without changing it. Only one is named: a list of five reasons is the
   * eight-row chain again, and the chain is right below.
   */
  const reason = ((): string | null => {
    if (!chain) {
      return format.dspApplied ? 'this server processed the stream' : null;
    }
    if (chain.reencoded) {
      return `re-encoded to ${output.codec.toUpperCase()} for this output`;
    }
    if (source?.bitDepth != null && output.bitDepth != null && output.bitDepth < source.bitDepth) {
      return `depth reduced to ${output.bitDepth}-bit for this output`;
    }
    if (chain.resampled && source && source.sampleRate !== output.sampleRate) {
      const rate = `${source.sampleRate / 1000} kHz`;
      const blocked = roomsThatCannotPlay(zone, zones, {
        sampleRate: source.sampleRate,
        // A lossy source has no depth of its own to preserve, so the depth on offer was the
        // output's own — which is the same rule the server applies when it picks the format.
        bitDepth: source.bitDepth ?? output.bitDepth,
        channels: output.channels,
      });
      const culprit = blocked[0];
      if (!culprit) {
        return `resampled to ${output.sampleRate / 1000} kHz for this output`;
      }
      if (culprit.id === zone.id) {
        return `resampled — this speaker cannot play ${rate}`;
      }
      if (blocked.length === 1) {
        return `resampled — grouped with ${culprit.name}, which cannot play ${rate}`;
      }
      return `resampled — grouped with rooms that cannot play ${rate}`;
    }
    if (chain.equalizer) {
      return 'the zone equalizer is not flat';
    }
    if (chain.gainDb) {
      return 'gain is applied in the chain';
    }
    if (chain.crossfading) {
      return 'a crossfade is blending two tracks';
    }
    if (chain.resampled) {
      return 'the resampler ran — the source format was not declared in time';
    }
    if (chain.delayMs) {
      return `delayed ${Math.round(chain.delayMs)} ms to align with another output`;
    }
    return null;
  })();

  const sourceLossless = source ? isLosslessCodec(source.codec) : null;
  const verdict = format.bitPerfect
    ? 'Bit-perfect'
    : reason
      ? 'Altered'
      : sourceLossless === false
        ? 'Untouched'
        : 'Untouched';
  const tone = format.bitPerfect ? 'perfect' : reason ? 'altered' : 'clean';

  const note = format.bitPerfect
    ? 'the file’s own samples reach the player'
    : reason
      ? reason
      : sourceLossless === false
        ? 'nothing here altered it — the source itself is lossy'
        : 'nothing in this server altered the samples';

  return (
    <div className="signal-verdict" data-tone={tone}>
      <p className="signal-verdict-head">{verdict}</p>
      <p className="signal-verdict-note">{note}</p>
    </div>
  );
}

/**
 * The clock, and the one knob on it.
 *
 * The stages above end at "on the wire", which is where a signal path normally stops — and it stops
 * one question short. Sendspin does not just hand bytes over: it negotiates a shared clock with the
 * device and each frame is scheduled to arrive a set distance ahead of when it must be heard. So the
 * last thing worth knowing is whether it lands on time, and that has two halves.
 *
 * `state` is the device's verdict, and it is the only party who can give one — the client asks us for
 * the time and runs its own filter over the answers, so the server never computes an offset, it only
 * learns whether the client locked on. The numbers beside it are our half: how far ahead frames
 * actually go out against the target, how evenly, and whether the timeline is slipping.
 *
 * There is no delay control here. It was, briefly, and this was the wrong home for it: the number only
 * means something beside the other rooms it is being lined up against, and this rail shows one room.
 * It lives on the grouping screen, where every member's offset sits on one shared axis.
 *
 * Nothing here is shown for outputs that have no clock to report on: `sync` is absent then, and an
 * empty timing block would read as "out of sync" rather than "not applicable".
 */
function Timing({ zone }: { zone: ApiZoneState }) {
  const sync = zone.output?.sync;

  /*
   * Sample the lead once per zone event — the event identity is the tick.
   *
   * The rail re-renders for reasons of its own (a hover elsewhere, an analysis frame), and appending
   * on every render would draw a trace whose x-axis is "how busy React was". A zone event is a new
   * object, so reference equality is exactly "one sample per report".
   */
  const lastZone = useRef<ApiZoneState | null>(null);
  useEffect(() => {
    if (lastZone.current === zone) {
      return;
    }
    lastZone.current = zone;
    const lead = zone.output?.sync?.leadMs;
    if (typeof lead !== 'number') {
      return;
    }
    const trace = leadTraces.get(zone.id) ?? [];
    trace.push(lead);
    if (trace.length > TRACE_LENGTH) {
      trace.splice(0, trace.length - TRACE_LENGTH);
    }
    leadTraces.set(zone.id, trace);
  });

  if (!sync) {
    return null;
  }

  const streaming = sync.leadMs !== null;
  const lock =
    sync.state === 'synchronized'
      ? { label: 'Locked', tone: 'ok' as const, note: 'the player is following our clock' }
      : sync.state === 'error'
        ? { label: 'Lost', tone: 'bad' as const, note: 'the player cannot hold the clock' }
        : sync.state === 'external_source'
          ? { label: 'Elsewhere', tone: 'warn' as const, note: 'the player switched to its own input' }
          : { label: 'Not reported', tone: 'idle' as const, note: 'the player has not said yet' };

  return (
    <div className="signal-timing">
      <h4 className="signal-timing-head">Clock</h4>

      <p className="signal-lock" data-tone={lock.tone}>
        <span className="signal-lock-label">{lock.label}</span>
        <span className="signal-lock-note">{lock.note}</span>
      </p>

      {/*
        Lead is stated against its target rather than alone: 334 ms means nothing until you know the
        server was aiming for 250. Jitter and drift are only shown while streaming — they measure a
        stream in flight, and last stream's numbers would be a lie told confidently.
      */}
      {streaming && (
        <dl className="signal-metrics">
          <div>
            <dt>Lead</dt>
            <dd>
              {sync.leadMs} <span className="signal-metric-unit">ms</span>
              {/* The band, not the target: the sender settles at the top of it by design, so
                  "of 250" alone reads as 100 ms behind on a stream that is exactly right. */}
              <span className="signal-metric-of">
                band {sync.targetLeadMs}–{sync.targetLeadMs + sync.leadMarginMs}
              </span>
            </dd>
          </div>
          {sync.leadMinMs !== null && (
            <div>
              <dt>Floor</dt>
              <dd>
                {sync.leadMinMs} <span className="signal-metric-unit">ms</span>
                {/* The lowest lead of the last couple of seconds. At or above the target means the
                    player never ran short; sinking toward zero is what dropouts look like. */}
                <span className="signal-metric-of">lowest lead</span>
              </dd>
            </div>
          )}
          {sync.driftMs !== null && (
            <div>
              <dt>Drift</dt>
              <dd>
                {sync.driftMs > 0 ? '+' : ''}
                {sync.driftMs} <span className="signal-metric-unit">ms</span>
              </dd>
            </div>
          )}
        </dl>
      )}

      {streaming && (
        <LeadTrace
          samples={leadTraces.get(zone.id) ?? []}
          lo={sync.targetLeadMs}
          hi={sync.targetLeadMs + sync.leadMarginMs}
        />
      )}

    </div>
  );
}

/**
 * The lead, as a trace instead of only a number.
 *
 * The metrics above say where the lead is *now*; this says where it has been — the roll display of
 * an oscilloscope, one pixel column per report, the target band drawn behind it. A healthy stream
 * is a line lying flat inside a faint green band, which is a fact you absorb in half a second and
 * could never get from watching a number change. Scaled to whichever is wider, the band or the
 * data, so an excursion bends the line instead of leaving the chart.
 *
 * Hidden until a few seconds have accumulated: two points make a line, not a trace.
 */
function LeadTrace({ samples, lo, hi }: { samples: number[]; lo: number; hi: number }) {
  if (samples.length < 8) {
    return null;
  }
  const min = Math.min(lo, ...samples);
  const max = Math.max(hi, ...samples);
  const pad = Math.max(6, (max - min) * 0.18);
  const top = max + pad;
  const bottom = min - pad;
  const y = (value: number): number => ((top - value) / (top - bottom)) * 100;
  const step = 100 / (TRACE_LENGTH - 1);
  const points = samples.map((value, index) => `${(index * step).toFixed(2)},${y(value).toFixed(2)}`).join(' ');

  return (
    <div className="signal-trace" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect className="signal-trace-band" x="0" y={y(hi)} width="100" height={Math.max(0, y(lo) - y(hi))} />
        <polyline className="signal-trace-line" points={points} />
      </svg>
    </div>
  );
}

/**
 * The chain, and only the chain.
 *
 * The verdict lives under the track title (`FormatChips`), where the question it answers — "am I
 * hearing the good version" — actually gets asked. What is left here is the part a rail is good at: the
 * stages in the order the audio passes through them, ending in the measured throughput.
 *
 * The transformation stays legible without the verdict: `Source` and `On the wire` state their formats
 * in the same notation, so identical lines mean nothing happened to the audio.
 */
export function SignalPath({ zone }: { zone: ApiZoneState }) {
  const stages = stagesOf(zone);

  return (
    <div className="signal-path">
      {/* No heading of its own: the rail's own `Signal path` head names this card. */}
      <Verdict zone={zone} />

      {/* `data-live` while audio flows: the spine carries a slow pulse of light from Source to the
          wire (see `.signal-stages[data-live]` in styles.css), so the chain does not just describe
          the signal — it visibly has one. Stopped means still, which is itself a reading. */}
      <ol className="signal-stages" data-live={zone.state === 'playing' || undefined}>
        {stages.map((stage) => (
          <li key={stage.label} className="signal-stage" data-state={stage.state}>
            <span className="signal-dot" aria-hidden="true" />
            <span className="signal-text">
              <span className="signal-label">{stage.label}</span>
              {/* Keyed on the reading, so a stage that *re-locks* — a new rate, a depth change, an
                  EQ engaging — re-mounts and lands in the accent before settling to white. The
                  chain reacts at exactly the moment the equipment does. The detail line is not
                  keyed: it carries the measured bitrate, which moves every second and would turn
                  a moment into a flicker. */}
              <span className="signal-value" key={stage.value}>{stage.value}</span>
              {stage.detail && <span className="signal-detail">{stage.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      <Timing zone={zone} />
    </div>
  );
}
