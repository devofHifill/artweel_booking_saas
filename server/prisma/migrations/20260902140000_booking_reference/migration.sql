-- G5 — something a customer can quote on the phone.
--
-- A booking had no short human-readable handle. The only stable identifier was
-- cancel_token, which is 32 random bytes and must never be shown, and the uuid,
-- which nobody reads down a telephone.
--
-- GENERATED ALWAYS, derived from the row's own id, for three reasons:
--
--   1. Bookings are created in four places (bookSeats, bookAppointment, the
--      hold path, and the course fan-out). A column the database fills cannot
--      be forgotten by a fifth one added later.
--   2. Existing rows get one for free. No backfill, no ordering question, no
--      migration that behaves differently on a busy database than an empty one.
--   3. Any attempt to write it raises, which is the guardrail that keeps it
--      derived rather than drifting into a second identity for the booking.
--
-- Hex, uppercased. The alphabet is 0-9A-F, which contains no O, I or L — so the
-- digits 0 and 1 cannot be misread as letters when somebody reads it aloud.
--
-- DELIBERATELY NOT UNIQUE. Eight hex characters of a v4 uuid is 4.3 billion
-- values and a collision inside one studio is remote, but a unique index would
-- turn that remote event into a FAILED BOOKING. A reference is a convenience
-- for quoting, not a key: two bookings sharing one costs a studio a second
-- glance, where a rejected booking costs them a customer. Indexed for lookup,
-- not constrained.

ALTER TABLE "bookings"
    ADD COLUMN "reference" TEXT
    GENERATED ALWAYS AS (upper(substr(replace("id"::text, '-', ''), 1, 8))) STORED;

CREATE INDEX "bookings_organization_id_reference_idx"
    ON "bookings" ("organization_id", "reference");
