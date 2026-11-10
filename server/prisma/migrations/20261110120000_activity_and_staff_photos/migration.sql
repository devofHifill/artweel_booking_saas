-- Uploaded photos (FB-11, docs/PHOTO-UPLOADS-PLAN.md).
--
-- The KEY is stored, not a URL: `org/<organizationId>/<imageId>`, which the
-- media storage turns into addresses for each size. A URL would bake the
-- storage location into every row, and moving to an object store later would
-- mean rewriting all of them.
--
-- Alt text sits beside each key because a photo without one is a gap for
-- anybody using a screen reader; the editors require it before saving.
-- All nullable: every existing activity and staff member keeps its emoji /
-- initials exactly as before.
ALTER TABLE "service_types"
    ADD COLUMN "image_key" TEXT,
    ADD COLUMN "image_alt" TEXT;

ALTER TABLE "staff"
    ADD COLUMN "photo_key" TEXT,
    ADD COLUMN "photo_alt" TEXT;
