/**
 * The design tokens, defined once.
 *
 * Four surfaces render this product — the studio dashboard and /admin (React,
 * `client/src/styles.css`), the marketing site and the public booking page
 * (server-rendered from TS modules). Before this file each declared its own
 * `:root` block, and they had drifted:
 *
 *   --bg        dashboard #fdfcfb   marketing #fffdfb   booking #fdfcfb
 *   --line      dashboard #e2e5e9   marketing #e4e7ea   booking #e2e5e9
 *   --clay-lt   dashboard #f3e5dc   marketing #f6ece5   booking absent
 *   radius      --radius:10px       --r:12px            --radius:12px
 *
 * Nobody notices any single one of those. What people notice is that the
 * product shifts underneath them as they move from the marketing site to signup
 * to the dashboard — a feeling of two things bolted together, with no visible
 * cause to point at. The radius token had a different NAME on one surface, which
 * is how far apart they had gone.
 *
 * The client cannot import this file (separate bundle, no shared build), so it
 * keeps a mirrored copy in its stylesheet. `tests/design/tokens.test.ts` parses
 * both and fails if they disagree, which is what stops the drift returning.
 */

/** Values reconciled to the majority reading where surfaces disagreed. */
export const COLOR_TOKENS = {
  light: {
    '--ink': '#1f2328',
    '--muted': '#5c6570',
    '--clay': '#a6522c',
    '--clay-dk': '#6e3418',
    '--clay-lt': '#f3e5dc',
    /**
     * Clay as TEXT, kept separate from clay as a surface.
     *
     * --clay does two jobs: accent text, and the background of primary buttons
     * with white on top. On a dark ground the text job needs a lighter value and
     * the surface job needs the darker one — lightening --clay would drop
     * white-on-clay below AA and break every primary button.
     */
    '--clay-text': '#a6522c',
    '--line': '#e2e5e9',
    '--bg': '#fdfcfb',
    '--card': '#fff',
    '--ok': '#1f6f43',
    '--warn': '#8a5a00',
    '--danger': '#8b2c21',
  },
  dark: {
    '--ink': '#eceff3',
    '--muted': '#9aa4b0',
    '--clay-lt': '#3a2418',
    '--line': '#2b3138',
    '--bg': '#15181c',
    '--card': '#1c2026',

    /**
     * The semantic colours were never overridden for dark mode, so values built
     * for a white ground were used on near-black. Measured against --card:
     * danger 1.93:1, ok 2.66:1, warn 2.76:1 — all failing WCAG AA, with a
     * "no show" tag effectively invisible. These sit at 9.5:1 and above.
     */
    '--ok': '#9fd6a9',
    '--warn': '#e8c877',
    '--danger': '#f3b8b0',
    '--clay-text': '#d99a6c',
  },
} as const;

/**
 * A type scale, replacing the nineteen ad-hoc sizes that were in use — which
 * included .84, .85 and .86rem as three separate values. Differences that small
 * are not perceived as hierarchy; they are perceived as sloppiness.
 *
 * Sizes are in rem against a 16px root. Surfaces choose their own BODY size from
 * this scale rather than inventing one: the dashboard is dense and reads at 15px,
 * the marketing site is prose and reads at 17px. That difference is deliberate
 * and now expressed as two picks from one scale instead of two unrelated numbers.
 */
export const SCALE_TOKENS = {
  '--text-xs': '0.75rem',
  '--text-sm': '0.8125rem',
  '--text-base': '0.9375rem',
  '--text-md': '1.0625rem',
  '--text-lg': '1.25rem',
  '--text-xl': '1.5rem',
  '--text-2xl': '2rem',

  /** 4px base. Replaces sixteen ad-hoc padding/margin/gap values. */
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '20px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--space-10': '40px',
  '--space-12': '48px',

  '--radius-sm': '8px',
  '--radius': '10px',
  '--radius-lg': '14px',
  '--radius-pill': '999px',

  /**
   * Elevation. There was no box-shadow anywhere in the product, which is why
   * cards, dropdowns and modals all sat on one visual plane.
   */
  '--shadow-sm': '0 1px 2px rgba(16,20,26,.05)',
  '--shadow-md': '0 2px 8px rgba(16,20,26,.07), 0 1px 2px rgba(16,20,26,.04)',
  '--shadow-lg': '0 12px 32px rgba(16,20,26,.12), 0 2px 6px rgba(16,20,26,.05)',

  /**
   * Motion. Also entirely absent before. Fast enough to feel immediate; the
   * easing decelerates so movement settles rather than stopping dead.
   */
  '--motion-fast': '120ms',
  '--motion-base': '180ms',
  '--ease': 'cubic-bezier(.2, 0, 0, 1)',
} as const;

/** Shadows need more weight on a dark ground to read at all. */
export const DARK_SCALE_TOKENS = {
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.4)',
  '--shadow-md': '0 2px 8px rgba(0,0,0,.45), 0 1px 2px rgba(0,0,0,.3)',
  '--shadow-lg': '0 12px 32px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.35)',
} as const;

function declare(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/**
 * The `:root` block, for inlining into a server-rendered page.
 *
 * Emitted compact because it ships in the document on every request.
 */
export function tokensCss(): string {
  return [
    `:root{${declare({ ...COLOR_TOKENS.light, ...SCALE_TOKENS })}}`,
    `@media(prefers-color-scheme:dark){:root{${declare({
      ...COLOR_TOKENS.dark,
      ...DARK_SCALE_TOKENS,
    })}}}`,
    /**
     * Honour a reader who has asked for less movement. Required for WCAG 2.3.3
     * and, more to the point, motion sickness is real and this costs one rule.
     */
    `@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}`,
  ].join('\n');
}
