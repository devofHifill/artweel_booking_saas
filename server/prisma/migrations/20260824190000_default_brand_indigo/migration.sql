-- D0 — the dashboard's default accent becomes indigo.
--
-- `#4f46e5`, which is exactly the TourFlow prototype's `--brand-600`. The
-- `indigo` preset already carried that value and its three siblings, so this
-- changes which preset is the default and nothing about how presets work.

ALTER TABLE "organizations"
    ALTER COLUMN "brand_preset" SET DEFAULT 'indigo';

/*
  Existing studios move too, but ONLY those still sitting on the old default
  with no accent of their own.

  The ambiguity worth naming: a studio that deliberately chose `clay` is
  indistinguishable from one that never opened the Appearance screen — both
  rows say 'clay'. Migrating therefore risks overriding a real choice.

  It is safe here because there is no real choice to override yet. The
  Appearance screen shipped in A3, the product has no live studios (the Phase 2
  exit gate is still open), and every 'clay' row in existence is a default
  nobody has looked at. Doing this later, against real customers, would not be
  safe and should not be repeated by copying this migration.

  `brand_accent IS NULL` is belt and braces: an accent WINS over the preset, so
  a studio with a custom colour is unaffected either way — but excluding them
  makes the intent legible rather than relying on a reader knowing that rule.
*/
UPDATE "organizations"
SET "brand_preset" = 'indigo'
WHERE "brand_preset" = 'clay'
  AND "brand_accent" IS NULL;
