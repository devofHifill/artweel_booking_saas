-- Phase 2, W2.1 — course cohorts and enrolments.
--
-- Two departures from the generated diff, both deliberate:
--
--   1. course_series.timezone is added nullable, backfilled from the owning
--      organization, and only then made NOT NULL. The generated diff adds it
--      NOT NULL in one statement, which aborts against any environment that
--      already has course_series rows.
--
--   2. The "one active enrolment per person per cohort" rule is a PARTIAL
--      unique index. Prisma's schema language cannot express a WHERE clause on
--      a unique index, so it lives here. A plain unique constraint would be
--      wrong: it would permanently bar a student who cancelled by mistake from
--      ever rejoining that cohort.

-- CreateEnum
CREATE TYPE "CourseSeriesStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "enrollment_id" UUID;

-- AlterTable
ALTER TABLE "course_series" ADD COLUMN     "allow_late_enrollment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "enrollment_closes_at" TIMESTAMPTZ(3),
ADD COLUMN     "location_id" UUID,
ADD COLUMN     "staff_id" UUID,
ADD COLUMN     "status" "CourseSeriesStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "timezone" TEXT;

-- Backfill the zone from the studio that owns the cohort, then enforce it.
UPDATE "course_series" cs
SET "timezone" = o."timezone"
FROM "organizations" o
WHERE o."id" = cs."organization_id"
  AND cs."timezone" IS NULL;

ALTER TABLE "course_series" ALTER COLUMN "timezone" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "enrollment_id" UUID;

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_series_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "cancel_token" BYTEA NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "notes" TEXT,
    "joined_late" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- Seats must be positive, and the price of a course cannot be negative.
-- Application code checks both; this is the backstop, in the same spirit as
-- the CHECK on sessions.seats_taken.
ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_seats_positive" CHECK ("seats" >= 1),
  ADD CONSTRAINT "enrollments_total_nonnegative" CHECK ("total_cents" >= 0);

-- A cohort must have at least one session and at least one seat.
ALTER TABLE "course_series"
  ADD CONSTRAINT "course_series_session_count_positive" CHECK ("session_count" >= 1),
  ADD CONSTRAINT "course_series_capacity_positive" CHECK ("capacity" >= 1);

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_cancel_token_key" ON "enrollments"("cancel_token");

-- CreateIndex
CREATE INDEX "enrollments_organization_id_idx" ON "enrollments"("organization_id");

-- CreateIndex
CREATE INDEX "enrollments_course_series_id_idx" ON "enrollments"("course_series_id");

-- CreateIndex
CREATE INDEX "enrollments_customer_id_idx" ON "enrollments"("customer_id");

-- One ACTIVE enrolment per customer per cohort. Cancelled and completed rows
-- are excluded, so re-enrolling after a cancellation is allowed and the
-- history of both attempts is kept.
CREATE UNIQUE INDEX "enrollments_active_per_customer"
  ON "enrollments" ("course_series_id", "customer_id")
  WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "bookings_enrollment_id_idx" ON "bookings"("enrollment_id");

-- CreateIndex
CREATE INDEX "course_series_organization_id_status_idx" ON "course_series"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payments_enrollment_id_idx" ON "payments"("enrollment_id");

-- AddForeignKey
ALTER TABLE "course_series" ADD CONSTRAINT "course_series_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_series" ADD CONSTRAINT "course_series_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_series_id_fkey" FOREIGN KEY ("course_series_id") REFERENCES "course_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
