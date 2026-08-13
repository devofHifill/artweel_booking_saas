-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'CLAIMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "hold_id" UUID,
    "offered_at" TIMESTAMPTZ(3),
    "offer_expires_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "booking_id" UUID,
    "claim_token" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_booking_id_key" ON "waitlist_entries"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_claim_token_key" ON "waitlist_entries"("claim_token");

-- CreateIndex
CREATE INDEX "waitlist_entries_session_id_status_position_idx" ON "waitlist_entries"("session_id", "status", "position");

-- CreateIndex
CREATE INDEX "waitlist_entries_organization_id_idx" ON "waitlist_entries"("organization_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_offer_expires_at_status_idx" ON "waitlist_entries"("offer_expires_at", "status");

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Constraints Prisma's schema language cannot express.
-- ===========================================================================

-- One live place in one queue per customer.
--
-- Without this, a customer refreshing a full class page and submitting twice
-- occupies positions 3 and 4, and is offered the same seat twice while
-- somebody genuinely behind them waits. CLAIMED, EXPIRED and CANCELLED rows
-- are excluded, so rejoining a queue after withdrawing is allowed.
CREATE UNIQUE INDEX "waitlist_entries_one_live_per_customer"
  ON "waitlist_entries" ("session_id", "customer_id")
  WHERE "status" IN ('WAITING', 'OFFERED');

-- An offer is a seat held with a clock on it. Both halves or neither.
--
-- An OFFERED row without an expiry would hold a seat forever, which is worse
-- than never offering it — the class shows full and nobody can have it.
ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_offer_coherent"
  CHECK (
    ("status" = 'OFFERED' AND "offer_expires_at" IS NOT NULL AND "hold_id" IS NOT NULL)
    OR ("status" <> 'OFFERED')
  );

-- A claimed place must say what it got.
ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_claim_coherent"
  CHECK (
    ("status" = 'CLAIMED' AND "booking_id" IS NOT NULL)
    OR ("status" <> 'CLAIMED' AND "booking_id" IS NULL)
  );

ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_seats_positive" CHECK ("seats" >= 1);
