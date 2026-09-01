import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKABLE,
  SCALE_TOKENS,
  THEME_PACKS,
  packCss,
  tokensCss,
  type PackId,
} from '../../src/lib/design-tokens';

/**
 * Theme packs — how the PRODUCT looks, chosen once for everybody.
 *
 * The sibling file guards the studio-facing boundary: a studio may move its
 * accent and nothing else, because a theme that reaches `--ink` or `--card` is
 * a theme that can make a dashboard unreadable. Packs sit one level up and are
 * not a studio setting, but they need their own boundary for a different
 * reason: a pack that could reach a colour would put every contrast guarantee
 * in this product back on trust rather than on a test.
 *
 * So the assertions below are about what a pack CANNOT do.
 */

const PACK_IDS = Object.keys(THEME_PACKS) as PackId[];

describe('what a pack may touch', () => {
  it('declares nothing outside PACKABLE', () => {
    for (const id of PACK_IDS) {
      for (const token of Object.keys(THEME_PACKS[id])) {
        expect(PACKABLE).toContain(token);
      }
    }
  });

  /**
   * The load-bearing one.
   *
   * Not "no colour tokens are listed in PACKABLE" — that is the same statement
   * twice. This checks the VALUES: nothing a pack emits may look like a colour,
   * so a hex smuggled in as a radius fails here rather than in production.
   */
  it('emits no colour, in any pack', () => {
    for (const id of PACK_IDS) {
      const css = packCss(id);
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\b(rgba?|hsla?|color-mix|oklch)\s*\(/i);
    }
  });

  it('only ever overrides a token the base scale already defines', () => {
    for (const id of PACK_IDS) {
      for (const token of Object.keys(THEME_PACKS[id])) {
        expect(SCALE_TOKENS).toHaveProperty(token);
      }
    }
  });
});

describe('the default pack', () => {
  /**
   * `artweel` is the shipped look, so it must be an ABSENCE rather than a
   * restatement of the base values. A pack that re-declared them would drift
   * from `SCALE_TOKENS` the first time one changed, and the product would have
   * two answers for its own radius.
   */
  it('emits nothing at all', () => {
    expect(packCss('artweel')).toBe('');
  });

  it('leaves the token block byte-identical to the unpacked one', () => {
    expect(tokensCss('artweel')).toBe(tokensCss());
  });
});

describe('the client mirrors the packs', () => {
  /**
   * Same reasoning as `tokens.test.ts`: the client is a separate bundle and
   * cannot import this file, so it keeps a copy in its stylesheet. A copy with
   * nothing checking it is a copy that drifts — and a pack that drifted would
   * be the product having two shapes depending on which surface you were
   * looking at, which is the exact failure the token file was written to end.
   */
  const css = readFileSync(
    resolve(__dirname, '../../../client/src/styles.css'),
    'utf8',
  );

  for (const id of PACK_IDS) {
    const overrides = THEME_PACKS[id];
    if (Object.keys(overrides).length === 0) continue;

    it(`declares ${id} with the same values`, () => {
      const block = new RegExp(
        `:root\\[data-pack=['"]${id}['"]\\]\\s*\\{([^}]*)\\}`,
      ).exec(css);

      expect(block, `no [data-pack="${id}"] block in styles.css`).not.toBeNull();

      for (const [token, value] of Object.entries(overrides)) {
        expect(block![1]).toMatch(
          new RegExp(`${token}\\s*:\\s*${value.replace('.', '\\.')}\\s*;`),
        );
      }
    });

    it(`declares nothing extra in ${id}`, () => {
      const block = new RegExp(
        `:root\\[data-pack=['"]${id}['"]\\]\\s*\\{([^}]*)\\}`,
      ).exec(css)!;

      const declared = [...block[1]!.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(
        (m) => m[1]!,
      );

      expect(new Set(declared)).toEqual(new Set(Object.keys(overrides)));
    });
  }
});

describe('a non-default pack', () => {
  it('lands after the base block, so it wins', () => {
    const css = tokensCss('crisp');
    const base = css.indexOf('--radius-md:14px');
    const override = css.indexOf('--radius-md:10px');

    expect(base).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(base);
  });

  /**
   * Dark mode re-declares the shadows because a shadow that reads on white
   * disappears on a dark ground. A pack must not sit between that and the
   * reader — which is also why shadows are not packable at all.
   */
  it('does not come between dark mode and its shadows', () => {
    const css = tokensCss('crisp');
    const pack = css.indexOf('--radius-md:10px');
    const dark = css.indexOf('prefers-color-scheme:dark');

    expect(dark).toBeGreaterThan(pack);
  });
});
