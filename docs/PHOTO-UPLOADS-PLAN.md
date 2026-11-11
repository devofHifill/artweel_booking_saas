# Photo uploads — activity photos and staff portraits (FB-11)

Client asked for: activity photos and staff portraits, with upload, crop,
replace / remove, alt text and a mobile preview.

## Where things stand (checked on live, 2026-11-10)

- **Activities** have no image field. The editor's *Presentation* section
  offers an Icon (12 emoji) and a Colour; cards show a gradient with the emoji.
- **Staff** have a `photoUrl` column. `staff.route.ts` accepts a URL for it
  and `public.service.ts` reads it for the booking page — but no screen sets
  it and no page shows it. Staff appear as initials.
- **No upload code or file storage** exists anywhere.
- Useful already in place:
  - Traefik sends `/public/*` and `/api/*` to the API on both hostnames, so
    the API can serve images itself with no new route or container.
  - helmet's CSP already has `img-src 'self' data: https:` — both storage
    options below work without touching it.
  - The API image is `node:22-alpine`; `sharp` ships prebuilt musl binaries.
  - `express.json` is capped at 100 kb, so uploads need their own multipart
    route with its own limit (not a JSON body).

## The one decision: where the files live

| | **A. Disk on the VPS** (recommended to start) | **B. Object store (Cloudflare R2 / S3)** |
|---|---|---|
| Setup | A Docker volume mounted into the API; nothing new to sign up for | An account, a bucket, keys in each box's `.env`, a public URL or CDN |
| Cost | None beyond the VPS disk | R2: free up to 10 GB, no egress fees |
| Serving | The API serves `/public/media/...` with long cache headers | Straight from the bucket / CDN |
| Backups | **Must add** a tar of the volume to `deploy.sh` next to `pg_dump` | Handled by the provider |
| Staging vs live | Separate automatically (one volume per box) | One bucket per environment, or a prefix |
| Risk | Lives on one disk with the database; disk space must be watched | An external dependency and credentials to manage |

**Recommendation:** start with **A**, behind a small storage interface
(`put` / `delete` / `urlFor`) so moving to **B** later is a config change plus
a one-off copy, not a rewrite. A studio uploads a handful of images; after
resizing each is ~100–300 KB, so even many studios stay in the low GBs.

**Decided 2026-11-10: A, disk on the VPS.** The live box has 77 GB free
(96 GB disk, 20% used). Files are served at `/public/_media/...` — a studio
slug can never start with `_` (slugify turns it into `-`), so the path cannot
collide with a booking page.

**HEIC** is dropped from phase 1: sharp's prebuilt binaries can't decode it
(HEVC patents). iPhones hand browsers a JPEG when a photo is picked for
upload, so in practice this rarely bites; the error message says to send a
JPEG or PNG.

## What gets built

### Phase 1 — storage and upload (server) — **built 2026-11-10, deployed to live 2026-11-10 (PR #53)**

As built: `lib/media/storage.ts` (disk, behind the interface),
`modules/media/` (`POST /media`, `DELETE /media/:imageId`, public files at
`/public/_media/org/<orgId>/<imageId>-<400|1200>.webp`), `MEDIA_DIR`
volume `artweel_media` in `docker-compose.prod.yml`, folder created owned by
`node` in the Dockerfile, `deploy.sh` tars the volume after the database dump
(skipped while no running API has it yet). Formats JPEG / PNG / WebP; 8 MB;
200 photos per studio; EXIF stripped; files are immutable for a year.
Tests: `tests/admin/media.test.ts` (15), plus `tests/public` (157) still
green. Tried through the local dashboard: 201 on upload, WebP served with the
year-long cache, a text file refused, delete → 404 from the server.

Note: because photos are cached as immutable, a browser that already showed
a photo keeps showing it after it is removed until its cache clears. A
*replaced* photo always gets a new address, so nobody sees a stale one.

Originally planned:
1. `server/src/lib/media/` — storage interface with a disk implementation
   (root from `MEDIA_DIR`, default `/data/media`), keys namespaced by
   organisation: `org/<orgId>/<uuid>-<size>.webp`.
2. `POST /api/organizations/:orgId/media` — admin only, multipart (`busboy`),
   one file, **max 8 MB**, JPEG / PNG / WebP / HEIC only, checked by content
   (magic bytes), not by the filename.
3. `sharp`: auto-rotate from EXIF, **strip EXIF** (phone photos carry GPS),
   re-encode to WebP at two widths (e.g. 400 and 1200). Returns the key and
   URLs.
4. `GET /public/media/*` — serves files with `Cache-Control: public,
   max-age=31536000, immutable` (keys never change; a replaced image gets a
   new key).
5. Per-studio cap (e.g. 200 images) so one account can't fill the disk.
6. Volume in `docker-compose.prod.yml`; `deploy.sh` backs it up alongside the
   database dump.

### Phases 2–4 — **built 2026-11-10, deployed to live 2026-11-10 (PR #53)**

As built:
- Migration `20261110120000_activity_and_staff_photos`: `image_key`,
  `image_alt` on `service_types`; `photo_key`, `photo_alt` on `staff`.
- Every save path checks the key is this studio's and its files exist
  (`assertOwnImage`), refuses a photo without a description
  (`assertAltText`), and deletes the old files once nothing points at them
  (`releaseImageIfUnused`): `/services` create / update / delete,
  `/activities` (Classes and Events) create and edit, `/staff` create and
  update.
- Dashboard: `ImagePicker` (upload on choose, preview, Replace, Remove,
  required description) in the activity editor (`ServiceForm`, with a
  phone-size card preview), the Class / Event flow (`CreateActivity`,
  *Look* step, blocks Next without a description) and the staff editor
  (round portrait). Activity cards and staff cards on the dashboard show them.
- Public: storefront cards, activity page hero, About page team, booking-page
  activity tiles and the instructor step — each with `srcset` for both widths
  and the emoji / gradient / initials kept as the fallback. The booking page's
  tile button now reads "Choose a date" too, like the storefront.
- Tests: `tests/admin/media.test.ts` now 23 (attach, alt required, another
  studio's key refused, replace and remove delete files, kept through an
  unrelated edit, shown on the activity page, portrait reaches the booking
  page's staff list).
- Tried locally: a photo on Family Wheel Saturdays through *Edit class*
  (Next blocked until described, then saved) — on the dashboard card,
  Home, Activities and its page; a portrait on Rowan Pike — on the dashboard
  card and the About page team.
- Not tried in a browser: the booking page's instructor step (only appointment
  activities have one, and the local one is switched off) — covered by the
  server test that the staff list carries the portrait.

Originally planned:

### Phase 2 — data
7. Migration: `ServiceType.imageKey`, `ServiceType.imageAlt`;
   `Staff.photoKey`, `Staff.photoAlt`. Keep `photoUrl` readable for now and
   drop it once nothing uses it.
8. Activity and staff update schemas accept the key (only one this studio
   uploaded) and alt text; removing an image clears the key and deletes the
   files.

### Phase 3 — dashboard
9. Shared `ImagePicker` component: choose / drag a file, preview, Replace,
   Remove, an alt-text box (required before saving, with a hint like
   "Describe the photo for people who can't see it").
10. Activity editor → *Presentation*: photo above Icon / Colour, with a live
    preview of the storefront card at phone width (the "mobile preview").
11. Staff editor: portrait (square), shown on the staff cards instead of
    initials when set.

### Phase 4 — public pages
12. Storefront cards (`.sf-card-media`): the photo instead of the gradient
    when set, with `alt`, `loading="lazy"`, `srcset` for the two sizes; emoji
    and gradient stay the fallback.
13. Activity page hero, booking-page activity list, booking-page instructor
    step, and the storefront "The team" section.
14. Widget / embed: same images.

### Phase 5 — crop — **built 2026-11-11, branch `feat/photo-crop`, not deployed**

As built: choosing a photo opens `CropDialog` (no library) in the shape it is
shown in — 4:3 for activities, a square with a round mask for portraits.
Drag (mouse or touch) to move, slider / mouse wheel / +− to zoom up to 4×,
arrow keys to nudge; Escape closes only the crop, not the editor under it.
The frame is never taller than half the screen, so the slider and buttons
stay in view on a phone. The dialog sends a `crop` field
`{x, y, width, height}` (pixels of the photo as seen) with the upload; the
server turns the photo upright, cuts that box (`fitCrop`: up to 2 px of
rounding pulled back in, anything further refused as `MEDIA_CROP`), then
resizes — so the stored photo is cut from the original, with no quality lost.
An existing photo cannot be re-framed (the original is not kept); Replace
picks it again. Tests: `tests/admin/media.test.ts` now 30 (crop applied,
sideways phone photo, rounding, four bad boxes stored nothing). Tried
locally: a 16:9 photo zoomed 2× and dragged to its top-right quarter came
back 600×450 and entirely that quarter; a portrait at phone size came back
1200×1200 framed as shown; Escape left the editor open with nothing uploaded.

Originally planned:
15. A crop step in `ImagePicker` with fixed shapes — 4:3 for activities,
    square for portraits — using a small library (e.g. `react-easy-crop`);
    the crop box is sent with the upload and applied by `sharp`.

## Testing

- Server tests: rejects wrong type / too large / another studio's key;
  EXIF stripped; files deleted on remove; cap enforced; public URL cached.
- Browser: upload, replace, remove, alt text on a real phone-size viewport;
  storefront and booking page show the photo with the gradient fallback
  intact for activities without one.
- Staging first (it has its own volume), then live.

## Size

Phases 1–4 are the usable feature: roughly 3–4 focused days including tests
and a staging pass. Phase 5 (crop) is about another day. Each phase can ship
on its own PR.

## Open questions for the client

- Is one photo per activity enough, or do they want a small gallery?
- Should a portrait appear on the booking page's "choose your instructor"
  step, or only on the team section?
