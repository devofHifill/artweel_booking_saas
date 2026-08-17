-- S4 — platform-initiated suspension, and comped subscriptions.
--
-- Safe against the OLD code still serving requests during a deploy: three
-- nullable columns with no default, so no table rewrite and nothing existing
-- reads them yet.

-- Set when an OPERATOR suspends a studio, as opposed to billing suspending it.
--
-- The two reasons must not clobber each other. SUSPENDED is currently set by
-- sweepExpiredSubscriptions (expired trial, lapsed grace) and cleared by the
-- Stripe webhooks on a successful payment. Without this column, suspending a
-- studio by hand for abuse is silently undone by their next successful invoice —
-- and the operator has no way to notice, because the status looks the same as
-- one billing set.
ALTER TABLE "organizations"
    ADD COLUMN "suspended_by_platform_at" TIMESTAMPTZ(3),
    ADD COLUMN "suspended_reason" TEXT;

-- Set when a studio is on a plan it is not paying for.
--
-- Recorded rather than inferred because comping does NOT cancel the Stripe
-- subscription (a deliberate decision, 2026-08-17): the local row says ACTIVE on
-- a comped plan while Stripe carries on charging the card. That divergence is
-- intended, but it must never be invisible — the studio detail response reports
-- it explicitly so an operator sees "comped, and still being billed" instead of
-- learning it from the studio's card statement.
ALTER TABLE "organizations"
    ADD COLUMN "comped_at" TIMESTAMPTZ(3);

-- Finding the platform-suspended studios is a routine operator query and there
-- will never be many of them, so a partial index costs almost nothing and keeps
-- the "why is this studio off" question cheap.
CREATE INDEX "organizations_suspended_by_platform_at_idx"
    ON "organizations"("suspended_by_platform_at")
    WHERE "suspended_by_platform_at" IS NOT NULL;
