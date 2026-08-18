import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  DARK_SCALE_TOKENS,
  SCALE_TOKENS,
  tokensCss,
} from '../../src/lib/design-tokens';
import { renderMarketingPage } from '../../src/modules/marketing/render';
import { ALL_PAGES } from '../../src/modules/marketing/content';

/**
 * The four surfaces must look like one product.
 *
 * This is not a style-guide nicety. Before `design-tokens.ts` each surface
 * declared its own `:root` and they had drifted — three `--bg` values, three
 * `--line` values, and a corner-radius token with a different NAME and value on
 * each. No single difference is noticeable; the effect is that the product
 * shifts underneath somebody walking from the marketing site to signup to the
 * dashboard, with nothing visible to point at.
 *
 * Drift like that reappears the moment one surface is edited in isolation, and
 * it never announces itself. So it is asserted rather than agreed.
 */

const CLIENT_STYLESHEET = path.resolve(
  __dirname,
  '../../../client/src/styles.css',
);

/** Pulls `--name: value` pairs out of a CSS block. */
function parseTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};

  /*
    Comments are stripped first.

    Prose about tokens naturally contains token names — a comment reading
    "measured against --card: 1.93:1" parses as a declaration of --card and,
    being later in the file, wins. That is exactly what happened: this test
    failed reporting that --card was a sentence. The comment was correct and
    the parser was wrong.
  */
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    const name = match[1];
    const value = match[2];
    if (!name || value === undefined) continue;
    out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

/** The client's light-mode `:root`, i.e. up to the first dark-mode block. */
function clientLightTokens(): Record<string, string> {
  const css = readFileSync(CLIENT_STYLESHEET, 'utf8');
  const start = css.indexOf(':root {');
  const end = css.indexOf('@media (prefers-color-scheme: dark)');
  expect(start, 'client stylesheet has no :root block').toBeGreaterThanOrEqual(0);
  expect(end, 'client stylesheet has no dark-mode block').toBeGreaterThan(start);
  return parseTokens(css.slice(start, end));
}

function clientDarkTokens(): Record<string, string> {
  const css = readFileSync(CLIENT_STYLESHEET, 'utf8');
  const start = css.indexOf('@media (prefers-color-scheme: dark)');
  const end = css.indexOf('@media (prefers-reduced-motion');
  return parseTokens(css.slice(start, end > start ? end : undefined));
}

describe('the client mirrors the shared tokens', () => {
  it('agrees on every light-mode colour', () => {
    const client = clientLightTokens();
    for (const [name, value] of Object.entries(COLOR_TOKENS.light)) {
      expect(client[name], `${name} differs between client and server`).toBe(value);
    }
  });

  it('agrees on every dark-mode override', () => {
    const client = clientDarkTokens();
    for (const [name, value] of Object.entries(COLOR_TOKENS.dark)) {
      expect(client[name], `dark ${name} differs`).toBe(value);
    }
  });

  it('agrees on the type, spacing, radius, elevation and motion scales', () => {
    const client = clientLightTokens();
    for (const [name, value] of Object.entries(SCALE_TOKENS)) {
      expect(client[name], `${name} differs between client and server`).toBe(value);
    }
  });

  it('agrees on the dark elevation overrides', () => {
    const client = clientDarkTokens();
    for (const [name, value] of Object.entries(DARK_SCALE_TOKENS)) {
      expect(client[name], `dark ${name} differs`).toBe(value);
    }
  });
});

describe('the server-rendered surfaces use the shared tokens', () => {
  /**
   * Asserted against rendered HTML rather than source, so inlining the block by
   * hand somewhere would still fail.
   */
  it('ships the tokens in the marketing page', () => {
    const html = renderMarketingPage(ALL_PAGES[0]!);

    /*
      Only the light :root block. Parsing the whole document would also pick up
      the dark-mode overrides, and since they come later they would win — the
      test would then compare dark values against light ones and fail for a
      reason that has nothing to do with drift.
    */
    const lightBlock = html.slice(
      html.indexOf(':root{'),
      html.indexOf('@media(prefers-color-scheme:dark)'),
    );
    const shipped = parseTokens(lightBlock);

    for (const [name, value] of Object.entries(COLOR_TOKENS.light)) {
      expect(shipped[name], `marketing is missing or overriding ${name}`).toBe(value);
    }
    expect(shipped['--radius']).toBe(SCALE_TOKENS['--radius']);
  });

  /**
   * The old block declared `--r:12px` on the marketing site while the other
   * surfaces used `--radius`. A token that exists under two names on two
   * surfaces is drift that no amount of care catches by eye.
   */
  it('no longer declares the abandoned --r radius token', () => {
    expect(renderMarketingPage(ALL_PAGES[0]!)).not.toContain('--r:');
  });
});

describe('the token block itself', () => {
  it('emits both colour schemes and a reduced-motion rule', () => {
    const css = tokensCss();
    expect(css).toContain(':root{');
    expect(css).toContain('prefers-color-scheme:dark');
    expect(css).toContain('prefers-reduced-motion:reduce');
  });

  /**
   * A type scale exists to be small. Nineteen sizes were in use before, three of
   * them within .02rem of each other; if this ever grows past a handful again,
   * the scale has stopped being a scale.
   */
  it('keeps the type scale to seven steps', () => {
    const steps = Object.keys(SCALE_TOKENS).filter((k) => k.startsWith('--text-'));
    expect(steps.length).toBeLessThanOrEqual(7);
  });
});
