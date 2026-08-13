-- Phase 2, W2.6b — class packs, and one entitlement currency.
--
-- Prisma's generated diff DROPS make_up_credits and creates class_credits.
-- This migration RENAMES instead, deliberately: a drop would discard every
-- credit a studio currently owes its students, which is money. The rename is
-- also what makes the rollout safe against the old code still running during
-- a deploy — nothing is destroyed, only relabelled.

-- --------------------------------------------------------------------------
-- Rename the entitlement, and widen it.
-- --------------------------------------------------------------------------

ALTER TYPE "MakeUpCreditStatus" RENAME TO "ClassCreditStatus";

-- CreateEnum
CREATE TYPE "ClassCreditSource" AS ENUM ('ABSENCE', 'PACK', 'GRANT');

-- CreateEnum
CREATE TYPE "PackPurchaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'REFUNDED');

ALTER TABLE "make_up_credits" RENAME TO "class_credits";

-- Existing rows are all absences by definition: packs did not exist.
ALTER TABLE "class_credits"
  ADD COLUMN "source" "ClassCreditSource" NOT NULL DEFAULT 'ABSENCE',
  ADD COLUMN "pack_purchase_id" UUID;

-- A rename carries indexes and constraints across under their OLD names, so
-- they are renamed too. Leaving them would mean `class_credits` reporting
-- violations of `make_up_credits_*`, which is the kind of thing that costs
-- somebody an hour later.
ALTER INDEX "make_up_credits_pkey" RENAME TO "class_credits_pkey";
ALTER INDEX "make_up_credits_redeemed_booking_id_key" RENAME TO "class_credits_redeemed_booking_id_key";
ALTER INDEX "make_up_credits_organization_id_status_idx" RENAME TO "class_credits_organization_id_status_idx";
ALTER INDEX "make_up_credits_customer_id_status_idx" RENAME TO "class_credits_customer_id_status_idx";
ALTER INDEX "make_up_credits_one_per_absence" RENAME TO "class_credits_one_per_absence";

ALTER TABLE "class_credits" RENAME CONSTRAINT "make_up_credits_redemption_coherent" TO "class_credits_redemption_coherent";
ALTER TABLE "class_credits" RENAME CONSTRAINT "make_up_credits_organization_id_fkey" TO "class_credits_organization_id_fkey";
ALTER TABLE "class_credits" RENAME CONSTRAINT "make_up_credits_customer_id_fkey" TO "class_credits_customer_id_fkey";
ALTER TABLE "class_credits" RENAME CONSTRAINT "make_up_credits_enrollment_id_fkey" TO "class_credits_enrollment_id_fkey";

-- CreateIndex
CREATE INDEX "class_credits_pack_purchase_id_idx" ON "class_credits"("pack_purchase_id");

-- --------------------------------------------------------------------------
-- Packs
-- --------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "class_packs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "credit_count" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "validity_days" INTEGER NOT NULL DEFAULT 365,
    "service_type_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_packs_pkey" PRIMARY KEY ("id")
);

-- A pack worth no classes, or costing nothing, is a data-entry mistake that
-- reads as a free-seats bug once somebody buys it.
ALTER TABLE "class_packs"
  ADD CONSTRAINT "class_packs_credit_count_positive" CHECK ("credit_count" >= 1),
  ADD CONSTRAINT "class_packs_price_nonnegative" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "class_packs_validity_nonnegative" CHECK ("validity_days" >= 0);

-- CreateTable
CREATE TABLE "class_pack_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "class_pack_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "PackPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "credit_count" INTEGER NOT NULL,
    "price_paid_cents" INTEGER NOT NULL,
    "validity_days" INTEGER NOT NULL,
    "service_type_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_pack_purchases_pkey" PRIMARY KEY ("id")
);

-- An ACTIVE purchase has minted its credits and must say when. A PENDING one
-- has not, and must not look as though it has.
ALTER TABLE "class_pack_purchases"
  ADD CONSTRAINT "class_pack_purchases_issue_coherent"
  CHECK (
    ("status" = 'ACTIVE' AND "issued_at" IS NOT NULL)
    OR ("status" <> 'ACTIVE')
  );

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "pack_purchase_id" UUID;

-- CreateIndex
CREATE INDEX "class_packs_organization_id_is_active_idx" ON "class_packs"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "class_pack_purchases_organization_id_status_idx" ON "class_pack_purchases"("organization_id", "status");

-- CreateIndex
CREATE INDEX "class_pack_purchases_customer_id_idx" ON "class_pack_purchases"("customer_id");

-- CreateIndex
CREATE INDEX "payments_pack_purchase_id_idx" ON "payments"("pack_purchase_id");

-- AddForeignKey
ALTER TABLE "class_credits" ADD CONSTRAINT "class_credits_pack_purchase_id_fkey" FOREIGN KEY ("pack_purchase_id") REFERENCES "class_pack_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_packs" ADD CONSTRAINT "class_packs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_packs" ADD CONSTRAINT "class_packs_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_pack_purchases" ADD CONSTRAINT "class_pack_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_pack_purchases" ADD CONSTRAINT "class_pack_purchases_class_pack_id_fkey" FOREIGN KEY ("class_pack_id") REFERENCES "class_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_pack_purchases" ADD CONSTRAINT "class_pack_purchases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_pack_purchase_id_fkey" FOREIGN KEY ("pack_purchase_id") REFERENCES "class_pack_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
