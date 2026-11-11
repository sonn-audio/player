/**
 * What the audio is doing — in this window, for the record that is playing.
 *
 * Not a second player. The technical side of this product used to be a *face*: its own shell, its own
 * nav rail, its own browse, its own queue, reached by a switch in the corner that meant "leave this
 * app for the other one". Two shells solving the same problems twice is what that cost, and the thing
 * it was protecting — four instruments read side by side — never needed a shell at all. It needed a
 * room with something playing in it, which is exactly what the screen behind this one already is.
 *
 * So this is a *view*, one of the places this window has, and the door to it is the lamp that says
 * what is on the line.
 *
 * The page opens on the answer: the verdict and why, two meters, the spectrum, four figures, and the
 * path the audio took, read downwards. The instruments that are looked into rather than glanced at —
 * the loudness history, the stereo picture, the scope — stand under the fold. Green is spent on one
 * thing here, as everywhere: a signal that arrived untouched.
 *
 * **Two rooms are read here and they are not the same room.** The band takes its identity from `cur`,
 * which resolves to the group's *leader* — a follower mirrors it and its own track fields are stale.
 * The instruments take the *selected* zone, because a format, an output device and a clock lock are
 * that room's own facts even inside a group: two members of one group can be handed the same stream
 * and disagree about what happened to it on the way out.
 */
import { useEffect, useState } from 'react';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { Goniometer, LoudnessGraph, Meter, Scope } from '@/art/Instruments';
import { VuPair } from '@/art/Vu';

import { SignalClock, SignalWire, Verdict, figures, stagesOf, type Stage } from '@/components/SignalPath';
import { Transport, Timeline } from '@/art/Stage';
import { zoneCoverCss } from '@/art/cover';
import { BackGlyph } from '@/art/glyphs';
import { useApi, useServer } from '@/state/ServerContext';
import { useCoverAnchor } from '@/shell/coverMorph';
import type { Cur } from '@/art/useCur';
import type { ApiHealthReport, ApiOutputCapabilities, ApiStreamFormat, ApiZoneState } from '@/api/types';
import { PEAK_HOLD_MS, spectrumGeometry, toDb, useAnalysis } from '@/state/useAnalysis';

/** A format in one line of figures: `FLAC · 44.1 kHz · 16-bit · 2 ch`. */
function caps(format: ApiStreamFormat | null | undefined): string {
  if (!format) {
    return '—';
  }
  /* The depth only when the format has one to report: a lossy source has no bit depth, and printing
     `float` there describes our decoder rather than the file. */
  return [
    format.codec.toUpperCase(),
    `${format.sampleRate / 1000} kHz`,
    format.bitDepth ? `${format.bitDepth}-bit` : null,
    `${format.channels} ch`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The path, read downwards: what was decoded, every stage it passed, what was handed off.
 *
 * The two ends are stated in the same notation on purpose: identical figures mean nothing happened to
 * the audio, and that is a thing you should be able to see without reading a word. It is also the
 * honest version of the proof a hash would give — we do not hash the stream, so the claim this face
 * makes is "no stage altered it", and the two ends are what that claim looks like. A stage that is
 * doing something is a lit point; one that is present and passive is a ring.
 */
function Path({ zone }: { zone: ApiZoneState }) {
  const end = (label: string, format: ApiStreamFormat | null | undefined): Stage => ({
    label,
    value: caps(format),
    state: format ? 'on' : 'off',
  });
  const steps = [end('Decoded in', zone.format?.source), ...stagesOf(zone), end('Handed off', zone.format?.output)];
  return (
    <ol
      className="cx-sig-chain"
      data-live={zone.state === 'playing' || undefined}
      data-ok={zone.format?.bitPerfect || undefined}
    >
      {steps.map((step) => (
        <li key={step.label} data-state={step.state}>
          <span className="cx-sig-dot" aria-hidden="true" />
          <span className="cx-sig-step">
            <span className="cx-sig-step-name mono">{step.label}</span>
            {/* Keyed on the reading, so a stage that re-locks — a new rate, an EQ engaging — arrives
                rather than swaps. The chain reacts when the equipment does. */}
            <span className="cx-sig-step-value" key={step.value}>
              {figures(step.value)}
            </span>
            {step.detail && <span className="cx-sig-step-detail mono">{figures(step.detail)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The four figures a record is summed up in, set large under the instruments that draw them.
 *
 * Integrated loudness and its range say how the record was mastered, the true peak says whether it
 * clips on the way out of a converter, and the correlation says whether the two channels are one
 * picture. Everything else on the page is the working.
 */
function Figures({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const truePeak = Math.max(analysis.truePeakLeft ?? -Infinity, analysis.truePeakRight ?? -Infinity);
  const correlation = analysis.correlation;
  return (
    <div className="cx-sig-figs">
      <Figure label="Integrated" value={reading(analysis.loudnessIntegrated)} unit="LUFS" />
      <Figure label="Range" value={reading(analysis.loudnessRange)} unit="LU" />
      <Figure label="True peak" value={signed(truePeak)} unit="dBTP" bad={truePeak > 0} />
      <Figure
        label="Correlation"
        value={correlation === null ? '—' : `${correlation >= 0 ? '+' : '−'}${Math.abs(correlation).toFixed(2)}`}
        bad={correlation !== null && correlation < -0.1}
      />
    </div>
  );
}

function Figure({ label, value, unit, bad }: { label: string; value: string; unit?: string; bad?: boolean }) {
  return (
    <div className="cx-sig-fig" data-tone={bad ? 'bad' : undefined}>
      <span className="mono">{label}</span>
      <b>{value}</b>
      {unit && <i className="mono">{unit}</i>}
    </div>
  );
}

/**
 * One instrument, with its name over it.
 *
 * The label is the tile's whole frame: no border, no card, no shadow. Three of the five things hung in
 * this deck already draw their own head (the chain names its verdict, the clock says `Clock`), so a
 * box around each one would be a second frame around a thing that is already framed — and a deck of
 * boxes is the shape this design spent its life getting away from.
 */
function Tile({
  label,
  aside,
  span,
  children,
}: {
  label?: string | undefined;
  /** A word about how the instrument behaves, at the other end of its own name. */
  aside?: string | undefined;
  /** Columns of twelve — the deck's only widths. */
  span: 3 | 6;
  children: React.ReactNode;
}) {
  return (
    <article className="cx-sig-tile" data-span={span}>
      {label && (
        <span className="cx-sig-tile-label mono">
          {label}
          {aside && <i>{aside}</i>}
        </span>
      )}
      {children}
    </article>
  );
}

/** One fact, named. The rack's own row: what it is on the left, what it reads on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cx-sig-row">
      <span>{label}</span>
      <em>{children}</em>
    </div>
  );
}

/** A measurement and its unit, so the number and the word it is in are never one string. */
function Num({ value, unit }: { value: number | string; unit?: string }) {
  return (
    <>
      {value}
      {unit && <i className="cx-sig-unit">{unit}</i>}
    </>
  );
}

/** `6d 04:12` — an uptime reads as a duration, not as a number of seconds. */
function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * The server's own vitals, for the last tile on the bench.
 *
 * `/health` is a poll rather than an event — it is the one thing here the stream does not carry — so
 * it is read once on arrival and then rarely: a version does not change while you are looking at it
 * and an uptime is a number you read, not one you watch tick. Failure is silent by design; a foot
 * that cannot say the version says nothing rather than an error nobody asked for.
 */
function useHealth(): ApiHealthReport | null {
  const api = useApi();
  const [health, setHealth] = useState<ApiHealthReport | null>(null);

  useEffect(() => {
    let live = true;
    const read = (): void => {
      void api
        .getHealth()
        .then((report) => live && setHealth(report))
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api]);

  return health;
}

/**
 * The one number a tile is *about*, set large.
 *
 * A deck of thirty readings all at 11.5px is a spreadsheet: everything is available and nothing is
 * legible from where you sit. Every instrument here has a headline — the level, the integrated
 * loudness, the correlation, how long the room has been playing — and giving it the size it deserves
 * is what turns a table into a panel you can read at a glance and then look into.
 */
function Headline({ value, unit, tone }: { value: string; unit?: string; tone?: 'ok' | 'bad' }) {
  return (
    <span className="cx-sig-headline" data-tone={tone}>
      {value}
      {unit && <i>{unit}</i>}
    </span>
  );
}

/**
 * One reading with its name over it — the unit a row of figures under a graph is made of.
 *
 * Label above rather than beside, because six of these across a panel have to line up on both their
 * names and their values; a label to the left would set every column to a different width and the
 * row would read as six unrelated facts instead of one instrument's answer.
 */
function Stat({
  label,
  value,
  unit,
  lead,
  wide,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  /** The one figure in the row the others qualify. */
  lead?: boolean;
  /** Two columns, for a reading that is two numbers — a pair of peaks does not fit one. */
  wide?: boolean;
  tone?: 'ok' | 'bad';
}) {
  return (
    <div className="cx-sig-stat" data-lead={lead || undefined} data-wide={wide || undefined} data-tone={tone}>
      <span className="mono">{label}</span>
      <em>
        {value}
        {unit && <i>{unit}</i>}
      </em>
    </div>
  );
}

/**
 * What the meter's columns are worth, in numbers.
 *
 * The level in dBFS is the headline — it is the same quantity the bars draw, and a bar without its
 * number cannot be written down. Peak and balance sit under it in the small voice, because they are
 * read *after* the level, never instead of it.
 */
function LevelRead({
  zoneId,
  active,
  capabilities,
}: {
  zoneId: number;
  active: boolean;
  capabilities: ApiOutputCapabilities | null | undefined;
}) {
  const analysis = useAnalysis(zoneId, active, capabilities?.visualizer?.rateMax ?? 30);
  const held = Math.max(analysis.leftPeak, analysis.rightPeak);
  const floor = spectrumGeometry().floorDb;
  const truePeak = Math.max(analysis.truePeakLeft ?? -Infinity, analysis.truePeakRight ?? -Infinity);

  /** A wire value as dBFS, or a dash at the floor — where a number would be pretending. */
  const db = (value: number): string => {
    const decibels = toDb(value);
    return !active || decibels <= floor + 0.4 ? '—' : `${decibels < 0 ? '−' : ''}${Math.abs(decibels).toFixed(1)}`;
  };

  /*
   * The three peak readings, here rather than beside the loudness.
   *
   * They were in the R128 tile and they do not belong there: that instrument measures *loudness*,
   * which is an average over seconds, while these three are about the single loudest instant. They
   * are what the columns above are already drawing, stated exactly — including the peak between the
   * samples, which no meter drawn from samples can show.
   */
  return (
    <div className="cx-sig-foot-rows">
      <div className="cx-sig-rows">
        <Row label="True peak">
          <span data-tone={truePeak > 0 ? 'bad' : undefined}>
            <Num value={Number.isFinite(truePeak) ? signed(truePeak) : '—'} unit="dBTP" />
          </span>
        </Row>
        <Row label="Sample peak">
          <Num value={db(held)} unit="dBFS" />
        </Row>
        <Row label="Clips">
          <span data-tone={analysis.clips > 0 ? 'bad' : undefined}>{analysis.clips}</span>
        </Row>
      </div>
    </div>
  );
}

/**
 * The scope, with the two readings that are about the *shape* it is drawing.
 *
 * The note is what the room is playing, found by autocorrelation on the server — a reading with no
 * business on a level meter and every business under a waveform. The crest factor is the distance
 * between the loudest instant and the average one, which is the number that says whether a master
 * has been left room to breathe: 12 dB is a live recording, 6 dB has been through a limiter until
 * it stopped moving.
 */
function ScopeTile({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const peak = Math.max(analysis.truePeakLeft ?? -Infinity, analysis.truePeakRight ?? -Infinity);
  const level = toDb(analysis.loudness);
  const crest = Number.isFinite(peak) && level > spectrumGeometry().floorDb + 1 ? peak - level : null;

  return (
    <>
      <div className="cx-sig-figure" data-wide>
        <Scope zoneId={zoneId} active={active} rate={rate} />
      </div>
      <div className="cx-sig-rows">
        <Row label="Root">{(active && analysis.pitch) || '—'}</Row>
        <Row label="Crest factor">
          {crest === null ? '—' : <Num value={crest.toFixed(1)} unit="dB" />}
        </Row>
        {/* Not a decoration: a waveform sitting off centre is spending headroom on a constant, and on
            the wrong amplifier it is spending it on heat. Zero is what it should read. */}
        <Row label="DC offset">
          {analysis.dcOffset === null ? (
            '—'
          ) : (
            <span data-tone={Math.abs(analysis.dcOffset) > 0.002 ? 'bad' : undefined}>
              <Num value={(analysis.dcOffset * 100).toFixed(2)} unit="%" />
            </span>
          )}
        </Row>
      </div>
    </>
  );
}

/** A measured number, or a dash — never a zero standing in for "not yet". */
function reading(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/** The same, with the sign kept: a peak of `+0.12` and one of `−0.12` are different news. */
function signed(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
}

/**
 * Loudness, as the broadcast world measures it.
 *
 * Four figures with four jobs: momentary is what the music is doing *now*, short-term is the passage,
 * integrated is the record, and the range is the distance between its quiet and loud parts — the
 * number that says whether a master breathes or has been flattened. All four are gated per
 * ITU-R BS.1770-4; the server's meter is verified against the EBU's own compliance signal.
 *
 * The integrated figure restarts at every track, because that is the thing it describes.
 */
function Loudness({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  return (
    <>
      {/*
       * The picture first, the figures under it.
       *
       * Four numbers can say what the loudness is; only the traces say what it has been *doing*, and
       * that is what this meter is read for — a record that lives inside two LU has been flattened,
       * and no single reading can show you that.
       */}
      <div className="cx-sig-figure" data-wide>
        <LoudnessGraph zoneId={zoneId} active={active} rate={rate} />
      </div>
      {/*
       * The peak a sample meter cannot see, among the four that make the picture readable.
       *
       * A converter reconstructs a curve through the samples and that curve can overshoot every one
       * of them, which is why a file that never reaches 0 dBFS can still clip on the way out of a
       * DAC. Signed and to two decimals, because the whole question is which side of zero it is on.
       */}
      <div className="cx-sig-stats">
        <Stat label="Momentary" value={reading(analysis.loudnessMomentary)} unit="LUFS" />
        <Stat label="Short-term" value={reading(analysis.loudnessShort)} unit="LUFS" />
        <Stat label="Integrated" value={reading(analysis.loudnessIntegrated)} unit="LUFS" lead />
        <Stat label="Range" value={reading(analysis.loudnessRange)} unit="LU" />
      </div>
    </>
  );
}

/**
 * The stereo field, as a picture and one number.
 *
 * The coefficient is what the picture means, said in a word: +1 is one signal in two speakers, 0 is
 * two unrelated ones, and anything below zero is the pair fighting — a room that sums them will lose
 * the difference, which is what makes a negative reading worth catching before someone hears it.
 */
function Stereo({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const value = analysis.correlation;

  /*
   * Balance, from the two levels the stream already sends.
   *
   * The figure above says how *related* the channels are; this says which of them is louder, and the
   * two answer different questions about the same pair — a perfectly correlated mix can still be
   * two decibels to the left.
   */
  const balance = (): string => {
    const left = analysis.left;
    const right = analysis.right;
    if (!active || left === null || right === null || (left < 40 && right < 40)) {
      return '—';
    }
    const db = 20 * Math.log10((Math.max(left, 1) + 1) / (Math.max(right, 1) + 1));
    const side = db > 0.2 ? ' L' : db < -0.2 ? ' R' : '';
    return `${Math.abs(db) < 0.05 ? '0.0' : Math.abs(db).toFixed(1)}${side}`;
  };
  const verdict =
    value === null
      ? '—'
      : value > 0.9
        ? 'near mono'
        : value > 0.35
          ? 'wide'
          : value > -0.1
            ? 'very wide'
            : 'out of phase';

  return (
    <>
      <div className="cx-sig-figure">
        <Goniometer zoneId={zoneId} active={active} rate={rate} />
      </div>
      <div className="cx-sig-foot-rows">
        <Headline
          value={value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`}
          unit={verdict}
          {...(value !== null && value < -0.1 ? { tone: 'bad' as const } : {})}
        />
        <div className="cx-sig-rows">
          <Row label="Balance">
            <Num value={balance()} unit="dB" />
          </Row>
        </div>
      </div>
    </>
  );
}

export function Signal({
  cur,
  zone,
  zones,
  onLeave,
  bare = false,
}: {
  cur: Cur;
  /** The room the window has selected — whose output, format and clock these are. */
  zone: ApiZoneState;
  /** The whole house — only the foot counts it now, but the deck is a room's view of a house. */
  zones: ApiZoneState[];
  onLeave: () => void;
  /**
   * The band without its controls: inside the desk's frame the transport, the fader and the way back are
   * the player bar's and the sidebar's, so the band keeps only the record's identity. On a phone, which
   * has neither, the band stays whole.
   */
  bare?: boolean;
}) {
  const api = useApi();
  const { status } = useServer();
  const coverAnchor = useCoverAnchor();
  const health = useHealth();
  const leader = cur.leader;
  const streaming = zone.state === 'playing';
  /* One rate for every instrument on the deck, so they are all reading the same moment. */
  const rate = zone.output?.capabilities?.visualizer?.rateMax ?? 30;

  return (
    <section className="cx-sig">
      {/*
       * In the hand there is no frame around this view, so it carries its own way back and the
       * transport: reading never costs you the controls.
       */}
      {!bare && (
        <header className="cx-sig-band">
          <button type="button" className="cx-sig-back mono" onClick={onLeave}>
            <BackGlyph size={13} />
            player
          </button>
          <div className="cx-sig-now">
            <span className="cx-sig-cover" style={{ backgroundImage: zoneCoverCss(api, leader, 160) }} {...coverAnchor} />
            <span className="cx-sig-id">
              <span className="cx-sig-title">{cur.title}</span>
              <span className="cx-sig-sub">{[cur.artist, cur.album].filter(Boolean).join(' · ')}</span>
            </span>
            <Transport cur={cur} size="bar" />
          </div>
          {cur.showBar && <Timeline cur={cur} />}
        </header>
      )}

      {/*
       * The verdict, at the size of a headline because it is one — the answer to the question that
       * brought anybody here — and beside it, in a sentence, why. Everything under it is the working.
       */}
      <header className="cx-sig-head">
        <span className="cx-sig-lbl mono">
          Signal · {zone.name}
          {cur.source && ` · ${cur.source}`}
        </span>
        {zone.format?.output ? (
          <Verdict zone={zone} />
        ) : (
          <div className="signal-verdict">
            <p className="signal-verdict-head">Idle</p>
            <p className="signal-verdict-note">nothing is on the line in this room</p>
          </div>
        )}
      </header>

      <div className="cx-sig-main">
        <div className="cx-sig-bench">
          {/* The meters, first: the one instrument here that is watched rather than read. */}
          <VuPair zoneId={zone.id} active={streaming} rate={rate} />
          <div className="cx-sig-panel">
            <AnalysisPanel zoneId={zone.id} active={streaming} capabilities={zone.output?.capabilities} />
          </div>
          <Figures zoneId={zone.id} active={streaming} rate={rate} />
        </div>

        <aside className="cx-sig-path">
          <span className="cx-sig-lbl mono">The path</span>
          <Path zone={zone} />
        </aside>
      </div>

      {/*
       * The bench, under the fold: the instruments that are looked into rather than glanced at. A
       * K-weighted loudness history, the stereo picture, the waveform, the peaks, and the hand-off's
       * own timing.
       */}
      <div className="cx-sig-deck">
        <Tile span={6} label="Loudness" aside="EBU R128 · last 90 s">
          <Loudness zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

        <Tile span={3} label="Stereo field" aside="goniometer">
          <Stereo zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

        <Tile span={3} label="Scope" aside="43 ms window">
          <ScopeTile zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

        <Tile span={3} label="Peak" aside={`hold ${(PEAK_HOLD_MS / 1000).toFixed(1)} s`}>
          <Meter zoneId={zone.id} active={streaming} rate={rate} />
          <LevelRead zoneId={zone.id} active={streaming} capabilities={zone.output?.capabilities} />
        </Tile>

        {/* Two readings about the hand-off rather than about the music. */}
        <Tile span={3}>
          <SignalClock zone={zone} />
        </Tile>

        <Tile span={3} label="On the wire">
          <SignalWire zone={zone} />
        </Tile>

        {/*
         * The machine, not the music. What the server reports is what it is and how long it has been
         * up, plus whether we are still hearing from it — the one thing on this page that decides if
         * the rest of it is current. No CPU, no temperature: neither exists on the wire, and a tile
         * that invents its numbers undermines every honest reading above it.
         */}
        <Tile span={3} label="The machine">
          <div className="cx-sig-rows">
            <Row label="Sonn">{health?.version ?? '—'}</Row>
            <Row label="Up">{health ? uptime(health.uptimeSec) : '—'}</Row>
            <Row label="Rooms">{zones.length}</Row>
            {health && health.status !== 'ok' && (
              <Row label="Server">
                <span data-tone="bad">{health.status}</span>
              </Row>
            )}
            <Row label="Stream">
              <span data-tone={status === 'open' ? undefined : 'bad'}>{status === 'open' ? 'connected' : 'reconnecting'}</span>
            </Row>
          </div>
        </Tile>
      </div>

    </section>
  );
}
