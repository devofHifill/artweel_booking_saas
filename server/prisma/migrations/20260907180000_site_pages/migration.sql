-- Pages on a studio's public site, beyond the booking page itself.
--
-- The booking page is deliberately NOT one of these rows. It is rendered from
-- the studio's services and availability and always exists; modelling it here
-- would mean a studio could delete the thing the product is for, or leave it
-- in DRAFT and wonder why nobody can book.
--
-- `path` is the segment after /p/, and that prefix is load-bearing rather than
-- cosmetic. `/public/:slug/data`, `/public/:slug/availability` and
-- `/public/:slug/services/:id/staff` already exist, so an unprefixed page path
-- would shadow the API the studio's own booking page calls — and it would do
-- so the day somebody named a page "data", not at deploy time. Namespacing
-- costs one URL segment and removes the entire class of collision, including
-- from route names added later.
--
-- `body` is PLAIN TEXT and escaped on render. Not markdown, not HTML. A
-- textarea that accepts markup is stored XSS on a page this studio's own
-- customers visit, and nothing here needs markup badly enough to earn a
-- sanitiser and its CVEs.
--
-- Pages start as DRAFT. A page is created by someone who has not written it
-- yet, and defaulting to PUBLISHED would put an empty page on a live site
-- between the moment it is created and the moment it is filled in.

CREATE TYPE "SitePageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "site_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SitePageStatus" NOT NULL DEFAULT 'DRAFT',
    "show_in_nav" BOOLEAN NOT NULL DEFAULT true,
    "nav_order" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- Lower-case, hyphens and digits only, 1-60 characters. Asserted here as well
-- as in zod because a path arriving any other way — a fixture, a support
-- session — becomes a URL, and "About Us" or "../admin" as a path is a broken
-- link at best.
ALTER TABLE "site_pages"
    ADD CONSTRAINT "site_pages_path_shape"
        CHECK ("path" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("path") <= 60),
    ADD CONSTRAINT "site_pages_title_len"
        CHECK (char_length("title") BETWEEN 1 AND 120),
    ADD CONSTRAINT "site_pages_body_len"
        CHECK (char_length("body") <= 20000);

CREATE UNIQUE INDEX "site_pages_organization_id_path_key"
    ON "site_pages"("organization_id", "path");

-- Every public read is "the published pages for this studio", which is exactly
-- this pair. Unlike the speculative index dropped in 20260902160000, this one
-- has a caller before it exists.
CREATE INDEX "site_pages_organization_id_status_idx"
    ON "site_pages"("organization_id", "status");

ALTER TABLE "site_pages"
    ADD CONSTRAINT "site_pages_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The header button on the public site: what it says, and where it goes.
--
-- Null label means the default, so a studio that never opens the Navigation
-- screen still gets a working header rather than a button with no text.
ALTER TABLE "organizations"
    ADD COLUMN "nav_cta_label" TEXT,
    ADD COLUMN "nav_cta_target" TEXT;

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_nav_cta_label_len"
        CHECK ("nav_cta_label" IS NULL OR char_length("nav_cta_label") <= 40);
