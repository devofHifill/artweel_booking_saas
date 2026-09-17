-- Cancellation policy: the two fields the settings screen needs.
--
-- `no_show_fee_cents` has existed since the policies migration, is validated
-- by the route, is written by the service — and is READ BY NOTHING. Another
-- capability with no caller. It is left in place rather than dropped, because
-- some rows carry a value somebody typed, but the fee a studio actually sets
-- from now on is the percentage below.
--
-- A PERCENTAGE, not cents, and that is the substantive change: what a no-show
-- costs is a share of what they paid. A flat amount is wrong in both
-- directions at once — trivial against a £400 private party, and more than the
-- whole price of a £15 taster.
ALTER TABLE "cancellation_policies"
    ADD COLUMN "no_show_fee_percent" INTEGER NOT NULL DEFAULT 100,

    -- The terms in the studio's own words.
    --
    -- NULLABLE on purpose, and null is the better state: the renderer
    -- generates a sentence from the refund ladder, so a studio that writes
    -- nothing gets prose that cannot contradict its own rules. Text is offered
    -- because studios want their own voice, and the drift it allows — "free up
    -- to 48 hours" written above a ladder that refunds at 24 — is the reason
    -- the screen shows the generated version alongside it.
    ADD COLUMN "description" TEXT;

ALTER TABLE "cancellation_policies"
    ADD CONSTRAINT "cancellation_policies_no_show_fee_percent_range"
        CHECK ("no_show_fee_percent" BETWEEN 0 AND 100),
    ADD CONSTRAINT "cancellation_policies_description_len"
        CHECK ("description" IS NULL OR char_length("description") <= 1000);
