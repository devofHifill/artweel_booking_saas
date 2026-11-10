import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { addMemberToStudio, signUpStudio, type Studio } from '../helpers/api';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { mediaStorage } from '../../src/lib/media/storage';

/**
 * FB-11 phase 1 — uploading photos (docs/PHOTO-UPLOADS-PLAN.md).
 *
 * Over HTTP, against the real disk storage (pointed at a temp folder by
 * tests/setup.ts), because what matters is what actually lands on disk and
 * what a browser gets back — not what a mocked store was asked to do.
 */

const app = createApp();
let studio: Studio;

/** A real JPEG, with EXIF that includes a GPS position. */
async function phonePhoto(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 166, g: 82, b: 44 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'Kiln 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 41/1 0/1' },
    })
    .toBuffer();
}

function upload(who: Studio, data: Buffer, filename = 'photo.jpg') {
  return request(app)
    .post(`${who.base}/media`)
    .set(who.headers)
    .attach('file', data, filename);
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  studio = await signUpStudio(app);
});

describe('uploading a photo', () => {
  it('stores two WebP sizes and returns their addresses', async () => {
    const res = await upload(studio, await phonePhoto());

    expect(res.status).toBe(201);
    const image = res.body.image;
    expect(image.key).toBe(`org/${studio.organizationId}/${image.id}`);
    expect(image.width).toBe(1200);
    expect(image.urls.small).toMatch(/-400\.webp$/);
    expect(image.urls.large).toMatch(/-1200\.webp$/);

    const names = await mediaStorage.list(studio.organizationId);
    expect(names.sort()).toEqual([`${image.id}-1200.webp`, `${image.id}-400.webp`]);
  });

  it('serves the files publicly, cached for a year', async () => {
    const { body } = await upload(studio, await phonePhoto());

    const res = await request(app).get(body.image.urls.small);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/webp/);
    expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(res.headers['cache-control']).toMatch(/immutable/);
    expect((await sharp(res.body).metadata()).width).toBe(400);
  });

  it('strips EXIF, so a phone photo never publishes where it was taken', async () => {
    const { body } = await upload(studio, await phonePhoto());
    const res = await request(app).get(body.image.urls.large);

    const meta = await sharp(res.body).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('never enlarges a small photo', async () => {
    const { body } = await upload(studio, await phonePhoto(300, 200));
    expect(body.image.width).toBe(300);
  });

  it('accepts PNG and WebP too', async () => {
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: '#fff' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#000' } }).webp().toBuffer();
    expect((await upload(studio, png, 'a.png')).status).toBe(201);
    expect((await upload(studio, webp, 'b.webp')).status).toBe(201);
  });
});

describe('refusing what is not a photo', () => {
  it('judges the bytes, not the file name', async () => {
    const res = await upload(studio, Buffer.from('<?php echo "hi"; ?>'), 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_UNREADABLE');
    expect(await mediaStorage.list(studio.organizationId)).toEqual([]);
  });

  it('refuses an image type it does not take (GIF)', async () => {
    const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#f00' } }).gif().toBuffer();
    const res = await upload(studio, gif, 'a.gif');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_TYPE');
  });

  it('refuses a file over 8 MB', async () => {
    const res = await upload(studio, Buffer.alloc(8 * 1024 * 1024 + 1, 1), 'huge.jpg');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
  });

  it('refuses a request with no file in it', async () => {
    const res = await request(app)
      .post(`${studio.base}/media`)
      .set(studio.headers)
      .field('note', 'no file here');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_EMPTY');
  });
});

describe('who may upload', () => {
  it('lets an admin, not an instructor', async () => {
    const admin = await addMemberToStudio(app, studio.organizationId, 'ADMIN');
    const instructor = await addMemberToStudio(app, studio.organizationId, 'INSTRUCTOR');
    const photo = await phonePhoto();

    expect((await upload(admin, photo)).status).toBe(201);
    expect((await upload(instructor, photo)).status).toBe(403);
  });

  it('needs a signed-in user', async () => {
    const res = await request(app)
      .post(`${studio.base}/media`)
      .attach('file', await phonePhoto(), 'photo.jpg');
    expect(res.status).toBe(401);
  });

  it('keeps each studio in its own folder', async () => {
    const other = await signUpStudio(app);
    const { body } = await upload(other, await phonePhoto());

    // Another studio cannot remove it…
    const res = await request(app)
      .delete(`${studio.base}/media/${body.image.id}`)
      .set(studio.headers);
    expect(res.status).toBe(404);
    // …and it is still there.
    expect(await mediaStorage.list(other.organizationId)).toHaveLength(2);
  });
});

describe('removing a photo', () => {
  it('deletes both sizes, and the address stops working', async () => {
    const { body } = await upload(studio, await phonePhoto());

    const del = await request(app)
      .delete(`${studio.base}/media/${body.image.id}`)
      .set(studio.headers);
    expect(del.status).toBe(204);
    expect(await mediaStorage.list(studio.organizationId)).toEqual([]);
    expect((await request(app).get(body.image.urls.small)).status).toBe(404);
  });
});

describe('serving files safely', () => {
  it('will not walk out of the media folder', async () => {
    const res = await request(app).get('/public/_media/../../package.json');
    expect(res.status).not.toBe(200);
  });

  it('does not let the booking pages claim the path', async () => {
    const res = await request(app).get('/public/_media/org/missing/none.webp');
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/<html/i);
  });
});

/* --- Phase 2–4: attaching a photo to an activity or a staff member -------- */

function activity(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Family Wheel Afternoon',
    bookingMode: 'EVENT',
    durationMinutes: 120,
    capacityMax: 8,
    priceCents: 9500,
    emoji: '🏺',
    color: '#4f46e5',
    isActive: true,
    ...overrides,
  };
}

async function uploaded(who: Studio = studio) {
  const res = await upload(who, await phonePhoto());
  expect(res.status).toBe(201);
  return res.body.image as { id: string; key: string; urls: { small: string; large: string } };
}

async function slugOf(who: Studio) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: who.organizationId },
    select: { slug: true },
  });
  return org.slug;
}

describe('a photo on an activity', () => {
  it('saves this studio’s photo with its description', async () => {
    const image = await uploaded();
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ imageKey: image.key, imageAlt: 'Two people at the wheel' }));

    expect(res.status).toBe(201);
    expect(res.body.service.imageKey).toBe(image.key);
    expect(res.body.service.imageAlt).toBe('Two people at the wheel');
  });

  it('refuses a photo with no description', async () => {
    const image = await uploaded();
    const res = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ imageKey: image.key, imageAlt: '  ' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALT_REQUIRED');
  });

  it('refuses another studio’s photo, and a made-up key', async () => {
    const other = await signUpStudio(app);
    const theirs = await uploaded(other);

    for (const imageKey of [theirs.key, `org/${studio.organizationId}/00000000-0000-4000-8000-000000000000`]) {
      const res = await request(app)
        .post(`${studio.base}/services`)
        .set(studio.headers)
        .send(activity({ imageKey, imageAlt: 'A photo' }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
    }
  });

  it('deletes the old files when the photo is replaced, and when it is removed', async () => {
    const first = await uploaded();
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ imageKey: first.key, imageAlt: 'First' }));
    const id = created.body.service.id;

    const second = await uploaded();
    const replaced = await request(app)
      .patch(`${studio.base}/services/${id}`)
      .set(studio.headers)
      .send({ imageKey: second.key, imageAlt: 'Second' });
    expect(replaced.status).toBe(200);

    let names = await mediaStorage.list(studio.organizationId);
    expect(names.some((n) => n.startsWith(first.id))).toBe(false);
    expect(names.some((n) => n.startsWith(second.id))).toBe(true);

    const removed = await request(app)
      .patch(`${studio.base}/services/${id}`)
      .set(studio.headers)
      .send({ imageKey: null, imageAlt: null });
    expect(removed.status).toBe(200);
    names = await mediaStorage.list(studio.organizationId);
    expect(names).toEqual([]);
  });

  it('keeps the photo through an edit that does not mention it', async () => {
    const image = await uploaded();
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ imageKey: image.key, imageAlt: 'Kept' }));

    const res = await request(app)
      .patch(`${studio.base}/services/${created.body.service.id}`)
      .set(studio.headers)
      .send({ priceCents: 9900 });
    expect(res.status).toBe(200);
    expect(res.body.service.imageKey).toBe(image.key);
  });

  it('shows on the activity page in place of the icon, with its description', async () => {
    const image = await uploaded();
    const created = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity({ imageKey: image.key, imageAlt: 'Two people at the wheel' }));

    const page = await request(app).get(
      `/public/${await slugOf(studio)}/a/${created.body.service.slug}`,
    );
    expect(page.status).toBe(200);
    expect(page.text).toContain(`src="${image.urls.small}"`);
    expect(page.text).toContain(`${image.urls.large} 1200w`);
    expect(page.text).toContain('alt="Two people at the wheel"');
  });
});

describe('a portrait on a staff member', () => {
  it('saves it, requires a description, and the booking page gets it', async () => {
    const image = await uploaded();

    const missing = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test', photoKey: image.key });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MEDIA_ALT_REQUIRED');

    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test', photoKey: image.key, photoAlt: 'Rowan at the wheel' });
    expect(staff.status).toBe(201);

    const service = await request(app)
      .post(`${studio.base}/services`)
      .set(studio.headers)
      .send(activity());
    await request(app)
      .put(`${studio.base}/services/${service.body.service.id}/staff`)
      .set(studio.headers)
      .send({ staffIds: [staff.body.staff.id] });

    const res = await request(app).get(
      `/public/${await slugOf(studio)}/services/${service.body.service.id}/staff`,
    );
    expect(res.body.staff[0].photoKey).toBe(image.key);
    expect(res.body.staff[0].photoAlt).toBe('Rowan at the wheel');
    expect(res.body.staff[0].email).toBeUndefined();
  });

  it('deletes the old portrait when it is removed', async () => {
    const image = await uploaded();
    const staff = await request(app)
      .post(`${studio.base}/staff`)
      .set(studio.headers)
      .send({ name: 'Rowan Pike', email: 'rowan@clay.test', photoKey: image.key, photoAlt: 'Rowan' });

    const res = await request(app)
      .patch(`${studio.base}/staff/${staff.body.staff.id}`)
      .set(studio.headers)
      .send({ photoKey: null, photoAlt: null });
    expect(res.status).toBe(200);
    expect(await mediaStorage.list(studio.organizationId)).toEqual([]);
  });
});
