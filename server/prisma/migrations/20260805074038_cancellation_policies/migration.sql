-- AlterTable
ALTER TABLE "service_types" ADD COLUMN     "cancellation_policy_id" UUID;

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "tiers" JSONB NOT NULL,
    "no_show_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "allow_reschedule" BOOLEAN NOT NULL DEFAULT true,
    "reschedule_cutoff_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancellation_policies_organization_id_idx" ON "cancellation_policies"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policies_organization_id_name_key" ON "cancellation_policies"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default cancellation policy per organization.
--
-- Prisma cannot express a PARTIAL unique index, so it lives here. Without it,
-- two rows flagged is_default make "which terms apply?" ambiguous, and the
-- answer would silently depend on row order.
CREATE UNIQUE INDEX "cancellation_policies_one_default_per_org"
  ON "cancellation_policies" ("organization_id")
  WHERE ("is_default");
