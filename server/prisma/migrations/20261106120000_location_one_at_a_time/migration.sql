-- CLASS-EVENT-PLAN.md, Stage 4: whether a location runs one thing at a time.
-- Off for every existing location, so nothing that schedules today changes.

-- AlterTable
ALTER TABLE "locations" ADD COLUMN "one_at_a_time" BOOLEAN NOT NULL DEFAULT false;
