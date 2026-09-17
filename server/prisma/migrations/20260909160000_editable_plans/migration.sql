-- Plans become data, and studios start recording what they actually pay.
--
-- THE SECOND HALF IS WHY THE FIRST IS SAFE. MRR has always been computed as
-- "today's list price times the studios that are ACTIVE" — correct only while
-- prices never change, which was true precisely because they lived in code.
-- Making them editable without recording per-studio prices would mean the
-- first edit silently restated the revenue of every existing subscriber, while
-- Stripe went on charging them the old amount. So the column comes first.

-- What a studio agreed to pay, captured when the subscription starts and never
-- rewritten by a later price change.
--
-- Backfilled below from the current list price, which is exactly right today:
-- prices have never changed, so every existing subscriber IS on the list price.
-- That is the one moment this backfill is truthful, and it is now.
ALTER TABLE "organizations"
    ADD COLUMN "subscribed_price_cents" INTEGER;

-- The editable half of a plan. Feature flags deliberately stay in code: a
-- feature is only real when something calls requireFeature with it, so a
-- toggle for one nothing reads would be a control that does nothing.
CREATE TABLE "plan_settings" (
    "id"                  "Plan" NOT NULL,
    "price_cents_monthly" INTEGER NOT NULL,
    -- NULL means unlimited, matching the constant this replaces.
    "max_staff"           INTEGER,
    "max_locations"       INTEGER,
    "updated_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_settings_pkey" PRIMARY KEY ("id")
);

-- Seeded from billing/plan.ts as it stands. These are not defaults to fall back
-- on — once this table exists it is the source, and the constant is only the
-- shape and the starting point.
INSERT INTO "plan_settings" ("id", "price_cents_monthly", "max_staff", "max_locations") VALUES
    ('SOLO',    3900,  1,    1),
    ('STUDIO',  8900,  5,    3),
    ('PRO',    18900,  NULL, NULL);

-- Backfill: every paying studio is on the list price for its plan, because no
-- price has ever changed. Restricted to studios that actually pay — a trialing
-- or cancelled studio has agreed to nothing, and writing a number there would
-- invent a commitment.
-- `subscriptionStatus` is camelCase in the database, not snake_case like its
-- neighbours, so it must be quoted. Unquoted it folds to lowercase and the
-- column is not found.
UPDATE "organizations" o
SET "subscribed_price_cents" = p."price_cents_monthly"
FROM "plan_settings" p
WHERE p."id" = o."plan"
  AND o."subscriptionStatus" = 'ACTIVE';
