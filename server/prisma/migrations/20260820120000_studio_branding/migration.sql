-- A1 — per-studio branding.
--
-- Safe against the OLD code still serving requests mid-deploy: one column with a
-- default and one nullable, both ignored by every existing read path.
--
-- These do NOT replace the shared design tokens. They feed an override layer
-- (src/lib/brand.ts) that may set four tokens and no others: --clay, --clay-dk,
-- --clay-lt and --clay-text. Structural tokens stay central, so a studio can
-- pick its accent and still cannot make its own dashboard unreadable.

ALTER TABLE "organizations"
    ADD COLUMN "brand_preset" TEXT NOT NULL DEFAULT 'clay',
    ADD COLUMN "brand_accent" TEXT;

-- The format is asserted here as well as in zod because this column is read
-- straight into a stylesheet. A row that reached the table by any other route --
-- a fixture, a support session, a psql session at 2am -- must not be able to
-- inject a closing brace into a <style> block on a public booking page.
--
-- Six hex digits with a leading hash, lower case. Shorthand is rejected rather
-- than expanded: one canonical form in the column means comparisons and audit
-- diffs never argue about whether #abc and #aabbcc are the same value.
ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_brand_accent_hex"
    CHECK ("brand_accent" IS NULL OR "brand_accent" ~ '^#[0-9a-f]{6}$');
