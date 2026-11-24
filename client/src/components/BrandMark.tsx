import { useId } from 'react';

/**
 * The BookAIHub logo: a calendar with peach day tiles and one orange tile, an
 * orange check badge, and an orange orbit around it.
 *
 * The same drawing as the marketing site's `logoMark` (server
 * `modules/marketing/brand-logo.ts`). The calendar body and face read
 * --lm-body / --lm-face, so the mark flips to a light calendar on a dark
 * panel. Gradient ids come from useId, so two marks on one screen do not
 * share (and fight over) one gradient.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const body = { fill: 'var(--lm-body, #262833)' };
  const face = { fill: 'var(--lm-face, #fff)' };
  const tab = { fill: 'var(--lm-body, #262833)', stroke: 'var(--lm-face, #fff)' };

  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`lo${id}`} x1="4" y1="50" x2="60" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff9a52" />
          <stop offset=".55" stopColor="#ff7a2e" />
          <stop offset="1" stopColor="#ff8a3d" />
        </linearGradient>
        <linearGradient id={`lc${id}`} x1="34" y1="32" x2="54" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#ef4f17" />
        </linearGradient>
      </defs>
      <path
        d="M40 9.5C53 3.5 65 5.5 61.5 17.5 58 29.5 41 47 24.5 52 10.5 56.2.4 51.6 1.4 44.6 2.1 39.6 5.6 33.4 9.6 29.4 6.2 34.8 4.8 40.6 7.2 44 10.8 49.2 23.4 47.6 34.2 42.2 47.2 35.6 56.6 25.6 57 17.4 57.3 11.2 50.6 9.4 40 9.5Z"
        fill={`url(#lo${id})`}
      />
      <rect x="9" y="12" width="37" height="34" rx="7.5" style={body} />
      <rect x="14" y="19.5" width="27" height="21.5" rx="3.5" style={face} />
      <rect x="18.4" y="7" width="5.4" height="10.5" rx="2.7" strokeWidth="1.6" style={tab} />
      <rect x="31.2" y="7" width="5.4" height="10.5" rx="2.7" strokeWidth="1.6" style={tab} />
      <g fill="#fdd0b4">
        <rect x="17" y="23" width="5.6" height="5.6" rx="1.4" />
        <rect x="24.7" y="23" width="5.6" height="5.6" rx="1.4" />
        <rect x="32.4" y="23" width="5.6" height="5.6" rx="1.4" />
        <rect x="17" y="31" width="5.6" height="5.6" rx="1.4" />
      </g>
      <rect x="24.7" y="31" width="5.6" height="5.6" rx="1.4" fill="#f25a1f" />
      <circle
        cx="44"
        cy="43"
        r="10.2"
        fill={`url(#lc${id})`}
        strokeWidth="2.4"
        style={{ stroke: 'var(--lm-face, #fff)' }}
      />
      <path
        d="m39.4 43.2 3.2 3.1 6-6.2"
        stroke="#fff"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The wordmark as on the marketing site: Book, AI in the orange gradient, Hub. */
export function Wordmark() {
  return (
    <span className="wm-text">
      Book<em>AI</em>Hub
    </span>
  );
}
