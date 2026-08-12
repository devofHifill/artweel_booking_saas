-- Phase 2, W2.1b — holds that span a whole cohort.
--
-- A course hold reserves seats in EVERY week of the course under one row, so
-- that the Stripe round-trip cannot end with a customer paying for a course
-- whose week four was sold to somebody else while they typed their card in.

-- AlterTable
ALTER TABLE "booking_holds" ADD COLUMN     "course_series_id" UUID;

-- A hold is for one class or for one course, never both. Without this the
-- release path is ambiguous — it would have to guess which seats to give back,
-- and guessing wrong silently shrinks a class.
ALTER TABLE "booking_holds"
  ADD CONSTRAINT "booking_holds_one_target"
  CHECK (NOT ("session_id" IS NOT NULL AND "course_series_id" IS NOT NULL));

-- CreateIndex
CREATE INDEX "booking_holds_course_series_id_idx" ON "booking_holds"("course_series_id");

-- AddForeignKey
ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_course_series_id_fkey" FOREIGN KEY ("course_series_id") REFERENCES "course_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
