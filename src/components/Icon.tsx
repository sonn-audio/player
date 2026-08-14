/**
 * The icon set, inline.
 *
 * Inline SVG rather than a font or a sprite: there are two dozen glyphs, they inherit
 * `currentColor`, and it keeps the player a single self-contained bundle with no icon
 * dependency to version.
 *
 * Most are filled paths, which is right at 13–15px in a dense list. The **transport** glyphs are
 * stroked instead, because they are drawn at 22–25px with no plate behind them: a solid triangle that
 * size is a heavy black-on-black blob, while a 1.8px outline reads as an instrument's marking. Which of
 * the two a glyph gets is `STROKED`, not a prop — a shuffle icon should not be able to look different
 * in two places.
 */

export type IconName =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'shuffle'
  | 'repeat'
  | 'repeat-one'
  | 'volume-up'
  | 'volume-down'
  | 'speaker'
  | 'group'
  | 'queue'
  | 'star'
  | 'clock'
  | 'input'
  | 'search'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'trash'
  | 'sliders'
  | 'grip'
  | 'wave'
  | 'plus'
  | 'minus'
  | 'folder'
  | 'check';

/**
 * Which glyphs are drawn as strokes rather than fills.
 *
 * The transport four, plus the two repeat variants. Everything else is a filled path, which holds up at
 * label size where a hairline outline would disappear.
 */
const STROKED = new Set<IconName>(['previous', 'next', 'shuffle', 'repeat', 'repeat-one']);

const PATHS: Record<IconName, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  // Outlined triangles with a bar, the way a transport is engraved on hardware — see `STROKED`.
  next: 'M6 5.9v12.2L16.3 12 6 5.9zM18.7 5.9v12.2',
  previous: 'M18 5.9v12.2L7.7 12 18 5.9zM5.3 5.9v12.2',
  shuffle: 'M16 3h5v5M21 3l-7 7M16 21h5v-5M21 21 3 3M4 21l5-5',
  repeat: 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3',
  // The repeat arrows with a 1 in the middle. Stroked like its sibling; the digit is a stroke too, so
  // the whole glyph keeps one weight.
  'repeat-one': 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3M11.4 10.6l1.4-.8v4.4',
  'volume-up': 'M4 9h3l4-4v14l-4-4H4V9zm11.5-.6a5 5 0 010 7.2l-1-1a3.6 3.6 0 000-5.2l1-1zm2.2-2.2a8 8 0 010 11.6l-1-1a6.6 6.6 0 000-9.6l1-1z',
  // Deliberately just the cone with no arcs: next to volume-up at 16px the
  // one-arc-versus-two-arcs difference is invisible, so "quieter" reads as an
  // absence of waves instead.
  'volume-down': 'M4 9h3l4-4v14l-4-4H4V9z',
  // A cone rather than a cabinet: the boxed-speaker outline turns into a grey rectangle at
  // tab size, where this stays recognisable.
  speaker: 'M4 9h4l5-5v16l-5-5H4V9zm12.5-.6a5 5 0 010 7.2l-1.1-1.1a3.5 3.5 0 000-5l1.1-1.1z',
  group: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z',
  queue: 'M3 6h12v2H3V6zm0 5h12v2H3v-2zm0 5h8v2H3v-2zm14-1.2V9h4v2h-2v5.5a2.5 2.5 0 11-2-2.45z',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v5.6l4 2.4-1 1.6-5-3V7h2z',
  input: 'M9 2h6v5h3v6a6 6 0 01-5 5.9V22h-2v-3.1A6 6 0 016 13V7h3V2zm2 2v3h2V4h-2z',
  search: 'M10 3a7 7 0 015.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10z',
  'chevron-right': 'M9 5l7 7-7 7-1.4-1.4L13.2 12 7.6 6.4 9 5z',
  'chevron-down': 'M5 9l7 7 7-7-1.4-1.4L12 13.2 6.4 7.6 5 9z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 13H7L6 8zm4 2v9h1.5v-9H10zm3.5 0v9H15v-9h-1.5z',
  sliders: 'M4 6h9v2H4V6zm11 0h5v2h-5V6zm-4-3h2v5h-2V3zM4 16h5v2H4v-2zm7 0h9v2h-9v-2zm-2-3h2v5H9v-5z',
  // A plus, for "this room too". Stroked would be thinner than the glyphs beside it at 13px, so it is
  // two filled bars.
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z',
  // The pair the nudge buttons need: one step earlier, one step later.
  minus: 'M5 11h14v2H5v-2z',
  // A place in the catalogue, for a browsable folder that has no artwork of its own. Records
  // stacked in a rack rather than a document folder: what is behind it is music, not files.
  folder: 'M5 8h14v12H5V8zm2-3h10v2H7V5zm2-3h6v1.5H9V2z',
  check: 'M9.6 16.2L5.4 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4z',
  // Four bars of a level meter: the mark for "this is what is playing", used by the bar's own label.
  wave: 'M4 10h2v4H4v-4zm4.5-3h2v10h-2V7zm4.5-3h2v16h-2V4zm4.5 5h2v6h-2V9z',
  // Two columns of dots — the conventional "this row can be dragged" affordance.
  grip: 'M9 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 16a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const stroked = STROKED.has(name);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} focusable="false">
      <path
        d={PATHS[name]}
        {...(stroked
          ? {
              fill: 'none',
              stroke: 'currentColor',
              // Non-scaling so the weight is the same at 13px in a menu and at 25px in the transport;
              // without it a big glyph looks fat and a small one looks faint.
              vectorEffect: 'non-scaling-stroke' as const,
              strokeWidth: 1.8,
              strokeLinecap: 'round' as const,
              strokeLinejoin: 'round' as const,
            }
          : { fill: 'currentColor' })}
      />
    </svg>
  );
}
