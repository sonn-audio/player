/**
 * The two instruments that are pictures rather than numbers.
 *
 * Both draw one analysis window (~43 ms) that the server measured and sent as bytes — see the
 * `scope` and `gonio` events in `useAnalysis`. Canvas rather than SVG, which is the opposite of the
 * choice the spectrum made and right for the same reason: a spectrum is 48 shapes that persist and
 * animate between frames, while these are 160 and 128 points redrawn whole thirty times a second.
 * That is what a canvas is for, and what would make the DOM do a great deal of work for nothing.
 *
 * Neither has an axis or a grid worth labelling: a scope is read for its shape and a goniometer for
 * where its cloud sits. What they do have is a reference — the centre line, the two diagonals — and
 * those are drawn once per frame in the faintest ink on the deck.
 */
import { useEffect, useRef } from 'react';
import { spectrumGeometry, toDb, useAnalysis } from '@/state/useAnalysis';

/** Match the backing store to the box and the display's density; returns the CSS-pixel size. */
function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return null;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

/** The ink, taken from CSS so the accent is defined in one place for the whole deck. */
function ink(canvas: HTMLCanvasElement): string {
  return getComputedStyle(canvas).color || '#4ade80';
}

/**
 * Phosphor: the trace fades instead of being wiped.
 *
 * A cathode-ray tube does not clear itself between sweeps — the screen keeps glowing and the older
 * passes dim away underneath the new one. That is not nostalgia, it is what makes these two
 * instruments *readable*: a scope trace redrawn from scratch thirty times a second is a shape that
 * flickers, and a goniometer that keeps only the current frame is 128 unrelated dots. With a little
 * persistence the scope shows the waveform's envelope as well as its shape, and the dots become the
 * cloud whose *form* is the reading.
 *
 * Painting the page's own colour at low alpha rather than clearing is the whole mechanism. The
 * reference lines live on a second canvas underneath, because grid drawn into a fading layer never
 * fades — it converges on its own brightness and slowly turns into a lit cage.
 */
/*
 * Two persistences, because the two instruments want opposite things from it.
 *
 * The goniometer's reading *is* the density — a long glow turns 128 dots a frame into the cloud
 * whose shape you actually read. The scope's reading is one line, and a long glow buries it under
 * the last twenty: enough to leave an envelope behind the trace, not enough to hide it.
 */
const PHOSPHOR_SLOW = 0.22;
const PHOSPHOR_FAST = 0.55;

function fade(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  alpha: number,
): void {
  /* The screen's own ground, a shade above the page — see `--cx-screen`. The fade has to paint the
     colour the tube actually is, or the trace decays toward a black the panel is not. */
  const ground = getComputedStyle(canvas).getPropertyValue('--cx-screen').trim() || '#0f1115';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

/**
 * The scope: the waveform as it is, at the moment it is.
 *
 * Each point is the most extreme sample of its slice rather than every Nth sample, which is what
 * keeps a tone whose period is shorter than a slice from drawing as whatever the two rates beat at.
 * The trace is centred on a hairline because a waveform without its zero is a squiggle.
 */
export function Scope({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const points = analysis.scope;

  /* The zero line, on its own layer — see `fade`. */
  useEffect(() => {
    const element = grid.current;
    if (!element) {
      return undefined;
    }
    const draw = (): void => {
      const surface = fit(element);
      if (!surface) {
        return;
      }
      const { ctx, w, h } = surface;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(h / 2) + 0.5);
      ctx.lineTo(w, Math.round(h / 2) + 0.5);
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const surface = fit(element);
    if (!surface) {
      return;
    }
    const { ctx, w, h } = surface;
    fade(ctx, element, w, h, PHOSPHOR_FAST);

    const middle = h / 2;
    if (!points || points.length === 0) {
      return;
    }
    ctx.strokeStyle = ink(element);
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = (i / (points.length - 1)) * w;
      // A hair under half the height, so a full-scale sample stays inside its own window.
      const y = middle - (points[i]! / 127) * (middle - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [points]);

  return (
    <>
      <canvas className="cx-sig-canvas" data-layer="grid" ref={grid} aria-hidden="true" />
      <canvas className="cx-sig-canvas" ref={canvas} aria-hidden="true" />
    </>
  );
}

/**
 * The goniometer: the two channels drawn against each other, turned 45°.
 *
 * Turned, because the untilted version answers the wrong question first. Plotting L against R puts
 * mono on the rising diagonal, and what an engineer looks for is *vertical* — the axis becomes the
 * mono content and the horizontal spread becomes the width. A tall thin figure is a mono-safe mix,
 * a round one is wide, and a figure leaning left or right is a balance problem you can see before
 * you can hear it.
 */
export function Goniometer({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const points = analysis.gonio;

  /* The reference: the mono axis upright, the two channels on the diagonals. Its own layer, so the
     persistence below fades the cloud and not the cage it sits in. */
  useEffect(() => {
    const element = grid.current;
    if (!element) {
      return undefined;
    }
    const draw = (): void => {
      const surface = fit(element);
      if (!surface) {
        return;
      }
      const { ctx, w, h } = surface;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) / 2 - 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.7, cy - radius * 0.7);
      ctx.lineTo(cx + radius * 0.7, cy + radius * 0.7);
      ctx.moveTo(cx + radius * 0.7, cy - radius * 0.7);
      ctx.lineTo(cx - radius * 0.7, cy + radius * 0.7);
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const surface = fit(element);
    if (!surface) {
      return;
    }
    const { ctx, w, h } = surface;
    fade(ctx, element, w, h, PHOSPHOR_SLOW);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 2;

    if (!points || points.length < 2) {
      return;
    }
    ctx.fillStyle = ink(element);
    /* √2 keeps a hard-panned full-scale sample on the rim rather than a corner outside it. */
    const scale = radius / (127 * Math.SQRT2);
    for (let i = 0; i + 1 < points.length; i += 2) {
      const l = points[i]!;
      const r = points[i + 1]!;
      const x = cx + (l - r) * scale;
      const y = cy - (l + r) * scale;
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }, [points]);

  return (
    <>
      <canvas className="cx-sig-canvas" data-layer="grid" ref={grid} aria-hidden="true" />
      <canvas className="cx-sig-canvas" ref={canvas} aria-hidden="true" />
    </>
  );
}

/**
 * The level, as two columns of light against a scale.
 *
 * This replaces four numbers stacked in a column, and the reason is not decoration. A level is a
 * *quantity*, and the thing a person actually asks of it — how close is this to the ceiling, are the
 * two sides even, did that transient nearly clip — is a question about position on a scale. Four
 * right-aligned numerals answer it by making you do arithmetic; two bars beside a printed scale
 * answer it before you have finished looking. Every meter ever built into a piece of equipment is
 * this shape for that reason.
 *
 * The colour is *positional*, not proportional: the gradient lives on the full height of the track
 * and the fill clips it, so the top of a loud bar is amber because it is near zero — not because it
 * is the top of the bar. A bar that turns amber whenever it is tall is a decoration that looks like a
 * warning.
 */
/*
 * A full ladder, every twelve dB.
 *
 * The scale is linear in dB, so a ladder of 0/−6/−12/−18/−24/−36/−48/−60 only *looks* even if the
 * labels are spaced by count rather than by value — which is a ruler whose marks are in the wrong
 * places. Twelves give the same regular ladder and every rung is where it says it is.
 */
const METER_TICKS = [0, -12, -24, -36, -48, -60];

export function Meter({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const floor = spectrumGeometry().floorDb;

  /** A wire value to its height on the scale, 0-100. */
  const height = (value: number): number => {
    const db = toDb(value);
    return Math.max(0, Math.min(100, ((db - floor) / -floor) * 100));
  };
  const place = (db: number): string => `${((db - floor) / -floor) * 100}%`;

  const mono = analysis.left === null || analysis.right === null;
  const left = mono ? analysis.loudness : (analysis.left ?? 0);
  const right = mono ? analysis.loudness : (analysis.right ?? 0);
  const heldLeft = mono ? Math.max(analysis.leftPeak, analysis.rightPeak) : analysis.leftPeak;
  const heldRight = mono ? heldLeft : analysis.rightPeak;

  const sides: Array<{ key: string; level: number; held: number }> = [
    { key: 'L', level: left, held: heldLeft },
    { key: 'R', level: right, held: heldRight },
  ];

  /** A side's own reading, under its own column — which side is loud is half of what a pair says. */
  const read = (value: number): string => {
    const db = toDb(value);
    return !active || db <= floor + 0.4 ? '—' : `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`;
  };

  /*
   * The held peak carries the warning, not the bar.
   *
   * The bar is mass — how much signal there is — and mass that changes colour as it grows is a
   * decoration pretending to be a reading. What is worth colouring is the *mark*: the loudest thing
   * that happened, and whether it went too close to the ceiling.
   */
  const tone = (held: number): 'hot' | 'warm' | undefined => {
    const db = toDb(held);
    if (db > -1) return 'hot';
    if (db > -6) return 'warm';
    return undefined;
  };

  return (
    <div className="cx-meter" data-quiet={!active || undefined}>
      <div className="cx-meter-scale mono" aria-hidden="true">
        {METER_TICKS.map((db) => (
          <span key={db} style={{ bottom: place(db) }}>
            {db === 0 ? '0' : db}
          </span>
        ))}
      </div>
      <div className="cx-meter-bars">
        {sides.map((side) => (
          <span key={side.key} className="cx-meter-column">
            {/* The side letter is drawn only where the bars lie down (the phone); standing up, the two
                numbers under the columns name them. */}
            <i className="cx-meter-side mono" aria-hidden="true">
              {side.key}
            </i>
            <span
              className="cx-meter-bar"
              style={
                {
                  '--lvl': `${height(side.level)}%`,
                  '--held': `${height(side.held)}%`,
                } as React.CSSProperties
              }
              data-held={side.held > 0 || undefined}
            >
              {/* The level and the held peak are two custom properties on the bar; whether they run
                  up or along is the stylesheet's decision, which is what lets the same meter lie down
                  on a phone. */}
              <i className="cx-meter-fill" />
              {side.held > 0 && <b className="cx-meter-held" data-tone={tone(side.held)} />}
            </span>
            <em className="cx-meter-read">{read(side.level)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Loudness over the last minute and a half, as the traces a mastering meter draws.
 *
 * The four figures beside this say what the loudness *is*; the picture says what it has been doing,
 * which is the part that tells you whether a record breathes or has been flattened. Momentary is the
 * restless one and short-term the line you read; the integrated figure is drawn as a rule across the
 * whole width, because it is the level everything else is being compared against.
 *
 * Sampled once a second rather than every frame. The stream publishes at the paint rate and ninety
 * seconds of that is 2700 points across 400 pixels — nine samples a pixel, which is nine times the
 * work for a line that cannot show it. A second is also the resolution the reading actually has:
 * short-term is a three-second window, so anything finer is drawing the same number repeatedly.
 */
const LOUDNESS_SECONDS = 90;
/*
 * The window the traces live in.
 *
 * −40 put every reading in the top fifth of the panel and left two thirds of it as empty grid: music
 * that has been mastered for streaming sits between −16 and −6, and broadcast aims at −23. A −30
 * floor keeps both of those references on the chart and puts the line where a line should be, which
 * is through the middle of its own box.
 */
const LOUDNESS_TOP = -3;
const LOUDNESS_BOTTOM = -30;

export function LoudnessGraph({ zoneId, active, rate }: { zoneId: number; active: boolean; rate: number }) {
  const analysis = useAnalysis(zoneId, active, rate);
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<{ momentary: number[]; shortTerm: number[]; at: number }>({
    momentary: [],
    shortTerm: [],
    at: 0,
  });

  const momentary = analysis.loudnessMomentary;
  const shortTerm = analysis.loudnessShort;
  const integrated = analysis.loudnessIntegrated;

  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const now = performance.now();
    const log = history.current;
    if (active && now - log.at >= 1000) {
      log.at = now;
      log.momentary.push(momentary ?? Number.NaN);
      log.shortTerm.push(shortTerm ?? Number.NaN);
      if (log.momentary.length > LOUDNESS_SECONDS) log.momentary.shift();
      if (log.shortTerm.length > LOUDNESS_SECONDS) log.shortTerm.shift();
    }

    const surface = fit(element);
    if (!surface) {
      return;
    }
    const { ctx, w, h } = surface;
    ctx.clearRect(0, 0, w, h);
    const y = (lufs: number): number =>
      h - ((lufs - LOUDNESS_BOTTOM) / (LOUDNESS_TOP - LOUDNESS_BOTTOM)) * h;

    /* The scale: −9 and −23 are where broadcast lives, so they are the two rules worth printing. */
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const rule of [-9, -23, -36]) {
      const at = Math.round(y(rule)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, at);
      ctx.lineTo(w, at);
      ctx.stroke();
      ctx.fillText(String(rule), 2, at - 3);
    }

    /*
     * One trace, drawn run by run.
     *
     * A gap in the history is a gap in the line — silence had no loudness, and joining across it
     * would draw a slope the room never made. That makes each trace a set of *runs*, and each run
     * has to be filled on its own: closing one path around several of them draws the area between
     * them too, which is how a three-second warm-up gap turned into a wedge across the panel.
     *
     * The fill is what stops a line across the top of a tall box reading as a chart that failed to
     * load — a loud master sits at −8 in a window that has to reach −30 to keep the broadcast
     * reference on it. It adds no reading; it turns the line into a shape, which is what the eye is
     * comparing when it looks at loudness over time.
     */
    const trace = (values: number[], colour: string, width: number, fill?: string): void => {
      const runs: Array<Array<{ x: number; y: number }>> = [];
      let run: Array<{ x: number; y: number }> = [];
      values.forEach((value, index) => {
        if (!Number.isFinite(value)) {
          if (run.length > 1) runs.push(run);
          run = [];
          return;
        }
        run.push({
          x: (index / (LOUDNESS_SECONDS - 1)) * w,
          y: y(Math.max(LOUDNESS_BOTTOM, Math.min(LOUDNESS_TOP, value))),
        });
      });
      if (run.length > 1) runs.push(run);

      for (const points of runs) {
        if (fill) {
          ctx.beginPath();
          ctx.moveTo(points[0]!.x, h);
          for (const point of points) ctx.lineTo(point.x, point.y);
          ctx.lineTo(points[points.length - 1]!.x, h);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        }
        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    };

    const accent = ink(element);
    trace(log.shortTerm, accent, 1.5, 'rgba(74,222,128,0.07)');
    /* The restless one over the shape, not under it: it is the reading that moves, and a line the
       area could swallow is a line nobody can follow. */
    trace(log.momentary, 'rgba(74,222,128,0.38)', 1);

    if (integrated !== null && Number.isFinite(integrated)) {
      const at = Math.round(y(integrated)) + 0.5;
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(247,248,250,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, at);
      ctx.lineTo(w, at);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(247,248,250,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(`I ${integrated.toFixed(1)}`, w - 2, at - 4);
      ctx.textAlign = 'left';
    }
  }, [momentary, shortTerm, integrated, active]);

  return <canvas className="cx-sig-canvas" ref={canvas} aria-hidden="true" />;
}
