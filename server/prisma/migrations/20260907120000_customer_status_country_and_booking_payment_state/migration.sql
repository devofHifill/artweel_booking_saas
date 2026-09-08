-- The Customers screen, brought up to the prototype's.
--
-- Two columns on customers and two on bookings. The bookings half needs
-- explaining, because on its face it undoes a decision this schema documents.

-- ---------------------------------------------------------------- customers

CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'VIP', 'BLOCKED');

ALTER TABLE "customers"
    -- Free text, not an ISO code. The studio types what it wants to read back
    -- in the list; nothing routes, taxes or validates on this, so a code would
    -- buy nothing and put a picker in front of a field people want to type in.
    ADD COLUMN "country" TEXT,

    -- DECORATIVE BY DESIGN, and that is the whole decision.
    --
    -- Nothing in any booking path reads this. BLOCKED is a note to whoever is
    -- on the desk, NOT a refusal: a status that silently rejected bookings
    -- would be a different feature entirely, and the studio could not tell it
    -- from a bug. If enforcement is ever wanted it needs its own decision, its
    -- own error message and its own tests — not a quiet read of this column.
    --
    -- NOT NULL DEFAULT 'ACTIVE' because every existing customer is exactly
    -- that, and a nullable status would make "unset" a fourth state that every
    -- filter and badge then has to render.
    ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "customers"
    ADD CONSTRAINT "customers_country_len"
        CHECK ("country" IS NULL OR char_length("country") <= 80);

-- ----------------------------------------------------------------- bookings

-- READ THIS BEFORE "FIXING" payment_state.
--
-- The comment above the Payment model says a previous implementation stored
-- payment_method, payment_status and transaction_id on `bookings`, and that it
-- was removed because those columns cannot represent a deposit plus a balance
-- plus a partial refund. That reasoning is still correct and payments are
-- still the truth: `paidCentsOf` over the payment rows is what any figure
-- shown as money must come from.
--
-- This column is NOT that. It is the counter's CLAIM — what the person taking
-- a walk-in ticked on the manual booking form — and it exists because the
-- studio wants to record "they said they will pay Friday" against a booking
-- that has no payment row at all. It can disagree with the payments, and when
-- it does the payments win everywhere money is displayed.
--
-- Requested deliberately on 2026-09-07 with that cost stated. It is a note,
-- not an accounting field, and no reporting query may read it.
--
-- NULLABLE, and null is not PENDING. Null means nobody claimed anything,
-- which is every booking the system creates for itself; PENDING means a human
-- looked at it and said it is unpaid. Collapsing the two would put a claim in
-- the mouth of the checkout.
CREATE TYPE "BookingPaymentState" AS ENUM ('PAID', 'PARTIALLY_PAID', 'PENDING');

ALTER TABLE "bookings"
    ADD COLUMN "payment_state" "BookingPaymentState",

    -- When, not whether. A timestamp costs the same as a boolean and answers
    -- the question a studio actually asks about a waiver.
    --
    -- This records that PAPER WAS SIGNED at the desk. It is not the waiver
    -- feature: nothing collects, stores or renders a document, and the public
    -- booking flow still does not ask. That decision stays open.
    ADD COLUMN "waiver_signed_at" TIMESTAMPTZ(3);
