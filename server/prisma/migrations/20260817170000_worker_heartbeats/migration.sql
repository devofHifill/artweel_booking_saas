-- S5 — worker heartbeats.
--
-- Safe against the OLD code still serving requests during a deploy: one new
-- table, nothing existing touched.
--
-- Why this exists at all: three sweep functions were written, tested, and called
-- by nothing outside the test suite for two days (C2.1). Waitlist offers held
-- their seats permanently and no trial ever ended, and every health check stayed
-- green throughout — because a queue that silently does nothing is
-- indistinguishable from a quiet queue. Separately, a deploy that shipped
-- nothing looked identical from outside: health green, all routes 200, a
-- genuinely fresh uptime.
--
-- A row per worker, stamped on every tick, is what tells those apart.

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    -- The worker's own name is the key. There is exactly one row per worker and
    -- it is upserted forever, so this table never grows.
    "name" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ(3),
    "last_finished_at" TIMESTAMPTZ(3),
    -- Kept even after a later successful run, so a fault that has since cleared
    -- is still visible rather than erased by the next quiet tick.
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("name")
);
