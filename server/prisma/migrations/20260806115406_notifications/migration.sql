-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "sms_opted_out_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "booking_id" UUID,
    "customer_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_booking_id_idx" ON "notifications"("booking_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_organization_id_template_key_channel_key" ON "notification_templates"("organization_id", "template_key", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

