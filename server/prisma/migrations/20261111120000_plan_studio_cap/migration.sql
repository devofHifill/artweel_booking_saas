-- The most studios allowed on a plan, edited on Admin > Plans.
--
-- NULL means unlimited, which is what every plan was before this column, so
-- nothing changes until an operator sets one. A cap below the current count is
-- allowed: studios already on the plan stay, and only new arrivals (sign-ups,
-- which start on Solo, and moves onto the plan) are refused.
ALTER TABLE "plan_settings"
    ADD COLUMN "max_studios" INTEGER;
