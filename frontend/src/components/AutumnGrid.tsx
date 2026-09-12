/**
 * Autumn-style pixel grid: a faint square-dot lattice with a radial fade.
 * Sits behind the whole app so the glass brain reads over it.
 */
export default function AutumnGrid() {
  return (
    <div className="autumn-grid" aria-hidden>
      <svg className="autumn-grid-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="autumnDots" width="18" height="18" patternUnits="userSpaceOnUse">
            <rect x="7" y="7" width="2" height="2" fill="rgba(230,230,235,0.28)" />
          </pattern>
          <radialGradient id="autumnFade" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="55%" stopColor="white" stopOpacity="0.7" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="autumnMask">
            <rect width="100%" height="100%" fill="url(#autumnFade)" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#autumnDots)" mask="url(#autumnMask)" />
      </svg>
    </div>
  );
}
