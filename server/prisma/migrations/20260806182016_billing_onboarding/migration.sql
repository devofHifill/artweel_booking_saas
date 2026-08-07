-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('SOLO', 'STUDIO', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billing_customer_id" TEXT,
ADD COLUMN     "billing_subscription_id" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMPTZ(3),
ADD COLUMN     "grace_period_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "onboarding_done_at" TIMESTAMPTZ(3),
ADD COLUMN     "onboarding_steps" JSONB,
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'SOLO',
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_billing_customer_id_key" ON "organizations"("billing_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_billing_subscription_id_key" ON "organizations"("billing_subscription_id");

