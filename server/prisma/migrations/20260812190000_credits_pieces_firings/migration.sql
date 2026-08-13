-- CreateEnum
CREATE TYPE "MakeUpCreditStatus" AS ENUM ('AVAILABLE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('GREENWARE', 'AWAITING_BISQUE', 'BISQUE_FIRING', 'BISQUED', 'AWAITING_GLAZE', 'GLAZE_FIRING', 'FINISHED', 'COLLECTED', 'BROKEN');

-- CreateEnum
CREATE TYPE "FiringType" AS ENUM ('BISQUE', 'GLAZE');

-- CreateEnum
CREATE TYPE "FiringStatus" AS ENUM ('SCHEDULED', 'LOADING', 'FIRING', 'COOLING', 'COMPLETE', 'CANCELLED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "make_up_credit_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "make_up_credits_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "make_up_cross_cohort" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "make_up_notice_hours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "make_up_requires_notice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "piece_hold_days" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "make_up_credits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "source_booking_id" UUID,
    "status" "MakeUpCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expires_at" TIMESTAMPTZ(3),
    "redeemed_at" TIMESTAMPTZ(3),
    "redeemed_booking_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "make_up_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "session_id" UUID,
    "enrollment_id" UUID,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "shelf_location" TEXT,
    "status" "PieceStatus" NOT NULL DEFAULT 'GREENWARE',
    "ready_at" TIMESTAMPTZ(3),
    "collected_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "firing_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_events" (
    "id" UUID NOT NULL,
    "piece_id" UUID NOT NULL,
    "from_status" "PieceStatus",
    "to_status" "PieceStatus" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piece_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "firing_type" "FiringType" NOT NULL,
    "status" "FiringStatus" NOT NULL DEFAULT 'SCHEDULED',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "cone" TEXT,
    "resource_allocation_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "make_up_credits_redeemed_booking_id_key" ON "make_up_credits"("redeemed_booking_id");

-- CreateIndex
CREATE INDEX "make_up_credits_organization_id_status_idx" ON "make_up_credits"("organization_id", "status");

-- CreateIndex
CREATE INDEX "make_up_credits_customer_id_status_idx" ON "make_up_credits"("customer_id", "status");

-- CreateIndex
CREATE INDEX "pieces_organization_id_status_idx" ON "pieces"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pieces_customer_id_idx" ON "pieces"("customer_id");

-- CreateIndex
CREATE INDEX "pieces_firing_id_idx" ON "pieces"("firing_id");

-- CreateIndex
CREATE INDEX "piece_events_piece_id_created_at_idx" ON "piece_events"("piece_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "firings_resource_allocation_id_key" ON "firings"("resource_allocation_id");

-- CreateIndex
CREATE INDEX "firings_organization_id_starts_at_idx" ON "firings"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "firings_resource_id_starts_at_idx" ON "firings"("resource_id", "starts_at");

-- AddForeignKey
ALTER TABLE "make_up_credits" ADD CONSTRAINT "make_up_credits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "make_up_credits" ADD CONSTRAINT "make_up_credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "make_up_credits" ADD CONSTRAINT "make_up_credits_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_firing_id_fkey" FOREIGN KEY ("firing_id") REFERENCES "firings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_events" ADD CONSTRAINT "piece_events_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firings" ADD CONSTRAINT "firings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firings" ADD CONSTRAINT "firings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Constraints Prisma's schema language cannot express.
-- ===========================================================================

-- ONE credit per missed class.
--
-- This is what makes issuance idempotent: saving the same register twice, or
-- two staff marking it at once, cannot mint a second credit for one absence.
-- Cancelled credits are excluded so a studio that revokes one by mistake can
-- reissue it.
CREATE UNIQUE INDEX "make_up_credits_one_per_absence"
  ON "make_up_credits" ("source_booking_id")
  WHERE "source_booking_id" IS NOT NULL AND "status" <> 'CANCELLED';

-- A redeemed credit must say when and against what; an available one must not.
-- Without this the two fields drift apart and "how many credits are actually
-- outstanding" stops being answerable from the status column alone.
ALTER TABLE "make_up_credits"
  ADD CONSTRAINT "make_up_credits_redemption_coherent"
  CHECK (
    ("status" = 'REDEEMED' AND "redeemed_at" IS NOT NULL AND "redeemed_booking_id" IS NOT NULL)
    OR ("status" <> 'REDEEMED' AND "redeemed_booking_id" IS NULL)
  );

-- A firing occupies its kiln for a real span, cooling included.
ALTER TABLE "firings"
  ADD CONSTRAINT "firings_span_positive" CHECK ("ends_at" > "starts_at");

-- A piece is collected exactly when it says it is.
ALTER TABLE "pieces"
  ADD CONSTRAINT "pieces_collection_coherent"
  CHECK (
    ("status" = 'COLLECTED' AND "collected_at" IS NOT NULL)
    OR ("status" <> 'COLLECTED' AND "collected_at" IS NULL)
  );

-- Policy values that would otherwise silently disable a feature.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_make_up_credit_days_nonneg" CHECK ("make_up_credit_days" >= 0),
  ADD CONSTRAINT "organizations_make_up_notice_hours_nonneg" CHECK ("make_up_notice_hours" >= 0),
  ADD CONSTRAINT "organizations_piece_hold_days_nonneg" CHECK ("piece_hold_days" >= 0);
