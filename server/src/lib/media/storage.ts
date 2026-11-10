import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded images live (FB-11, docs/PHOTO-UPLOADS-PLAN.md).
 *
 * Disk for now: a Docker volume on the VPS, one per box, so staging and live
 * can never see each other's files. Everything goes through this interface so
 * moving to an object store (R2/S3) later is a new implementation plus a
 * one-off copy — no caller knows where the bytes are.
 *
 * Layout: `<root>/org/<organizationId>/<imageId>-<width>.webp`. The org
 * folder is the tenant boundary: a key is only ever accepted for the studio
 * whose folder it is in.
 */
export interface MediaStorage {
  /** Writes one file. `name` is a bare file name, never a path. */
  put(organizationId: string, name: string, data: Buffer): Promise<void>;
  /** Removes every file whose name starts with `prefix` in that studio. */
  removePrefix(organizationId: string, prefix: string): Promise<number>;
  /** Names of every file in that studio's folder. */
  list(organizationId: string): Promise<string[]>;
  /** The public URL path for a file, e.g. `/public/_media/org/<id>/<name>`. */
  urlFor(organizationId: string, name: string): string;
  /** The folder express.static serves `/public/_media` from. */
  readonly root: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9a-f-]{36}(-\d{2,4})?\.webp$/;

/** Every path built here goes through these, so nothing user-supplied can
    walk out of the media root. */
function orgDir(root: string, organizationId: string): string {
  if (!UUID.test(organizationId)) throw new Error('Invalid organization id for media.');
  return path.join(root, 'org', organizationId);
}

function safeName(name: string): string {
  if (!FILE.test(name)) throw new Error('Invalid media file name.');
  return name;
}

export function diskStorage(root: string): MediaStorage {
  return {
    root,

    async put(organizationId, name, data) {
      const dir = orgDir(root, organizationId);
      await fs.mkdir(dir, { recursive: true });
      // Write then rename, so a reader never sees half a file.
      const final = path.join(dir, safeName(name));
      const temp = `${final}.${process.pid}.tmp`;
      await fs.writeFile(temp, data);
      await fs.rename(temp, final);
    },

    async removePrefix(organizationId, prefix) {
      const dir = orgDir(root, organizationId);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return 0;
      }
      const doomed = names.filter((n) => n.startsWith(prefix) && FILE.test(n));
      await Promise.all(doomed.map((n) => fs.rm(path.join(dir, n), { force: true })));
      return doomed.length;
    },

    async list(organizationId) {
      try {
        return (await fs.readdir(orgDir(root, organizationId))).filter((n) => FILE.test(n));
      } catch {
        return [];
      }
    },

    urlFor(organizationId, name) {
      orgDir(root, organizationId);
      return `/public/_media/org/${organizationId}/${safeName(name)}`;
    },
  };
}

/**
 * The app's storage. `MEDIA_DIR` is set in production to the mounted volume;
 * locally it defaults to `server/media`, which is gitignored.
 */
export const mediaStorage: MediaStorage = diskStorage(
  path.resolve(process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media')),
);
