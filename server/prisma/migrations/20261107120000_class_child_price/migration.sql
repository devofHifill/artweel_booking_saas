-- A Class sells adult and child places on one run (CLASS-EVENT-PLAN.md).
--
-- The child price sits on the cohort, beside its adult price, because both
-- are prices for the WHOLE run. The service's child_price_cents is a per-class
-- rate on older activities, and reusing it on a course would discount every
-- week instead of once. Every existing cohort gets 0: all its seats stay at
-- the adult price, exactly as before.
ALTER TABLE "course_series"
    ADD COLUMN "child_price_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "course_series"
    ADD CONSTRAINT "course_series_child_price_nonnegative"
    CHECK ("child_price_cents" >= 0);

-- How many of an enrolment's seats are children, the same idiom as bookings:
-- adults are seats - children, so the two can never disagree.
ALTER TABLE "enrollments"
    ADD COLUMN "children" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_children_within_seats"
    CHECK ("children" >= 0 AND "children" <= "seats");
