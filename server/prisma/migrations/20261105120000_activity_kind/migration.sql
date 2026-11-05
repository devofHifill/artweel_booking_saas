-- Classes and events (CLASS-EVENT-PLAN.md, Stages 0 and 1).

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CLASS', 'EVENT', 'OLDER');

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN "kind" "ActivityKind" NOT NULL DEFAULT 'OLDER';

-- Stage 0: give every existing activity the kind it already is.
--   A course                                  -> CLASS
--   A seat-based activity with exactly one
--   date of its own (not a course session)    -> EVENT
--   Everything else (drop-in repeats, private
--   lessons, a group class with no dates yet) -> OLDER, the default
UPDATE "service_types" SET "kind" = 'CLASS' WHERE "booking_mode" = 'COURSE_SERIES';

UPDATE "service_types" st SET "kind" = 'EVENT'
WHERE st."booking_mode" = 'EVENT'
  AND (
    SELECT count(*) FROM "sessions" s
    WHERE s."service_type_id" = st."id" AND s."course_series_id" IS NULL
  ) = 1;

-- CreateTable
CREATE TABLE "activity_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_drafts_organization_id_updated_at_idx" ON "activity_drafts"("organization_id", "updated_at");

-- AddForeignKey
ALTER TABLE "activity_drafts" ADD CONSTRAINT "activity_drafts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
