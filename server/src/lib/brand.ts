/**
 * Per-studio branding, as an OVERRIDE LAYER over the shared design tokens.
 *
 * `design-tokens.ts` stays the single source of truth for what this product
 * looks like, and `tests/design/tokens.test.ts` still fails if any surface
 * disagrees with it. Nothing here edits those declarations. A studio's theme is
 * a small block emitted AFTER them that redefines four tokens and no others:
 *
 *   --clay        the accent as a SURFACE — primary button background
 *   --clay-dk     the same surface, pressed/hovered
 *   --clay-lt     the accent as a tint, with --ink text on top
 *   --clay-text   the accent as TEXT, on --card or --bg
 *
 * Structural tokens — --ink, --bg, --card, --line, the semantic trio, and every
 * scale — are deliberately NOT brandable. A studio choosing its accent is
 * branding; a studio choosing its own body text colour is a support ticket, and
 * `brandCss` is asserted to touch only the four above.
 *
 * ---
 *
 * Why presets rather than a bare colour picker.
 *
 * --clay does two jobs, which design-tokens.ts already states and which is the
 * whole problem here: it is accent text AND the ground under white button
 * labels. A free hex field lets an owner pick a cheerful yellow that reads
 * perfectly well as a link and drops white-on-yellow to about 1.6:1 on every
 * primary button in their dashboard. They would not read that as a contrast
 * failure. They would read it as a product that looks broken.
 *
 * So a theme is not one colour. It is four values per colour scheme, eight in
 * total, each checked — see `tests/design/brand.test.ts`. A custom accent is
 * still allowed, because an owner with a real brand book will want one, but it
 * is DERIVED rather than taken literally: the hue is kept and the lightness
 * moved until every pairing passes WCAG AA, with the adjustment reported back so
 * the change is visible rather than silent.
 */

/** The four brandable tokens. Deliberately not extensible; see above. */
export type BrandTokens = {
  '--clay': string;
  '--clay-dk': string;
  '--clay-lt': string;
  '--clay-text': string;
};

export type BrandScheme = { light: BrandTokens; dark: BrandTokens };

export type BrandPreset = BrandScheme & {
  id: string;
  /** Shown in the settings picker. */
  name: string;
};

/** The token names a theme may set. Anything else is structural. */
export const BRANDABLE: readonly (keyof BrandTokens)[] = [
  '--clay',
  '--clay-dk',
  '--clay-lt',
  '--clay-text',
];

/** WCAG AA for normal-size text. Button labels and accent links are both that. */
export const AA = 4.5;

/*
  The grounds every brand token is judged against.

  These are structural tokens, which is exactly why they can be constants here:
  a preset can never move the surface it has to be legible on. The values mirror
  COLOR_TOKENS in design-tokens.ts, and `tests/design/brand.test.ts` asserts they
  still agree — so changing --card there cannot silently invalidate every
  contrast guarantee made in this file.
*/
export const GROUND = {
  /** --card, light. Accent text and tinted panels sit on this. */
  lightCard: '#fff',
  /** --card, dark. */
  darkCard: '#1c2026',
  /** --ink, light — the text that sits on a --clay-lt tint. */
  lightInk: '#1f2328',
  /** --ink, dark. */
  darkInk: '#eceff3',
  /** Button labels are white on --clay in both schemes. */
  onAccent: '#ffffff',
} as const;

// --- colour maths ---------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || !/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(int)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG relative luminance: sRGB channels linearised, then weighted. */
export function luminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Contrast ratio.
 *
 * Symmetric, which is worth noticing rather than rediscovering: checking
 * white-on-clay also checks clay-on-white. That is why `--clay` and
 * `--clay-text` can share a value in light mode and still be provably legible in
 * both of the jobs the token does.
 */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- HSL, used only to move lightness while keeping a studio's hue ---------

function rgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return [0, 0, l * 100];

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lig - c / 2;

  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];

  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Walks lightness one step at a time until `ok` is satisfied.
 *
 * Steps rather than solving: contrast is not linear in lightness, and stopping
 * at the FIRST passing value keeps the result as close to the colour the owner
 * actually asked for as the rule allows. Returns null when the whole range
 * fails, which happens for hues with nowhere left to go.
 */
function walkLightness(
  hex: string,
  direction: 'darker' | 'lighter',
  ok: (candidate: string) => boolean,
): string | null {
  const [h, s, l] = rgbToHsl(hex);
  const step = direction === 'darker' ? -2 : 2;

  for (let value = l; value >= 0 && value <= 100; value += step) {
    const candidate = hslToHex(h, s, value);
    if (ok(candidate)) return candidate;
  }
  return null;
}

// --- presets --------------------------------------------------------------

/**
 * `clay` reproduces the current tokens EXACTLY, including the two the dark block
 * overrides today, so a studio that never opens the picker sees no change at
 * all. It is the schema default for the same reason.
 *
 * `--clay` and `--clay-dk` repeat in every dark scheme rather than being
 * omitted. Today the dark block leaves them alone and they inherit their light
 * values; saying so explicitly costs two lines and means every preset answers
 * the same eight questions, instead of some answering six and inheriting the
 * rest from a rule nobody remembers.
 */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  {
    id: 'clay',
    name: 'Clay',
    light: {
      '--clay': '#a6522c',
      '--clay-dk': '#6e3418',
      '--clay-lt': '#f3e5dc',
      '--clay-text': '#a6522c',
    },
    dark: {
      '--clay': '#a6522c',
      '--clay-dk': '#6e3418',
      '--clay-lt': '#3a2418',
      '--clay-text': '#d99a6c',
    },
  },
  {
    id: 'indigo',
    name: 'Indigo',
    light: {
      '--clay': '#4f46e5',
      '--clay-dk': '#3730a3',
      '--clay-lt': '#eef2ff',
      '--clay-text': '#4338ca',
    },
    dark: {
      '--clay': '#4f46e5',
      '--clay-dk': '#3730a3',
      '--clay-lt': '#1e1b3a',
      '--clay-text': '#a5b4fc',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      '--clay': '#2f6b4f',
      '--clay-dk': '#1d4733',
      '--clay-lt': '#e3f0e9',
      '--clay-text': '#2f6b4f',
    },
    dark: {
      '--clay': '#2f6b4f',
      '--clay-dk': '#1d4733',
      '--clay-lt': '#182a21',
      '--clay-text': '#7fc9a0',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: {
      '--clay': '#41505f',
      '--clay-dk': '#2a3541',
      '--clay-lt': '#e8ecf0',
      '--clay-text': '#41505f',
    },
    dark: {
      '--clay': '#41505f',
      '--clay-dk': '#2a3541',
      '--clay-lt': '#222a33',
      '--clay-text': '#a9b6c4',
    },
  },
  {
    id: 'plum',
    name: 'Plum',
    light: {
      '--clay': '#6d3060',
      '--clay-dk': '#4a1f41',
      '--clay-lt': '#f2e4ef',
      '--clay-text': '#6d3060',
    },
    dark: {
      '--clay': '#6d3060',
      '--clay-dk': '#4a1f41',
      '--clay-lt': '#2c1927',
      '--clay-text': '#d79bc7',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    light: {
      '--clay': '#b2431f',
      '--clay-dk': '#7d2d13',
      '--clay-lt': '#fbe6dd',
      '--clay-text': '#a83f1d',
    },
    dark: {
      '--clay': '#b2431f',
      '--clay-dk': '#7d2d13',
      '--clay-lt': '#341a11',
      '--clay-text': '#f0a081',
    },
  },
] as const;

export const DEFAULT_PRESET_ID = 'clay';

export function findPreset(id: string): BrandPreset | undefined {
  return BRAND_PRESETS.find((preset) => preset.id === id);
}

// --- deriving a scheme from one accent ------------------------------------

export type Derived = {
  scheme: BrandScheme;
  /**
   * True when AA forced the ACCENT ITSELF away from what was asked for — i.e.
   * the owner's buttons are not the colour they typed.
   *
   * Deliberately NOT set by the dark-mode text derivation below, which happens
   * for every colour without exception. The two constraints are mutually
   * exclusive, and the arithmetic is worth writing down because it looks like a
   * bug otherwise:
   *
   *   white on the accent  >= 4.5  =>  luminance <= 1.05/4.5 - 0.05 = 0.183
   *   accent on --card dark >= 4.5  =>  luminance >= 4.5*0.064 - 0.05 = 0.238
   *
   * 0.238 > 0.183, so no colour in sRGB satisfies both. A flag that is true for
   * every possible input carries no information — it would have shown "we
   * adjusted your colour" to an owner whose exact hex was on every button in
   * their dashboard, and taught them to ignore the one warning that matters.
   */
  adjusted: boolean;
  /** Plain-language description of each adjustment, for the settings screen. */
  notes: string[];
};

/**
 * Builds a full eight-value scheme from a single accent.
 *
 * The accent is treated as the SURFACE colour — the button ground — because
 * that is the job with the hard constraint (white text on top). Everything else
 * is derived from it, and every derived value is verified rather than assumed.
 */
export function deriveBrand(accent: string): Derived {
  const notes: string[] = [];
  const requested = accent.trim().toLowerCase();
  hexToRgb(requested); // throws on malformed input, before anything else runs

  // 1. The surface. White label on top must clear AA.
  let surface = requested;
  if (contrast(surface, GROUND.onAccent) < AA) {
    const darker = walkLightness(
      requested,
      'darker',
      (candidate) => contrast(candidate, GROUND.onAccent) >= AA,
    );
    if (!darker) {
      throw new Error(
        'That colour cannot carry white button text at any lightness. Pick a different hue.',
      );
    }
    surface = darker;
    notes.push(
      `Darkened to ${surface} so white button text stays readable (WCAG AA).`,
    );
  }

  // 2. Pressed state: a fixed step down from the surface, floored at black.
  const [h, s, l] = rgbToHsl(surface);
  const pressed = hslToHex(h, s, Math.max(0, l - 12));

  /*
    3. The light tint.

    Same hue at low saturation and high lightness. --ink sits on top of it, and
    --ink is near-black, so this passes comfortably for any hue — but it is
    checked rather than assumed, because "obviously fine" is how the semantic
    colours ended up at 1.93:1 on dark.
  */
  let tintLight = hslToHex(h, Math.min(s, 45), 92);
  if (contrast(tintLight, GROUND.lightInk) < AA) {
    const lighter = walkLightness(
      tintLight,
      'lighter',
      (candidate) => contrast(candidate, GROUND.lightInk) >= AA,
    );
    tintLight = lighter ?? '#f5f5f5';
  }

  // 4. The dark tint. Same idea inverted: --ink is near-white on dark.
  let tintDark = hslToHex(h, Math.min(s, 40), 14);
  if (contrast(tintDark, GROUND.darkInk) < AA) {
    const darker = walkLightness(
      tintDark,
      'darker',
      (candidate) => contrast(candidate, GROUND.darkInk) >= AA,
    );
    tintDark = darker ?? '#111111';
  }

  /*
    5. Accent TEXT, per scheme.

    Light: the surface value already clears AA against white, and contrast is
    symmetric, so it can serve unchanged.

    Dark: it cannot. A mid-tone accent that reads well on white is close to
    invisible on #1c2026 — the same failure design-tokens.ts documents for the
    semantic colours, where danger sat at 1.93:1. So the dark text value is
    lightened until it clears AA against the dark card.

    This branch runs for EVERY colour — see the note on `adjusted` above for why
    that is arithmetic rather than coincidence — so it is not reported as an
    adjustment. "Your accent appears lighter as text in dark mode" is a fact
    about the theme system, and belongs in the settings screen once, not in a
    per-colour warning that is never absent.
  */
  const textLight = surface;
  let textDark = surface;
  if (contrast(textDark, GROUND.darkCard) < AA) {
    const lighter = walkLightness(
      surface,
      'lighter',
      (candidate) => contrast(candidate, GROUND.darkCard) >= AA,
    );
    if (!lighter) {
      throw new Error(
        'That colour cannot be read as text in dark mode. Pick a different hue.',
      );
    }
    textDark = lighter;
  }

  return {
    scheme: {
      light: {
        '--clay': surface,
        '--clay-dk': pressed,
        '--clay-lt': tintLight,
        '--clay-text': textLight,
      },
      dark: {
        '--clay': surface,
        '--clay-dk': pressed,
        '--clay-lt': tintDark,
        '--clay-text': textDark,
      },
    },
    adjusted: notes.length > 0,
    notes,
  };
}

/**
 * The scheme a studio should actually render.
 *
 * A stored custom accent wins over the preset id; the preset is the fallback,
 * and an unrecognised id falls back to the default rather than throwing. A theme
 * is decoration, and decoration must never be able to take a dashboard down —
 * if a preset is renamed or removed in a later deploy, the studios pointing at
 * it should go clay, not 500.
 */
export function resolveBrand(input: {
  brandPreset?: string | null;
  brandAccent?: string | null;
}): BrandScheme {
  if (input.brandAccent) {
    try {
      return deriveBrand(input.brandAccent).scheme;
    } catch {
      return findPreset(DEFAULT_PRESET_ID)!;
    }
  }

  const preset = findPreset(input.brandPreset ?? DEFAULT_PRESET_ID);
  return preset ?? findPreset(DEFAULT_PRESET_ID)!;
}

// --- emitting -------------------------------------------------------------

function declare(tokens: BrandTokens): string {
  return BRANDABLE.map((name) => `${name}:${tokens[name]}`).join(';');
}

/**
 * The override block, to be placed AFTER the shared tokens.
 *
 * Two selector shapes, because the surfaces differ:
 *
 *   `themeAttr: true`  — the React dashboard, where a user can pin light or dark
 *     with the three-state toggle. Mirrors the guarded selectors already in
 *     `client/src/styles.css`: the media query is scoped with
 *     `:not([data-theme="light"])` so a user pinned to light is not dragged into
 *     dark tokens by their OS, and an explicit `[data-theme="dark"]` rule lets
 *     the toggle win in the other direction.
 *
 *   `themeAttr: false` — the server-rendered booking page and widget, which have
 *     no toggle. A bare media query, matching `tokensCss()`.
 *
 * Emitted compact: on the public page this ships in the document on every
 * request.
 */
export function brandCss(
  scheme: BrandScheme,
  { themeAttr = false }: { themeAttr?: boolean } = {},
): string {
  const light = `:root{${declare(scheme.light)}}`;
  const dark = declare(scheme.dark);

  if (!themeAttr) {
    return `${light}\n@media(prefers-color-scheme:dark){:root{${dark}}}`;
  }

  return [
    light,
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
  ].join('\n');
}
