-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "stripe_account_id" TEXT,
ADD COLUMN     "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_onboarded_at" TIMESTAMPTZ(3),
ADD COLUMN     "stripe_payouts_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "booking_id" UUID,
    "hold_id" UUID,
    "kind" "PaymentKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_checkout_session_id" TEXT,
    "provider_payment_intent_id" TEXT,
    "provider_account_id" TEXT,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "succeeded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "credit_cents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "provider_refund_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_checkout_session_id_key" ON "payments"("provider_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_intent_id_key" ON "payments"("provider_payment_intent_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_created_at_idx" ON "payments"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_processed_at_idx" ON "webhook_events"("event_type", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripe_account_id_key" ON "organizations"("stripe_account_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

