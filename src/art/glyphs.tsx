/**
 * The art player's glyphs.
 *
 * A second, smaller set alongside `components/Icon` on purpose. The technical player's icons are
 * filled 24px shapes that read at 14px in a dense rail; these are 1.8px strokes at 18–25px, drawn
 * to sit in a lot of black space beside a 90px title. Sharing one set would mean one of the two
 * looked borrowed — and the transport glyphs in particular are the most-looked-at shapes in either
 * face, so they are worth drawing twice.
 *
 * All of them inherit `currentColor` and take their size from the `size` prop rather than from CSS,
 * because in this face a glyph's size is a composition decision made where it is placed (a 60px play
 * button on a phone, 64px on a desk, 44px in the mini bar) rather than a global.
 */

/*
 * `| undefined` is written out because this project builds with `exactOptionalPropertyTypes`:
 * "may be omitted" and "may be passed as undefined" are different types under that flag, and these
 * props are forwarded straight through to the wrapper, which means both.
 */
type GlyphProps = { size?: number | undefined; className?: string | undefined };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ size = 20, className, children }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PlayGlyph({ size = 22, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </Svg>
  );
}

export function PauseGlyph({ size = 22, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
    </Svg>
  );
}

export function PrevGlyph({ size = 24, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M18 5v14l-11-7z" fill="currentColor" />
      <rect x="5" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" />
    </Svg>
  );
}

export function NextGlyph({ size = 24, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 5v14l11-7z" fill="currentColor" />
      <rect x="16.6" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" />
    </Svg>
  );
}

export function ShuffleGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M16 3h5v5M21 3l-7 7M16 21h5v-5M21 21 3 3M4 21l5-5" />
    </Svg>
  );
}

export function RepeatGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  );
}

export function HeartGlyph({ size = 18, filled = false, className }: GlyphProps & { filled?: boolean }) {
  return (
    <Svg size={size} className={className}>
      <path
        {...stroke}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth={1.9}
        d="M12 21s-7.5-4.6-10-9.5C.5 8 2.5 5 6 5c2 0 3.2 1.1 4 2.3C10.8 6.1 12 5 14 5c3.5 0 5.5 3 4 6.5C19.5 16.4 12 21 12 21z"
      />
    </Svg>
  );
}

export function SpeakerGlyph({ size = 16, waves = false, className }: GlyphProps & { waves?: boolean }) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M11 5 6 9H2v6h4l5 4z" />
      {waves && <path {...stroke} d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />}
    </Svg>
  );
}

export function ChevronGlyph({ size = 16, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function BackGlyph({ size = 16, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

/** The same stroke the other way: "this row goes somewhere". */
export function ForwardGlyph({ size = 16, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function CloseGlyph({ size = 16, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function SearchGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <circle {...stroke} cx="11" cy="11" r="6.5" />
      <path {...stroke} d="M16 16l4.5 4.5" />
    </Svg>
  );
}

export function HomeGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M4 11.5 12 5l8 6.5M6.5 10.5V19h11v-8.5" />
    </Svg>
  );
}

export function GridGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <rect {...stroke} x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect {...stroke} x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect {...stroke} x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect {...stroke} x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </Svg>
  );
}

export function RoomsGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <rect {...stroke} x="4" y="7" width="6" height="12" rx="1.4" />
      <rect {...stroke} x="14" y="7" width="6" height="12" rx="1.4" />
      <path {...stroke} d="M4 7l3-3 3 3M14 7l3-3 3 3" />
    </Svg>
  );
}

export function MoreGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  );
}

export function QueueGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M4 7h11M4 12h11M4 17h7" />
      <circle {...stroke} cx="17.5" cy="16" r="2.5" />
      <path {...stroke} d="M20 16V8" />
    </Svg>
  );
}

/** The empty-artwork mark: a record in its sleeve, drawn rather than a grey box. */
/**
 * Two faders, one up and one down — the handle that opens the rooms dock.
 *
 * Deliberately not a chevron. A chevron says "there is more of this list"; the dock does not hold more
 * rooms when it opens, it holds their *levels*, and drawing what is behind the handle is the whole
 * reason a handle can be 20px and still be understood.
 */
export function FadersGlyph({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path {...stroke} d="M8.5 4v16M15.5 4v16" />
      <circle {...stroke} cx="8.5" cy="9" r="2.4" fill="currentColor" stroke="none" />
      <circle {...stroke} cx="15.5" cy="15" r="2.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function EmptyArtGlyph({ size = 44, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <rect {...stroke} x="5" y="2" width="14" height="20" rx="3" />
      <circle {...stroke} cx="12" cy="15" r="3.2" />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </Svg>
  );
}

/**
 * Three bars, moving: *this* is the one you are hearing.
 *
 * Not an SVG, and not a `size` prop either — it is the one glyph in this file whose whole content is
 * movement, and three `<i>`s the stylesheet can animate on their own delays cost less than a `<path>`
 * with three `<animate>` children. It marks the playing row in a queue and in a track listing, where the
 * alternative was a filled play triangle: a triangle says *press me to start*, which is exactly wrong for
 * the row that is already sounding.
 *
 * `data-still` for a paused room — the mark stays, because that row is still the one you are on, but a
 * paused player must not be drawn with the audio moving.
 */
export function Bars({
  still = false,
  className = 'cx-bars',
}: {
  still?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={className} data-still={still || undefined} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
