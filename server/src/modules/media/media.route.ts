import express, { Router, type Request } from 'express';
import busboy from 'busboy';
import { asyncHandler } from '../../lib/async-handler';
import { AppError } from '../../lib/app-error';
import { requireAdmin } from '../../middleware/authenticate';
import { mediaStorage } from '../../lib/media/storage';
import { MAX_UPLOAD_BYTES, parseCrop, removeImage, storeImage } from './media.service';

/**
 * Mounted under /api/organizations/:organizationId/media, so authentication,
 * membership and the subscription gate have already run. Adding or removing a
 * photo is an owner/admin decision, like editing the activity it belongs to.
 */
export const mediaRouter = Router({ mergeParams: true });

/**
 * Reads exactly one file, plus the small text fields beside it (the crop
 * box), from a multipart body into memory.
 *
 * Not express.json: that is capped at 100 kb for every other route, and a
 * photo is megabytes. busboy streams, and stops counting at the limit, so a
 * 2 GB upload costs us 8 MB of memory, not 2 GB.
 */
function readOneFile(req: Request): Promise<{ file: Buffer; fields: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 5, fieldSize: 1024 },
      });
    } catch {
      reject(AppError.badRequest('Send the photo as a file upload (multipart/form-data).', 'MEDIA_FORM'));
      return;
    }

    let file: Buffer | null = null;
    let tooLarge = false;
    const fields: Record<string, string> = {};

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (_name, stream) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        tooLarge = true;
      });
      stream.on('end', () => {
        file = Buffer.concat(chunks);
      });
    });
    parser.on('error', () => reject(AppError.badRequest('That upload could not be read.', 'MEDIA_FORM')));
    parser.on('close', () => {
      if (tooLarge) {
        reject(new AppError('That photo is over 8 MB. Please send a smaller one.', 413, 'MEDIA_TOO_LARGE'));
      } else if (!file) {
        reject(AppError.badRequest('No photo was attached.', 'MEDIA_EMPTY'));
      } else {
        resolve({ file, fields });
      }
    });

    req.pipe(parser);
  });
}

mediaRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { file, fields } = await readOneFile(req);
    const crop = parseCrop(fields.crop);
    res.status(201).json({ image: await storeImage(req.tenant!.organizationId, file, undefined, crop) });
  }),
);

mediaRouter.delete(
  '/:imageId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const removed = await removeImage(req.tenant!.organizationId, req.params.imageId!);
    if (!removed) throw AppError.notFound('No such photo.');
    res.status(204).end();
  }),
);

/**
 * The files themselves, at /public/_media/org/<orgId>/<imageId>-<width>.webp.
 *
 * A file never changes once written — a replaced photo is a new id — so it can
 * be cached for a year. express.static refuses dot-files and anything that
 * would leave the root. CORP is `cross-origin` so a studio can use the image
 * address on its own site; the bytes are already public.
 */
export const mediaPublic = Router();

mediaPublic.use(
  express.static(mediaStorage.root, {
    index: false,
    dotfiles: 'deny',
    immutable: true,
    maxAge: '365d',
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

/* Anything static did not find is a plain 404, answered here: passing it on
   would hand it to the booking pages (whose /:slug would try `_media`), and
   static's own error would reach the error handler as an unknown 500. A
   removed photo's address must simply stop working. */
mediaPublic.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});
