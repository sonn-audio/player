/**
 * The mark: a roofline over a waveform — rooms above, the audio below.
 *
 * Inline SVG rather than an asset so it inherits `currentColor` and can be sized by CSS. That is
 * what lets one drawing be the accent-coloured brand in the technical rail, a 168px splash in the intro
 * and the wordmark in both players' top bars, without three copies of a file to keep in step.
 *
 * The bars carry descending `fill-opacity` from the centre out, so the mark reads as a level meter
 * at rest. `Mark` is the static one; the intro animates the same geometry (see `Intro`), which is
 * only possible because the bars are individual `<rect>`s rather than one path.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="8 12 84 68" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="20" y="63.1" width="2.17" height="5.78" rx="1.08" fillOpacity="0.4" />
        <rect x="25.78" y="59.5" width="2.17" height="13.01" rx="1.08" fillOpacity="0.6" />
        <rect x="31.57" y="61.66" width="2.17" height="8.67" rx="1.08" fillOpacity="0.8" />
        <rect x="37.35" y="58.05" width="2.17" height="15.9" rx="1.08" />
        <rect x="46.03" y="56.6" width="2.89" height="18.8" rx="1.45" />
        <rect x="54.69" y="58.05" width="2.17" height="15.9" rx="1.08" />
        <rect x="60.48" y="60.94" width="2.17" height="10.12" rx="1.08" fillOpacity="0.9" />
        <rect x="66.26" y="58.77" width="2.17" height="14.46" rx="1.08" fillOpacity="0.8" />
        <rect x="72.05" y="62.38" width="2.17" height="7.23" rx="1.08" fillOpacity="0.7" />
        <rect x="77.83" y="63.83" width="2.17" height="4.34" rx="1.08" fillOpacity="0.6" />
      </g>
      <path
        d="M14 46 L50 18 L86 46"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
