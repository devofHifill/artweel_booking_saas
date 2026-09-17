import { api } from './api';

/**
 * The studio's accent, applied to the dashboard.
 *
 * The palette itself is decided on the server (`server/src/lib/brand.ts`), which
 * owns the presets and enforces WCAG AA on a custom colour. This file does one
 * job: get the resolved values onto the page without a flash, and keep them
 * correct when the user switches studio.
 *
 * ---
 *
 * Why a <style> element rather than inline custom properties.
 *
 * The obvious implementation is `documentElement.style.setProperty('--clay', …)`.
 * It is wrong here, and silently so: an inline property has no colour scheme. It
 * would override the accent in BOTH light and dark, so a studio on a dark theme
 * would get the light-mode accent text — the exact value that
 * `design-tokens.ts` documents as failing AA on a dark ground.
 *
 * A stylesheet can carry the same media queries and `[data-theme]` selectors the
 * rest of the product uses, so the theme toggle keeps working. The block is
 * appended to <head>, after styles.css, and matches its selectors exactly — same
 * specificity, later in source order, so it wins in both directions.
 */

export type BrandTokens = {
  '--clay': string;
  '--clay-dk': string;
  '--clay-lt': string;
  '--clay-text': string;
};

export type BrandScheme = { light: BrandTokens; dark: BrandTokens };

export type ThemeResponse = {
  preset: string;
  accent: string | null;
  tokens: BrandScheme;
  presets: { id: string; name: string; swatch: string; swatchDark: string }[];
};

const STYLE_ID = 'brand-override';
const CACHE_KEY = 'bsaas.brand';
const ACTIVE_ORG_KEY = 'bsaas.activeOrg';

/** Only these four may be written. Mirrors BRANDABLE on the server. */
const BRANDABLE: (keyof BrandTokens)[] = [
  '--clay',
  '--clay-dk',
  '--clay-lt',
  '--clay-text',
];

function declare(tokens: BrandTokens): string {
  /*
    Filtered rather than iterated, so a response that grew an extra field —
    a future --clay-border, or something an attacker managed to get into the
    column — cannot introduce a declaration this file never intended to write.
    The server asserts the same property in tests/design/brand.test.ts; agreeing
    on both ends costs one filter.
  */
  return BRANDABLE.filter((name) => typeof tokens?.[name] === 'string')
    .map((name) => `${name}:${tokens[name]}`)
    .join(';');
}

/**
 * Writes the override block, creating it on first call.
 *
 * The element is reused rather than replaced: swapping studios should repaint,
 * not accumulate a stylesheet per studio visited this session.
 */
export function applyBrand(scheme: BrandScheme | null | undefined) {
  const existing = document.getElementById(STYLE_ID);

  if (!scheme?.light || !scheme?.dark) {
    existing?.remove();
    return;
  }

  const style = existing ?? document.createElement('style');
  if (!existing) {
    style.id = STYLE_ID;
    document.head.append(style);
  }

  const dark = declare(scheme.dark);

  /*
    Three rules, mirroring the guarded selectors in styles.css:

      :root                                  the light palette, always
      @media dark + :not([data-theme=light]) system dark, unless pinned light
      :root[data-theme="dark"]               pinned dark, whatever the OS says

    Dropping the :not() guard would drag a user who chose light mode into dark
    accent tokens the moment their OS went dark — half the palette switching and
    half not, which reads as a rendering bug rather than a setting.
  */
  style.textContent = [
    `:root{${declare(scheme.light)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
  ].join('\n');
}

// --- caching --------------------------------------------------------------

/*
  Cached per studio id, not as a single value.

  An instructor who works at two studios switches between them, and a cache
  keyed on nothing would paint the wrong studio's colour for the length of one
  fetch on every switch — briefly showing them a studio they may not even be
  looking at.
*/
type Cache = Record<string, BrandScheme>;

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    /* Corrupt or unparseable cache is not worth a broken dashboard. */
    return {};
  }
}

function writeCache(organizationId: string, scheme: BrandScheme) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...readCache(), [organizationId]: scheme }),
    );
  } catch {
    /* Private mode, or a full quota. The theme still works this session. */
  }
}

/**
 * Runs before React mounts, from main.tsx.
 *
 * Without it the dashboard paints in clay and repaints in the studio's colour
 * once the first API call returns — a visible flash on every single page load,
 * and worst for exactly the studios that bothered to set a theme.
 *
 * Reads the LAST KNOWN value rather than waiting for the server, on the same
 * reasoning as `applyStoredThemeEarly` in theme.ts: a stale accent for one
 * fetch is invisible, and a flash is not.
 */
export function applyCachedBrandEarly() {
  const organizationId = localStorage.getItem(ACTIVE_ORG_KEY);
  if (!organizationId) return;

  const cached = readCache()[organizationId];
  if (cached) applyBrand(cached);
}

/**
 * Fetches the studio's theme, applies it, and remembers it for next time.
 *
 * Failure is deliberately silent. A studio whose theme endpoint is unreachable
 * should see the default palette and a working dashboard, not an error — this
 * is the only thing in the app where the correct response to a failed request
 * is to render something slightly less pretty and say nothing.
 */
export async function loadBrand(organizationId: string): Promise<void> {
  try {
    const res = await api.get<ThemeResponse>(
      `/api/organizations/${organizationId}/theme`,
    );
    applyBrand(res.tokens);
    writeCache(organizationId, res.tokens);
  } catch {
    /* Keep whatever is already painted — cached, or the default. */
  }
}

/** Called after a successful save, so the change is visible without a reload. */
export function setBrand(organizationId: string, scheme: BrandScheme) {
  applyBrand(scheme);
  writeCache(organizationId, scheme);
}

/**
 * Signing out drops the override.
 *
 * The login screen belongs to Artweel, not to the studio someone last used, and
 * a shared machine should not tell the next person what the previous one's
 * studio colour was.
 */
export function clearBrand() {
  applyBrand(null);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Nothing to do; the override element is already gone. */
  }
}
