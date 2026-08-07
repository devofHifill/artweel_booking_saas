-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISABLED');

-- CreateEnum
CREATE TYPE "CalendarSyncAction" AS ENUM ('UPSERT', 'DELETE');

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "account_email" TEXT,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "sync_token" TEXT,
    "channel_id" TEXT,
    "channel_resource_id" TEXT,
    "channel_expires_at" TIMESTAMPTZ(3),
    "channel_token_enc" TEXT,
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_links" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "booking_id" UUID,
    "session_id" UUID,
    "external_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "booking_id" UUID,
    "session_id" UUID,
    "action" "CalendarSyncAction" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "last_error" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_staff_id_key" ON "calendar_connections"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_channel_id_key" ON "calendar_connections"("channel_id");

-- CreateIndex
CREATE INDEX "calendar_connections_organization_id_idx" ON "calendar_connections"("organization_id");

-- CreateIndex
CREATE INDEX "calendar_connections_channel_expires_at_idx" ON "calendar_connections"("channel_expires_at");

-- CreateIndex
CREATE INDEX "calendar_event_links_external_event_id_idx" ON "calendar_event_links"("external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_connection_id_external_event_id_key" ON "calendar_event_links"("connection_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_connection_id_booking_id_key" ON "calendar_event_links"("connection_id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_connection_id_session_id_key" ON "calendar_event_links"("connection_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sync_jobs_dedupe_key_key" ON "calendar_sync_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "calendar_sync_jobs_status_scheduled_for_idx" ON "calendar_sync_jobs"("status", "scheduled_for");

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sync_jobs" ADD CONSTRAINT "calendar_sync_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

