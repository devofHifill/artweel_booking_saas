-- AlterTable
ALTER TABLE "marketing_events" ALTER COLUMN "referrer_host" SET NOT NULL,
ALTER COLUMN "referrer_host" SET DEFAULT '',
ALTER COLUMN "source" SET NOT NULL,
ALTER COLUMN "source" SET DEFAULT '';

