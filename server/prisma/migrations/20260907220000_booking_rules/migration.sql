-- Studio-wide booking rules, for Settings → Booking Settings.
--
-- Every one of these is READ by something; none is a label. Where the
-- prototype's control could only have been decorative, it is implemented
-- differently rather than faked — see `overbooking_buffer` and
-- `require_waiver` below, which are the two worth reading before changing.

ALTER TABLE "organizations"
    -- How long a seat is held while somebody is inside checkout. Was an
    -- environment variable shared by every studio; `createHold` already took a
    -- per-call ttlMinutes override, so this simply gives it a caller.
    ADD COLUMN "seat_hold_minutes" INTEGER NOT NULL DEFAULT 15,

    -- Extra places sold beyond a class's real capacity, to cover no-shows.
    --
    -- READ THIS BEFORE IMPLEMENTING IT ANY OTHER WAY. The obvious reading is
    -- "allow seats_taken to exceed capacity by N", and that is exactly what
    -- must not happen: `CHECK (seats_taken <= capacity)` plus the locked-row
    -- update is one of Phase 0's settled guarantees, and it is the only thing
    -- standing between a popular class and being sold twice under concurrency.
    --
    -- So the buffer is applied when a SESSION IS CREATED — the session's
    -- capacity becomes the activity's capacity plus the buffer — and the
    -- constraint is untouched. The studio genuinely oversells by N, the
    -- database still refuses to oversell the session, and no concurrency
    -- guarantee is weakened to get there.
    ADD COLUMN "overbooking_buffer" INTEGER NOT NULL DEFAULT 0,

    ADD COLUMN "allow_same_day_bookings" BOOLEAN NOT NULL DEFAULT true,

    -- When false, a paid booking stays PENDING for a human to confirm.
    ADD COLUMN "auto_confirm_on_payment" BOOLEAN NOT NULL DEFAULT true,

    -- "Require a signed waiver before departure."
    --
    -- Waivers still do not exist as a feature: nothing collects, stores or
    -- renders a document, and the public flow does not ask. What DOES exist is
    -- `bookings.waiver_signed_at`, the desk's record that paper was signed.
    --
    -- So this flag does not block a booking — blocking on a document the
    -- product cannot collect would make the studio unbookable. It flags guests
    -- with no waiver on the register and the daily manifest, which is where
    -- somebody is standing in front of you and "before departure" is decided.
    ADD COLUMN "require_waiver" BOOLEAN NOT NULL DEFAULT false,

    ADD COLUMN "require_phone_at_checkout" BOOLEAN NOT NULL DEFAULT false,

    -- When false, child places are refused even on activities that price them.
    -- Defaults TRUE so no existing studio's child pricing stops working the
    -- moment this column appears.
    ADD COLUMN "allow_child_tickets" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "organizations"
    -- A hold of zero would release the seat before checkout loaded; an hour is
    -- already long enough to make a popular class look sold out to everybody
    -- else while one person hesitates.
    ADD CONSTRAINT "organizations_seat_hold_range"
        CHECK ("seat_hold_minutes" BETWEEN 1 AND 60),
    -- Bounded hard. An unbounded buffer is a studio quietly selling a class
    -- twice over and finding out on the day.
    ADD CONSTRAINT "organizations_overbooking_range"
        CHECK ("overbooking_buffer" BETWEEN 0 AND 20);
