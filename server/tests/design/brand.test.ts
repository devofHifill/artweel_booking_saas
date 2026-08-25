import { describe, expect, it } from 'vitest';
import {
  AA,
  BRANDABLE,
  BRAND_PRESETS,
  DEFAULT_PRESET_ID,
  GROUND,
  brandCss,
  contrast,
  deriveBrand,
  findPreset,
  resolveBrand,
} from '../../src/lib/brand';
import {
  COLOR_TOKENS,
  DASHBOARD_COLOR_TOKENS,
} from '../../src/lib/design-tokens';

/**
 * A studio picking its own accent is the one place where somebody outside this
 * repository chooses a colour that ships in our CSS. Everything below exists
 * because that colour cannot be reviewed by a person before it renders.
 *
 * The sibling file, tokens.test.ts, guards the opposite direction: that the four
 * surfaces agree on the shared tokens. This one guards that a theme can only
 * ever move the four it is allowed to move, and that whatever it moves them to
 * is still legible.
 */

/** Every pairing a brand token has to survive, per colour scheme. */
function audit(scheme: { light: Record<string, string>; dark: Record<string, string> }) {
  return [
    // Light. White button label on the accent, and the accent as text on --card.
    ['light: white on --clay', contrast(scheme.light['--clay']!, GROUND.onAccent)],
    ['light: white on --clay-dk', contrast(scheme.light['--clay-dk']!, GROUND.onAccent)],
    ['light: --clay-text on --card', contrast(scheme.light['--clay-text']!, GROUND.lightCard)],
    ['light: --ink on --clay-lt', contrast(scheme.light['--clay-lt']!, GROUND.lightInk)],

    // Dark. The tint inverts and the accent text lightens; the button does not.
    ['dark: white on --clay', contrast(scheme.dark['--clay']!, GROUND.onAccent)],
    ['dark: white on --clay-dk', contrast(scheme.dark['--clay-dk']!, GROUND.onAccent)],
    ['dark: --clay-text on --card', contrast(scheme.dark['--clay-text']!, GROUND.darkCard)],
    ['dark: --ink on --clay-lt', contrast(scheme.dark['--clay-lt']!, GROUND.darkInk)],
  ] as const;
}

describe('the grounds a theme is judged against', () => {
  /**
   * GROUND hard-codes the structural colours a brand token sits on, so that the
   * contrast rules in brand.ts are pure functions of a preset. That is only safe
   * while the copies agree — otherwise every guarantee in this file is measured
   * against a --card that no longer exists.
   */
  it('still match the shared tokens', () => {
    expect(GROUND.lightCard).toBe(COLOR_TOKENS.light['--card']);
    expect(GROUND.darkCard).toBe(COLOR_TOKENS.dark['--card']);
    expect(GROUND.lightInk).toBe(COLOR_TOKENS.light['--ink']);
    expect(GROUND.darkInk).toBe(COLOR_TOKENS.dark['--ink']);
  });
});

describe('every shipped preset is legible', () => {
  for (const preset of BRAND_PRESETS) {
    it(`${preset.id} passes AA on all eight pairings`, () => {
      for (const [label, ratio] of audit(preset)) {
        expect(ratio, `${preset.id} — ${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  /**
   * The default must be a no-op.
   *
   * If the default preset drifts from the accent baked into the stylesheet by
   * even one value, every studio that never picked a colour gets a visible
   * flash from one accent to another on each page load — `lib/brand.ts` paints
   * the CSS fallback first and replaces it once the API answers.
   *
   * Measured against the DASHBOARD tokens since D0, not the shared ones. The
   * shared set stays clay for the marketing site and the booking page; the
   * dashboard's fallback is indigo because that is what `DEFAULT_PRESET_ID` is.
   * This test is what caught the two of them disagreeing.
   */
  it('the default preset reproduces the dashboard accent exactly', () => {
    const preset = findPreset(DEFAULT_PRESET_ID)!;
    const light = DASHBOARD_COLOR_TOKENS.light;
    const dark = DASHBOARD_COLOR_TOKENS.dark;

    expect(preset.light['--clay']).toBe(light['--clay']);
    expect(preset.light['--clay-dk']).toBe(light['--clay-dk']);
    expect(preset.light['--clay-lt']).toBe(light['--clay-lt']);
    expect(preset.light['--clay-text']).toBe(light['--clay-text']);

    // Dark overrides only two of the four; the others inherit from light.
    expect(preset.dark['--clay-lt']).toBe(dark['--clay-lt']);
    expect(preset.dark['--clay-text']).toBe(dark['--clay-text']);
    expect(preset.dark['--clay']).toBe(light['--clay']);
    expect(preset.dark['--clay-dk']).toBe(light['--clay-dk']);
  });

  it('has unique ids', () => {
    const ids = BRAND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a custom accent is derived, not trusted', () => {
  /**
   * The colours a real owner actually types. Two of them are traps:
   *
   *   #ffd400 — a bright yellow. Reads fine as a swatch, and white-on-yellow is
   *             about 1.6:1. This is the case the whole derivation exists for.
   *   #0b1d3a — a navy so dark it passes the button test easily and is close to
   *             invisible as text on a dark card.
   */
  const REAL_WORLD = [
    '#a6522c', // the default, typed by hand
    '#4f46e5', // TourFlow indigo
    '#ffd400', // bright yellow
    '#0b1d3a', // near-black navy
    '#e91e63', // hot pink
    '#00bcd4', // cyan
    '#7cb342', // olive green
    '#795548', // brown
    '#000000',
    '#ffffff',
  ];

  for (const accent of REAL_WORLD) {
    it(`${accent} derives a scheme that passes AA everywhere`, () => {
      const { scheme } = deriveBrand(accent);
      for (const [label, ratio] of audit(scheme)) {
        expect(ratio, `${accent} — ${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it('reports when it had to move the colour, and says so in words', () => {
    const yellow = deriveBrand('#ffd400');

    expect(yellow.adjusted).toBe(true);
    expect(yellow.notes.length).toBeGreaterThan(0);
    // The note has to name the new value, or "we changed your colour" is useless.
    expect(yellow.notes.join(' ')).toMatch(/#[0-9a-f]{6}/);
    expect(yellow.scheme.light['--clay']).not.toBe('#ffd400');
  });

  it('leaves a colour alone when it already passes', () => {
    const indigo = deriveBrand('#4f46e5');

    expect(indigo.adjusted).toBe(false);
    expect(indigo.notes).toEqual([]);
    expect(indigo.scheme.light['--clay']).toBe('#4f46e5');
  });

  /**
   * `adjusted` reports the accent being moved, and nothing else.
   *
   * Every colour is lightened for dark-mode text, because the two AA
   * constraints cannot both be met — white on the accent caps luminance at
   * 0.183, accent-as-text on the dark card floors it at 0.238. Counting that as
   * an adjustment would make the flag true for every input in sRGB, which is the
   * same as having no flag: the owner learns to dismiss the warning, including
   * on the day it means their buttons are not the colour they chose.
   */
  it('does not call the unconditional dark-mode step an adjustment', () => {
    for (const accent of REAL_WORLD) {
      const derived = deriveBrand(accent);
      const surfaceMoved = derived.scheme.light['--clay'] !== accent.toLowerCase();

      expect(derived.adjusted, `${accent} reported the wrong adjustment state`).toBe(
        surfaceMoved,
      );

      // And the dark step really did fire, so the test above is not vacuous.
      expect(derived.scheme.dark['--clay-text']).not.toBe(
        derived.scheme.light['--clay-text'],
      );
    }
  });

  it('keeps the hue it was given', () => {
    // Yellow must still be recognisably yellow after being darkened for AA:
    // red and green high, blue low. Moving lightness is acceptable; silently
    // handing back a different colour is not.
    const clay = deriveBrand('#ffd400').scheme.light['--clay'];
    const [r, g, b] = [clay.slice(1, 3), clay.slice(3, 5), clay.slice(5, 7)].map((h) =>
      Number.parseInt(h, 16),
    );

    expect(r).toBeGreaterThan(100);
    expect(g).toBeGreaterThan(80);
    expect(b).toBeLessThan(60);
  });

  it('refuses malformed input rather than emitting it', () => {
    expect(() => deriveBrand('red')).toThrow();
    expect(() => deriveBrand('#12345')).toThrow();
    expect(() => deriveBrand('#gggggg')).toThrow();
    // The one that matters: this string ends up inside a <style> block.
    expect(() => deriveBrand('#fff}body{display:none')).toThrow();
  });
});

describe('the emitted override', () => {
  /**
   * The load-bearing assertion in this file.
   *
   * A theme may move an accent. It may not move --ink, --bg, --card, --line or
   * any scale — those are what keep a branded dashboard readable and keep the
   * four surfaces looking like one product. If this ever fails, a studio has
   * been handed the ability to break its own UI.
   */
  it('declares the four brand tokens and nothing else', () => {
    for (const preset of BRAND_PRESETS) {
      const declared = [
        ...brandCss(preset, { themeAttr: true }).matchAll(/(--[a-z0-9-]+)\s*:/gi),
      ].map((match) => match[1]!);

      expect(new Set(declared)).toEqual(new Set(BRANDABLE));
    }
  });

  /**
   * The dashboard has a three-state theme toggle, so its override must use the
   * same guarded selectors as client/src/styles.css. A bare media query would
   * drag a user who pinned light mode into dark brand tokens the moment their OS
   * went dark — half the palette switching and half not.
   */
  it('respects a pinned theme on the dashboard', () => {
    const css = brandCss(BRAND_PRESETS[1]!, { themeAttr: true });

    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });

  /** The public page and widget have no toggle; a plain media query is correct there. */
  it('uses a bare media query on server-rendered surfaces', () => {
    const css = brandCss(BRAND_PRESETS[1]!);

    expect(css).toContain('@media(prefers-color-scheme:dark)');
    expect(css).not.toContain('data-theme');
  });
});

describe('resolving what to render', () => {
  it('prefers a stored accent over the preset id', () => {
    const scheme = resolveBrand({ brandPreset: 'indigo', brandAccent: '#2f6b4f' });
    expect(scheme.light['--clay']).toBe('#2f6b4f');
  });

  it('falls back to the preset when no accent is stored', () => {
    const scheme = resolveBrand({ brandPreset: 'plum', brandAccent: null });
    expect(scheme.light['--clay']).toBe(findPreset('plum')!.light['--clay']);
  });

  /**
   * Decoration must never be able to take a dashboard down. A preset removed or
   * renamed in a later deploy leaves rows pointing at an id that no longer
   * exists; those studios should go clay, not 500.
   */
  it('falls back to clay for an unknown preset', () => {
    const scheme = resolveBrand({ brandPreset: 'chartreuse-deluxe', brandAccent: null });
    expect(scheme.light['--clay']).toBe(findPreset(DEFAULT_PRESET_ID)!.light['--clay']);
  });

  /** Same argument for a stored accent that no longer derives cleanly. */
  it('falls back to clay for a corrupt stored accent', () => {
    const scheme = resolveBrand({ brandPreset: 'clay', brandAccent: 'not-a-colour' });
    expect(scheme.light['--clay']).toBe(findPreset(DEFAULT_PRESET_ID)!.light['--clay']);
  });
});
