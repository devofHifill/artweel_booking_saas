import { randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import { mediaStorage, type MediaStorage } from '../../lib/media/storage';

/**
 * Image uploads (FB-11, phase 1). See docs/PHOTO-UPLOADS-PLAN.md.
 *
 * Every upload is decoded and re-encoded, never stored as sent: that is what
 * proves it is an image (by its bytes, not its name), puts it the right way
 * up, and drops EXIF — phone photos carry the GPS position they were taken
 * at, which a studio should never publish by accident.
 */

/** Largest file accepted, before resizing. A phone photo is 2–6 MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Per studio, so one account cannot fill the shared disk. */
export const MAX_IMAGES_PER_STUDIO = 200;

/** Stored widths: a card and a hero. Never enlarged. */
export const WIDTHS = [400, 1200] as const;

const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

export type StoredImage = {
  id: string;
  /** What the database will hold, e.g. `org/<orgId>/<imageId>`. */
  key: string;
  width: number;
  height: number;
  urls: { small: string; large: string };
};

export function keyFor(organizationId: string, imageId: string) {
  return `org/${organizationId}/${imageId}`;
}

/** The image id from a key, or null when the key is not this studio's. */
export function imageIdFromKey(organizationId: string, key: string): string | null {
  const match = /^org\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(key);
  if (!match || match[1] !== organizationId) return null;
  return match[2]!;
}

export function urlsFor(
  organizationId: string,
  imageId: string,
  storage: MediaStorage = mediaStorage,
) {
  return {
    small: storage.urlFor(organizationId, `${imageId}-${WIDTHS[0]}.webp`),
    large: storage.urlFor(organizationId, `${imageId}-${WIDTHS[1]}.webp`),
  };
}

async function imagesIn(organizationId: string, storage: MediaStorage) {
  const names = await storage.list(organizationId);
  return new Set(names.map((n) => n.slice(0, 36))).size;
}

export async function storeImage(
  organizationId: string,
  data: Buffer,
  storage: MediaStorage = mediaStorage,
): Promise<StoredImage> {
  if (data.length === 0) throw AppError.badRequest('That file is empty.', 'MEDIA_EMPTY');
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new AppError('That photo is over 8 MB. Please send a smaller one.', 413, 'MEDIA_TOO_LARGE');
  }

  let meta: Metadata;
  try {
    meta = await sharp(data, { failOn: 'error' }).metadata();
  } catch {
    throw AppError.badRequest(
      'That file is not a photo we can read. Please send a JPEG, PNG or WebP.',
      'MEDIA_UNREADABLE',
    );
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw AppError.badRequest(
      'Please send a JPEG, PNG or WebP photo.',
      'MEDIA_TYPE',
    );
  }

  if ((await imagesIn(organizationId, storage)) >= MAX_IMAGES_PER_STUDIO) {
    throw AppError.conflict(
      `This studio already has ${MAX_IMAGES_PER_STUDIO} photos. Remove some before adding more.`,
      'MEDIA_LIMIT',
    );
  }

  const id = randomUUID();
  let width = 0;
  let height = 0;

  for (const target of WIDTHS) {
    // rotate() with no angle applies the EXIF orientation; sharp drops all
    // metadata on output unless asked to keep it, which is the point.
    const { data: out, info } = await sharp(data, { failOn: 'error' })
      .rotate()
      .resize({ width: target, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    await storage.put(organizationId, `${id}-${target}.webp`, out);
    if (target === WIDTHS[WIDTHS.length - 1]) {
      width = info.width;
      height = info.height;
    }
  }

  return { id, key: keyFor(organizationId, id), width, height, urls: urlsFor(organizationId, id, storage) };
}

export async function removeImage(
  organizationId: string,
  imageId: string,
  storage: MediaStorage = mediaStorage,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(imageId)) throw AppError.badRequest('Invalid image id.');
  return (await storage.removePrefix(organizationId, imageId)) > 0;
}

/** Whether this studio really has this image — checked before a key is saved
    on an activity or a staff member, so nobody can point at another studio's. */
export async function hasImage(
  organizationId: string,
  imageId: string,
  storage: MediaStorage = mediaStorage,
): Promise<boolean> {
  const names = await storage.list(organizationId);
  return names.includes(`${imageId}-${WIDTHS[0]}.webp`);
}

/**
 * Checks a key before it is saved on an activity or a staff member (phase 2).
 *
 * The key must be in THIS studio's folder and its files must exist, so a
 * studio can neither point at another studio's photo nor save a key for an
 * upload that failed.
 */
export async function assertOwnImage(
  organizationId: string,
  key: string,
  storage: MediaStorage = mediaStorage,
): Promise<void> {
  const imageId = imageIdFromKey(organizationId, key);
  if (!imageId || !(await hasImage(organizationId, imageId, storage))) {
    throw AppError.badRequest('That photo was not found. Please upload it again.', 'MEDIA_NOT_FOUND');
  }
}

/** A photo needs a description for people who cannot see it. */
export function assertAltText(key: unknown, alt: unknown): void {
  if (key && !(typeof alt === 'string' && alt.trim())) {
    throw AppError.badRequest(
      'Add a short description of the photo, for people who cannot see it.',
      'MEDIA_ALT_REQUIRED',
    );
  }
}

/**
 * Deletes a photo's files once nothing uses it any more — after an activity
 * or staff member stops pointing at it. Checked against both tables, so a
 * photo shared by two rows survives until the last one lets go.
 */
export async function releaseImageIfUnused(
  organizationId: string,
  key: string | null | undefined,
  storage: MediaStorage = mediaStorage,
): Promise<void> {
  if (!key) return;
  const imageId = imageIdFromKey(organizationId, key);
  if (!imageId) return;
  const [services, staff] = await Promise.all([
    prisma.serviceType.count({ where: { organizationId, imageKey: key } }),
    prisma.staff.count({ where: { organizationId, photoKey: key } }),
  ]);
  if (services + staff === 0) await storage.removePrefix(organizationId, imageId);
}

/** The addresses for a stored key, or null. Used wherever a photo is shown. */
export function imageUrls(
  key: string | null | undefined,
  storage: MediaStorage = mediaStorage,
): { small: string; large: string } | null {
  const match = key ? /^org\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(key) : null;
  return match ? urlsFor(match[1]!, match[2]!, storage) : null;
}
