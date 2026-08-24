-- B8 — storefront copy the owner writes and their customers read.
--
-- Every column is nullable and every column has a fallback in the
-- renderBookingPage renderer, so the OLD server serving requests mid-deploy
-- ignores these and paints the page it always did. Nothing here changes what
-- an existing studio sees until they save something into these fields.
--
-- Bounds are asserted at both ends: zod on the write path so the API refuses
-- with a readable message, and CHECK constraints in the database so a value
-- reaching the table any other way (a fixture, a support session, a psql
-- window) cannot make a booking page render an eight-thousand-word tagline.

ALTER TABLE "organizations"
    ADD COLUMN "tagline"          TEXT,
    ADD COLUMN "about"            TEXT,
    ADD COLUMN "contact_email"    TEXT,
    ADD COLUMN "contact_phone"    TEXT,
    ADD COLUMN "seo_title"        TEXT,
    ADD COLUMN "seo_description"  TEXT;

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_tagline_len"
        CHECK ("tagline" IS NULL OR char_length("tagline") <= 160),
    ADD CONSTRAINT "organizations_about_len"
        CHECK ("about" IS NULL OR char_length("about") <= 2000),
    ADD CONSTRAINT "organizations_contact_email_len"
        CHECK ("contact_email" IS NULL OR char_length("contact_email") <= 254),
    ADD CONSTRAINT "organizations_contact_phone_len"
        CHECK ("contact_phone" IS NULL OR char_length("contact_phone") <= 40),
    ADD CONSTRAINT "organizations_seo_title_len"
        CHECK ("seo_title" IS NULL OR char_length("seo_title") <= 70),
    ADD CONSTRAINT "organizations_seo_description_len"
        CHECK ("seo_description" IS NULL OR char_length("seo_description") <= 200);
