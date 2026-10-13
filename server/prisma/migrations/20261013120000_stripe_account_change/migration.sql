-- A studio can move to a different Stripe account.
--
-- While the new account is being set up it sits in pending_stripe_account_id
-- and the current one keeps taking bookings; the two swap only once Stripe
-- says the new one can take payments, so there is never a moment without a
-- working account. The account it replaced is kept, with when it changed,
-- because refunds and disputes for earlier bookings still go through it.

ALTER TABLE "organizations"
  ADD COLUMN "pending_stripe_account_id" TEXT,
  ADD COLUMN "pending_stripe_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "previous_stripe_account_id" TEXT,
  ADD COLUMN "stripe_account_changed_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "organizations_pending_stripe_account_id_key"
  ON "organizations"("pending_stripe_account_id");
