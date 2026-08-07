-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "signup_landing" TEXT,
ADD COLUMN     "signup_referrer" TEXT,
ADD COLUMN     "signup_source" TEXT;

-- CreateTable
CREATE TABLE "marketing_events" (
    "id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer_host" TEXT,
    "source" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "marketing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_events_day_idx" ON "marketing_events"("day");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_events_day_path_referrer_host_source_key" ON "marketing_events"("day", "path", "referrer_host", "source");

