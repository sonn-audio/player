/**
 * What the audio is doing — in this window, for the record that is playing.
 *
 * Not a second player. The technical side of this product used to be a *face*: its own shell, its own
 * nav rail, its own browse, its own queue, reached by a switch in the corner that meant "leave this
 * app for the other one". Two shells solving the same problems twice is what that cost, and the thing
 * it was protecting — four instruments read side by side — never needed a shell at all. It needed a
 * room with something playing in it, which is exactly what the screen behind this one already is.
 *
 * So this is a *view*, the fourth one this window has (`home`, `browse`, `inputs`, `signal`), and the
 * door to it stands in the row beside `canvas` and `house` because those are the other two ways of
 * looking at the same room. What separates it from them: they are withdrawals — the chrome dims, the
 * clock comes up, the screen becomes a picture — and this is the opposite. Nothing dims. The band
 * across the top keeps the record's identity and its transport, so reading never costs you the
 * controls, and the accent comes back to the console's green because this is the surface that has
 * verdicts to give (see `.cx-root` in art.css for why the stage's is silver).
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

import { SignalClock, SignalWire, Verdict, stagesOf } from '@/components/SignalPath';
import { Transport, Timeline, VolumeRow } from '@/art/Stage';
import { zoneCoverCss } from '@/art/cover';
import { BackGlyph } from '@/art/glyphs';
import { useApi, useServer } from '@/state/ServerContext';
import { useCoverAnchor } from '@/shell/coverMorph';
import type { Cur } from '@/art/useCur';
import type { ApiHealthReport, ApiOutputCapabilities, ApiStreamFormat, ApiZoneState } from '@/api/types';
import { PEAK_HOLD_MS, spectrumGeometry, toDb, useAnalysis } from '@/state/useAnalysis';

/**
 * What the audio was before the chain, and what it is after it.
 *
 * The two ends of the rail, stated in the same notation on purpose: identical caps mean nothing
 * happened to the audio, and that is a thing you should be able to see without reading a word. It is
 * also the honest version of the proof a hash would give — we do not hash the stream, so the claim
 * this face makes is "no stage altered it", and the caps are what that claim looks like.
 */
function Cap({
  label,
  format,
  side,
}: {
  label: string;
  format: ApiStreamFormat | null | undefined;
  side: 'in' | 'out';
}) {
  return (
    <div className="cx-sig-cap" data-side={side}>
      <span className="cx-sig-cap-label mono">{label}</span>
      {format ? (
        <span className="cx-sig-cap-format">
          {format.codec.toUpperCase()}
          {/* The depth only when the format has one to report: a lossy source has no bit depth, and
              printing `float` there describes our decoder rather than the file. */}
          <i>
            {format.sampleRate / 1000} kHz
            {format.bitDepth ? ` · ${format.bitDepth}-bit` : ''}
          </i>
          <i>{format.channels} ch</i>
        </span>
      ) : (
        <span className="cx-sig-cap-format" data-quiet>
          —
        </span>
      )}
    </div>
  );
}

/**
 * The chain, as a rail between the two caps.
 *
 * Its own markup rather than the technical face's strip. That strip was written for a 90px band under
 * a display and carries the compromises of it — the details hidden, the stations squeezed, a
 * media query that drops them below 900px of window. Here the chain is the top third of the panel
 * and the subject of the whole face, so it gets a rail built for that: a hairline the stations stand
 * on, a lit dot where something is happening, and the light travelling from source to wire while
 * audio flows.
 */
function Chain({ zone }: { zone: ApiZoneState }) {
  const stages = stagesOf(zone);
  return (
    <ol className="cx-sig-rail" data-live={zone.state === 'playing' || undefined}>
      {stages.map((stage) => (
        <li key={stage.label} className="cx-sig-station" data-state={stage.state}>
          <span className="cx-sig-dot" aria-hidden="true" />
          <span className="cx-sig-station-name mono">{stage.label}</span>
          {/* Keyed on the reading, so a stage that re-locks — a new rate, an EQ engaging — lands in
              the accent before settling. The chain reacts when the equipment does. */}
          <span className="cx-sig-station-value" key={stage.value}>
            {stage.value}
          </span>
        </li>
      ))}
    </ol>
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
  span: 3 | 6 | 12;
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
 * The server's own vitals, for the foot of the deck.
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
}: {
  cur: Cur;
  /** The room the window has selected — whose output, format and clock these are. */
  zone: ApiZoneState;
  /** The whole house — only the foot counts it now, but the deck is a room's view of a house. */
  zones: ApiZoneState[];
  onLeave: () => void;
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
       * The band: who this is, how far in, and every control you would otherwise leave to reach.
       *
       * The sleeve is here at 52px and it is the same object as the one on the stage — it flies between
       * the two (`useCoverAnchor`), which is what makes this read as one window rearranging itself
       * rather than a page swap. That flight was written to carry artwork between the two *faces*; it
       * does the same job better between two views of one.
       */}
      <header className="cx-sig-band">
        <span
          className="cx-sig-cover"
          style={{ backgroundImage: zoneCoverCss(api, leader, 160) }}
          {...coverAnchor}
        />

        <span className="cx-sig-id">
          <span className="cx-sig-eyebrow mono">
            {cur.name}
            {cur.source && ` · ${cur.source}`}
          </span>
          <span className="cx-sig-title">{cur.title}</span>
          <span className="cx-sig-sub">
            {[cur.artist, cur.album].filter(Boolean).join(' · ')}
          </span>
        </span>

        {/* Only where there is something to seek within — `cur.showBar` is the source's own word, so a
            station gets the transport and no timeline rather than a bar that cannot be dragged. */}
        {cur.showBar && (
          <span className="cx-sig-bar">
            <Timeline cur={cur} />
          </span>
        )}

        <Transport cur={cur} size="bar" />

        <VolumeRow cur={cur} className="cx-sig-vol" />

        {/*
         * The way back, where the way in was.
         *
         * A view has to say how to leave it in the view itself: `Escape` works and nobody discovers
         * `Escape`. It reads `player` rather than `back` because that is where it goes — the same
         * naming the row of doors downstairs uses.
         */}
        <button type="button" className="cx-sig-back mono" onClick={onLeave}>
          <BackGlyph size={13} />
          player
        </button>
      </header>

      {/*
       * The deck.
       *
       * Twelve columns, and for now the instruments that already exist hung in it: the chain across the
       * top, then the level, the spectrum and the timing side by side. The tiles the prototype's deck
       * adds beyond these — the group's sync table, the session counters, the stereo field — go in the
       * same grid as they earn their data; the frame is what is being judged first.
       */}
      <div className="cx-sig-deck">
        {/*
         * The hero: the verdict, then the audio's two ends with the chain between them.
         *
         * The verdict is set at the size of a headline because it is one — it is the answer to the
         * question that brought anybody to this face, and everything to the right of it is the
         * working. No tile label above it: a heading that says `SIGNAL PATH` over a heading that says
         * `Bit-perfect` is a label naming a label.
         */}
        <article className="cx-sig-tile cx-sig-hero" data-span={12}>
          <div className="cx-sig-verdict">
            <Verdict zone={zone} />
          </div>
          <Cap label="Decoded in" format={zone.format?.source} side="in" />
          <Chain zone={zone} />
          <Cap label="Handed off" format={zone.format?.output} side="out" />
        </article>

        {/*
         * The meter, narrow, against the display it belongs to.
         *
         * Two columns rather than three: a level wants height, not width, and the seven columns the
         * spectrum gets in exchange are the ones that make a mix legible.
         */}
        <Tile span={3} label="Level" aside={`peak hold ${(PEAK_HOLD_MS / 1000).toFixed(1)} s`}>
          <Meter zoneId={zone.id} active={streaming} rate={rate} />
          <LevelRead zoneId={zone.id} active={streaming} capabilities={zone.output?.capabilities} />
        </Tile>

        {/* No label: `analysis-heading` is this instrument's own, and naming it twice is how a deck
            starts looking like a form. */}
        <Tile span={6}>
          <AnalysisPanel
            zoneId={zone.id}
            active={streaming}
            capabilities={zone.output?.capabilities}
          />
        </Tile>

        {/* Two readings, one column: the clock draws its own head, the wire is a bare list and takes
            one from the tile. Both are about the hand-off rather than about the music. */}
        <Tile span={3}>
          <SignalClock zone={zone} />
          <span className="cx-sig-tile-label mono">On the wire</span>
          <SignalWire zone={zone} />
        </Tile>

        {/*
         * The measured row.
         *
         * Everything above is either a fact the server states or a level the stream already carried.
         * These four are *measurements* — a K-weighted loudness meter, a 4× peak reconstruction, a
         * correlation over the window and a waveform — and they are the reason the deck is worth
         * having a room open for.
         */}
        <Tile span={6} label="Loudness" aside="EBU R128 · last 90 s">
          <Loudness zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

        <Tile span={3} label="Stereo field" aside="goniometer">
          <Stereo zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

        <Tile span={3} label="Scope" aside="43 ms window">
          <ScopeTile zoneId={zone.id} active={streaming} rate={rate} />
        </Tile>

      </div>

      {/*
       * The foot: the machine, not the music.
       *
       * The mockup put CPU, memory and a temperature here and none of the three exists on the wire —
       * a foot that invents its numbers undermines every honest reading above it. What the server does
       * report is what it is and how long it has been up, plus whether we are still hearing from it,
       * which is the one thing on this whole screen that decides if the rest of it is current.
       */}
      <footer className="cx-sig-foot mono">
        <span>
          sonn <b>{health?.version ?? '—'}</b>
        </span>
        <span>
          up <b>{health ? uptime(health.uptimeSec) : '—'}</b>
        </span>
        <span>
          <b>{zones.length}</b> room{zones.length === 1 ? '' : 's'}
        </span>
        {health && health.status !== 'ok' && (
          <span data-tone="warn">
            server <b>{health.status}</b>
          </span>
        )}
        <span className="cx-sig-foot-end" data-tone={status === 'open' ? undefined : 'warn'}>
          {status === 'open' ? 'stream connected' : 'reconnecting'}
        </span>
      </footer>
    </section>
  );
}
