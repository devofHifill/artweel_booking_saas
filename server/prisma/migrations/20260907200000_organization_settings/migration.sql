-- The Settings screen, brought up to the prototype's.
--
-- Twelve columns, all nullable or defaulted, and every one of them is READ by
-- something. That is the whole rule this migration follows, because Settings
-- is the screen where a decorative control does the most damage: a tile on a
-- dashboard that lies is embarrassing, a SETTING that lies changes what an
-- operator believes their business is doing.
--
-- WHAT THE PROTOTYPE HAS THAT IS NOT HERE, and why:
--
--   * TAX RATE, TAX LABEL, TAX-INCLUSIVE, SERVICE FEE. Nothing in this product
--     computes tax — not priceBooking, not checkout, not receipts, not
--     reports. A studio that typed 7% into a field would believe it was
--     charging it, and every invoice for months would be wrong with nothing on
--     screen to say so. Tax is a real feature touching every money path; it
--     does not arrive as four columns.
--   * A PERMISSIONS MATRIX. Roles are enforced by middleware against a fixed
--     enum of four. Storing per-role toggles that nothing reads would let an
--     owner untick "Cancel booking" for the front desk and change nothing.
--   * OVERBOOKING BUFFER. Capacity is held by a CHECK constraint and a locked
--     row. A buffer column would be a number the database ignores.
--   * SMS PROVIDER, SENDER ID, SPF/DKIM STATUS, PAYOUT SCHEDULE, PROCESSING
--     FEE. Platform configuration or Stripe's to report, not a studio's to set.
--   * REQUIRE A SIGNED WAIVER. Waivers do not exist.

ALTER TABLE "organizations"
    -- Business identity. `name` is the trading name customers see; these are
    -- the rest of what a receipt needs and a confirmation currently cannot say.
    ADD COLUMN "legal_name"    TEXT,
    ADD COLUMN "address"       TEXT,
    ADD COLUMN "website"       TEXT,
    -- Free text rather than an enum: what a studio calls itself is not a list
    -- anybody can finish, and no code branches on it.
    ADD COLUMN "business_type" TEXT,

    -- Transactional email.
    --
    -- There is deliberately NO from-address column. Sending as a studio's own
    -- domain needs SPF and DKIM records they publish and we verify; offering
    -- the field without that machinery produces mail that silently lands in
    -- spam, which is worse than mail that visibly comes from us. `reply_to` is
    -- the lever that gets a customer's reply into their inbox and needs no DNS.
    ADD COLUMN "email_from_name" TEXT,
    ADD COLUMN "email_reply_to"  TEXT,
    ADD COLUMN "email_bcc"       TEXT,
    ADD COLUMN "email_footer"    TEXT,

    -- How the OPERATOR sees dates. Customers always get long, unambiguous
    -- ones; this is the dashboard's preference and nothing else.
    ADD COLUMN "date_format" TEXT NOT NULL DEFAULT 'MMM D, YYYY',
    ADD COLUMN "time_format" TEXT NOT NULL DEFAULT '12h',

    -- Defaults for NEW activities, not rules.
    --
    -- Notice and horizon are enforced per activity from service_types, which
    -- is what availability actually reads. These are only what the
    -- Create-activity form starts at, so a studio sets its house rule once
    -- instead of on every class. Changing them must never reach back and alter
    -- an activity somebody has already tuned by hand — if that is ever wanted
    -- it is a migration with a backfill, decided deliberately, not a side
    -- effect of editing a default.
    ADD COLUMN "default_min_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "default_max_horizon_days"   INTEGER NOT NULL DEFAULT 120;

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_legal_name_len"
        CHECK ("legal_name" IS NULL OR char_length("legal_name") <= 200),
    ADD CONSTRAINT "organizations_address_len"
        CHECK ("address" IS NULL OR char_length("address") <= 500),
    ADD CONSTRAINT "organizations_website_len"
        CHECK ("website" IS NULL OR char_length("website") <= 300),
    ADD CONSTRAINT "organizations_business_type_len"
        CHECK ("business_type" IS NULL OR char_length("business_type") <= 80),
    ADD CONSTRAINT "organizations_email_footer_len"
        CHECK ("email_footer" IS NULL OR char_length("email_footer") <= 1000),
    ADD CONSTRAINT "organizations_time_format_shape"
        CHECK ("time_format" IN ('12h', '24h')),
    -- Bounded at both ends. Zero notice is legitimate (a walk-in studio), but
    -- a horizon of zero would make every activity unbookable, and one of ten
    -- years fills the calendar picker with nothing.
    ADD CONSTRAINT "organizations_default_notice_range"
        CHECK ("default_min_notice_minutes" BETWEEN 0 AND 20160),
    ADD CONSTRAINT "organizations_default_horizon_range"
        CHECK ("default_max_horizon_days" BETWEEN 1 AND 730);
