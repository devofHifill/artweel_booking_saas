-- MRR history, because it was never kept and cannot be reconstructed.
--
-- The dashboard computes MRR from `PLANS` times the studios that are ACTIVE
-- RIGHT NOW. That is correct for today and says nothing about any other day:
-- `organizations.plan` holds one value, the current one, and there is no
-- transition log behind it.
--
-- The Stripe webhook table looked like a way out and is not. Platform `setPlan`
-- and comping deliberately never touch Stripe (decision of 2026-08-17), so a
-- webhook-derived series would omit every admin-driven change and quietly
-- disagree with the MRR figure printed directly above it on the same screen. A
-- chart that contradicts its own headline is worse than no chart.
--
-- So: write it down daily, from the same source the headline uses. This table
-- starts empty and fills going forward. It cannot show last October and does
-- not pretend to.

-- ONE ROW PER ACTIVE STUDIO PER DAY, and none for anyone else.
--
-- Restricting rows to ACTIVE studios is what makes the movement arithmetic fall
-- out of a diff instead of needing a second table of events:
--
--   in today, not yesterday   -> new
--   in yesterday, not today   -> churned
--   in both, amount up        -> expansion
--   in both, amount down      -> contraction
--
-- A trialing or past-due studio contributes nothing to MRR, so it has no row,
-- exactly as it contributes nothing to the headline figure.
CREATE TABLE "mrr_daily_studio" (
    -- DATE, not a timestamp. Two snapshots taken on the same day are the same
    -- fact; the primary key below makes the writer idempotent so the hourly
    -- job can run all day without producing duplicates or drift.
    "date"            DATE NOT NULL,
    "organization_id" UUID NOT NULL,

    -- The plan and the amount are both snapshotted. `mrr_cents` is resolved
    -- from PLANS at write time and never recomputed, so changing a price later
    -- moves future rows only. Without this, a single pricing change would
    -- silently rewrite every month already on the chart.
    "plan"            "Plan" NOT NULL,
    "mrr_cents"       INTEGER NOT NULL,

    "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrr_daily_studio_pkey" PRIMARY KEY ("date", "organization_id")
);

-- The chart's only query shape: every row in a date window, read in order.
CREATE INDEX "mrr_daily_studio_date_idx" ON "mrr_daily_studio"("date");

-- CASCADE is deliberate, and it has a cost worth naming: hard-deleting a studio
-- also erases its contribution to every past day, so historical totals would
-- change retroactively. That is accepted because nothing in the product hard-
-- deletes an organization — suspension and cancellation both keep the row — and
-- an orphaned history row pointing at a studio nobody can look up is worse than
-- the alternative. If purging is ever added, this needs revisiting.
ALTER TABLE "mrr_daily_studio"
    ADD CONSTRAINT "mrr_daily_studio_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
