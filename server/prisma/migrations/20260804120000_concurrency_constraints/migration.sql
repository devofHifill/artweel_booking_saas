-- ===========================================================================
-- W0.5 — Concurrency and integrity
--
-- Everything in this file exists because application-level checking is not
-- good enough. The pattern being eliminated is:
--
--     SELECT seats_taken FROM sessions WHERE id = $1;   -- reads 8 of 10
--     ... application decides there is room ...
--     INSERT INTO bookings ...;                          -- so does the other
--                                                        -- request. Now 12/10.
--
-- Two requests interleave between the read and the write and both win. On a
-- single-studio WordPress install this fires approximately never. On a
-- multi-tenant SaaS where a popular class opens at 9am, it fires constantly.
--
-- Prisma cannot express EXCLUDE constraints, CHECK constraints or triggers,
-- so they live here as hand-written SQL. That is a limitation of the ORM,
-- not a reason to enforce these rules anywhere less reliable.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Interval sanity
--
-- tstzrange() throws if lower > upper, so every table carrying an interval
-- must guarantee ordering before the exclusion constraints below can be
-- trusted. These also catch plain data-entry bugs at the door.
-- ---------------------------------------------------------------------------

ALTER TABLE "staff_time_blocks"
  ADD CONSTRAINT "staff_time_blocks_interval_valid"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "resource_allocations"
  ADD CONSTRAINT "resource_allocations_interval_valid"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_interval_valid"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_interval_valid"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "booking_holds"
  ADD CONSTRAINT "booking_holds_interval_valid"
  CHECK ("starts_at" < "ends_at");


-- ---------------------------------------------------------------------------
-- 2. No staff member can be in two places at once
--
-- This is the single most important constraint in the system.
--
-- The plugin this replaces used:
--     UNIQUE KEY unique_slot (staff_id, booking_date, booking_time)
--
-- which failed in three separate ways:
--   (a) it only caught IDENTICAL start times, so a 60-minute booking at 10:00
--       and a 30-minute booking at 10:30 both inserted happily;
--   (b) event bookings deliberately stored staff_id = NULL, and MySQL permits
--       unlimited NULLs in a unique index, so events had no protection at all;
--   (c) it could not see across tables.
--
-- An EXCLUDE ... USING gist with a range operator catches TRUE OVERLAP, and
-- because appointments and sessions both write into this one table, it also
-- catches the cross-type collision Postgres could not otherwise see: an
-- instructor with a 2pm private lesson AND a 2pm group class.
--
-- btree_gist is what allows equality (staff_id) and overlap (tstzrange) to
-- share a single GiST index.
--
-- '[)' bounds are deliberate: a block ending at 11:00 and one starting at
-- 11:00 are adjacent, not overlapping. Back-to-back classes are legal.
-- ---------------------------------------------------------------------------

ALTER TABLE "staff_time_blocks"
  ADD CONSTRAINT "staff_time_blocks_no_overlap"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  );


-- ---------------------------------------------------------------------------
-- 3. Exclusive resources cannot be double-allocated
--
-- A kiln, a room or a van cannot be shared for ANY overlapping period. A
-- fourteen-hour glaze firing owns that kiln for fourteen hours.
--
-- Counted resources (eight wheels) are deliberately NOT covered here —
-- overlap is legal up to `quantity`, so their correctness comes from a
-- locked SUM in the booking transaction instead. `exclusive` is denormalised
-- onto this table because a partial constraint predicate can only reference
-- columns of its own row; the trigger below keeps it honest.
-- ---------------------------------------------------------------------------

ALTER TABLE "resource_allocations"
  ADD CONSTRAINT "resource_allocations_no_exclusive_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("exclusive");

-- Never trust the caller to set `exclusive` correctly. Writing `false` by
-- mistake would silently exempt a row from the constraint above, which is
-- exactly the kind of quiet failure this phase exists to prevent.
CREATE OR REPLACE FUNCTION "sync_resource_allocation_exclusive"()
RETURNS TRIGGER AS $$
BEGIN
  SELECT r."is_exclusive" INTO NEW."exclusive"
  FROM "resources" r
  WHERE r."id" = NEW."resource_id";

  IF NEW."exclusive" IS NULL THEN
    RAISE EXCEPTION 'resource % does not exist', NEW."resource_id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "resource_allocations_set_exclusive"
  BEFORE INSERT OR UPDATE OF "resource_id" ON "resource_allocations"
  FOR EACH ROW
  EXECUTE FUNCTION "sync_resource_allocation_exclusive"();


-- ---------------------------------------------------------------------------
-- 4. A session can never be oversold
--
-- `seats_taken` counts confirmed bookings PLUS live holds. Every mutation
-- happens under SELECT ... FOR UPDATE on the session row, which serialises
-- concurrent writers; this CHECK is the backstop that makes an oversell
-- impossible even if some future code path forgets the lock.
--
-- The gate test fires 100 simultaneous requests at the last 5 seats and
-- requires exactly 5 winners.
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_capacity_positive"
  CHECK ("capacity" > 0);

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_seats_within_capacity"
  CHECK ("seats_taken" >= 0 AND "seats_taken" <= "capacity");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_seats_positive"
  CHECK ("seats" > 0);

ALTER TABLE "booking_holds"
  ADD CONSTRAINT "booking_holds_seats_positive"
  CHECK ("seats" > 0);

ALTER TABLE "resource_allocations"
  ADD CONSTRAINT "resource_allocations_quantity_positive"
  CHECK ("quantity" > 0);


-- ---------------------------------------------------------------------------
-- 5. A booking is either seat-based or staff-based, never both and never
--    neither
--
-- The plugin allowed staff_id to be NULL for events without recording that a
-- session was responsible instead, so a row that belonged to nothing was
-- indistinguishable from a row that had lost its staff assignment.
-- ---------------------------------------------------------------------------

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_exactly_one_target"
  CHECK (num_nonnulls("session_id", "staff_id") = 1);


-- ---------------------------------------------------------------------------
-- 6. Expiry sweep support
--
-- The hold-release job scans for live holds that have timed out. A partial
-- index keeps that scan proportional to the number of OPEN holds rather than
-- to every hold ever created.
-- ---------------------------------------------------------------------------

CREATE INDEX "booking_holds_live_expiry_idx"
  ON "booking_holds" ("expires_at")
  WHERE "released_at" IS NULL;
