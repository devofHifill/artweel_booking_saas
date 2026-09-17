import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';

/**
 * Choosing the studio's accent.
 *
 * The palette maths is covered as pure functions in tests/design/brand.test.ts.
 * What is tested here is the part a studio can actually reach: that the choice
 * saves, that it survives a reload, that the two storage columns never
 * contradict each other, and that a member who is not an admin cannot restyle
 * the whole studio.
 *
 * That last one is the reason this is a route test at all. Six policy columns in
 * this same table shipped with readers, tests and no writer — reachable from the
 * suite and from nowhere else. So the assertions below deliberately go through
 * HTTP end to end rather than calling the service.
 */

const app = createApp();
let studio: Studio;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  studio = await signUpStudio(app);
});

describe('reading the theme', () => {
  it('starts on indigo, and ships the menu of choices with it', async () => {
    /*
      Indigo since D0 (2026-08-24), not clay.

      This asserted clay until 2026-09-03 and had been failing since the
      default changed — `20260824190000_default_brand_indigo` set the column
      default to `indigo` and moved the existing clay rows across, and this
      test was not updated with it. The token below moved for the same reason:
      `--clay` is the NAME of the accent variable, not a claim about its
      colour, so on the indigo preset it holds `#4f46e5` — the TourFlow
      prototype's `--brand-600`, which is the whole point of the change.
    */
    const res = await request(app)
      .get(`${studio.base}/theme`)
      .set(studio.headers)
      .expect(200);

    expect(res.body.preset).toBe('indigo');
    // Still null: a default preset is not a custom accent, and an accent WINS
    // over the preset when one is set. Unchanged by D0.
    expect(res.body.accent).toBeNull();
    expect(res.body.tokens.light['--clay']).toBe('#4f46e5');

    // The picker is server-driven, so adding a preset is one edit, not two.
    expect(res.body.presets.length).toBeGreaterThan(1);
    /* Clay is still FIRST in the menu and still offered — the migration
       changed which preset is the default and nothing about how presets work,
       and a studio that wants clay is one click away. Asserting it here is
       what would catch it being dropped from the list rather than demoted. */
    expect(res.body.presets[0]).toMatchObject({ id: 'clay', name: 'Clay' });
    expect(res.body.presets.map((p: { id: string }) => p.id)).toContain('indigo');
    for (const preset of res.body.presets) {
      expect(preset.swatch).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('is readable by any member, not just admins', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .get(`${studio.base}/theme`)
      .set(instructor.headers)
      .expect(200);
  });
});

describe('choosing a preset', () => {
  it('saves, and is still there on the next read', async () => {
    const res = await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'indigo' })
      .expect(200);

    expect(res.body.preset).toBe('indigo');
    expect(res.body.tokens.light['--clay']).toBe('#4f46e5');
    expect(res.body.adjusted).toBe(false);

    const reload = await request(app)
      .get(`${studio.base}/theme`)
      .set(studio.headers)
      .expect(200);

    expect(reload.body.preset).toBe('indigo');
    expect(reload.body.tokens.light['--clay']).toBe('#4f46e5');
  });

  it('refuses a preset that does not exist', async () => {
    await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'chartreuse-deluxe' })
      .expect(400);
  });
});

describe('choosing a custom colour', () => {
  it('stores the request and returns the derived palette', async () => {
    const res = await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'custom', accent: '#2F6B4F' })
      .expect(200);

    expect(res.body.preset).toBe('custom');
    // Canonicalised to lower case, matching the CHECK constraint on the column.
    expect(res.body.accent).toBe('#2f6b4f');
    expect(res.body.tokens.light['--clay']).toBe('#2f6b4f');
    expect(res.body.adjusted).toBe(false);

    const stored = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { brandAccent: true },
    });
    expect(stored.brandAccent).toBe('#2f6b4f');
  });

  /**
   * The case the derivation exists for. White on this yellow is about 1.6:1, so
   * it cannot be used as a button ground as typed — and the owner has to be told
   * that, in words, rather than discovering it from an unreadable dashboard.
   */
  it('adjusts an unusable colour and says so', async () => {
    const res = await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'custom', accent: '#ffd400' })
      .expect(200);

    expect(res.body.adjusted).toBe(true);
    expect(res.body.notes.length).toBeGreaterThan(0);
    expect(res.body.tokens.light['--clay']).not.toBe('#ffd400');
  });

  it('needs a colour to go with it', async () => {
    const res = await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'custom' })
      .expect(400);

    expect(res.body.error?.code ?? res.body.code).toBe('ACCENT_REQUIRED');
  });

  /**
   * 422 rather than 400: this app answers schema violations from `validateBody`
   * with 422 and business-rule refusals from the service with 400. The missing
   * accent above is the second kind, this is the first.
   *
   * The last string is the one that matters. This value is interpolated into a
   * <style> block on the public booking page, so a closing brace reaching the
   * column would let a studio write arbitrary CSS onto its own public page. It
   * is refused three times over — here by zod, again by `deriveBrand`, and by a
   * CHECK constraint on the column for anything that arrives another way.
   */
  it('refuses anything that is not a six-digit hex', async () => {
    for (const accent of ['red', '#abc', '#12345', '#fff}body{display:none']) {
      await request(app)
        .patch(`${studio.base}/theme`)
        .set(studio.headers)
        .send({ preset: 'custom', accent })
        .expect(422);
    }
  });
});

/**
 * The accent WINS over the preset id when both are set, so the two columns must
 * never both be populated. If they were, the preset row would be a value that is
 * stored, rendered nowhere, and wrong — discovered much later by whoever reads
 * the column and believes it.
 */
describe('the two columns never contradict each other', () => {
  it('clears the preset trail when a custom colour is set, and back again', async () => {
    await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'plum' })
      .expect(200);

    await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'custom', accent: '#41505f' })
      .expect(200);

    const custom = await request(app)
      .get(`${studio.base}/theme`)
      .set(studio.headers)
      .expect(200);
    expect(custom.body.preset).toBe('custom');
    expect(custom.body.tokens.light['--clay']).toBe('#41505f');

    // Going back to a preset must drop the accent, or it would keep winning.
    await request(app)
      .patch(`${studio.base}/theme`)
      .set(studio.headers)
      .send({ preset: 'forest' })
      .expect(200);

    const back = await request(app)
      .get(`${studio.base}/theme`)
      .set(studio.headers)
      .expect(200);
    expect(back.body.preset).toBe('forest');
    expect(back.body.accent).toBeNull();

    const stored = await prisma.organization.findUniqueOrThrow({
      where: { id: studio.organizationId },
      select: { brandPreset: true, brandAccent: true },
    });
    expect(stored.brandAccent).toBeNull();
    expect(stored.brandPreset).toBe('forest');
  });
});

describe('who may restyle a studio', () => {
  it('refuses an instructor', async () => {
    const instructor = await addMemberToStudio(
      app,
      studio.organizationId,
      'INSTRUCTOR',
    );

    await request(app)
      .patch(`${studio.base}/theme`)
      .set(instructor.headers)
      .send({ preset: 'indigo' })
      .expect(403);
  });

  it('refuses front desk', async () => {
    const frontDesk = await addMemberToStudio(
      app,
      studio.organizationId,
      'FRONT_DESK',
    );

    await request(app)
      .patch(`${studio.base}/theme`)
      .set(frontDesk.headers)
      .send({ preset: 'indigo' })
      .expect(403);
  });

  /** A non-member gets 404, not 403 — the studio's existence is not confirmed. */
  it('hides another studio entirely', async () => {
    const stranger = await signUpStudio(app);

    await request(app)
      .patch(`${studio.base}/theme`)
      .set(stranger.headers)
      .send({ preset: 'indigo' })
      .expect(404);

    await request(app)
      .get(`${studio.base}/theme`)
      .set(stranger.headers)
      .expect(404);
  });
});
