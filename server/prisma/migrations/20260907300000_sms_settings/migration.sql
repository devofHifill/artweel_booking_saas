-- Per-studio SMS settings.
--
-- THE INVERSION, first, because it is the thing that will bite somebody.
--
-- `config.SMS_QUIET_START_HOUR` and `SMS_QUIET_END_HOUR` default to 8 and 21,
-- and despite their names they describe the window in which texts MAY be
-- sent: applyQuietHours returns the time unchanged when the local hour is
-- between them. The screen an operator uses says the opposite thing — "quiet
-- hours from 21:00 to 08:00" — because that is how a person thinks about it.
--
-- These columns store what the OPERATOR sets. The inversion happens once, in
-- applyQuietHours, and nowhere else. Getting this backwards does not fail
-- loudly; it sends somebody a text at three in the morning.
--
-- The defaults below are exactly equivalent to the existing config defaults,
-- so no studio's behaviour changes when this migration lands.

ALTER TABLE "organizations"
    -- When false, SMS rows are marked SKIPPED at send time rather than
    -- delivered — the same treatment, and the same reasoning, as a switched
    -- off automation: the studio must be able to see what did not go out.
    ADD COLUMN "sms_enabled" BOOLEAN NOT NULL DEFAULT true,

    -- Stored, and deliberately NOT used yet.
    --
    -- The Twilio number is platform configuration, and an alphanumeric sender
    -- must be registered with the carriers per studio — the same A2P 10DLC
    -- queue that has US SMS blocked entirely. This records what a studio wants
    -- registered; it does not pretend to have registered it.
    ADD COLUMN "sms_sender_id" TEXT,

    ADD COLUMN "sms_quiet_from_hour" INTEGER NOT NULL DEFAULT 21,
    ADD COLUMN "sms_quiet_to_hour"   INTEGER NOT NULL DEFAULT 8;

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_sms_quiet_from_range"
        CHECK ("sms_quiet_from_hour" BETWEEN 0 AND 23),
    ADD CONSTRAINT "organizations_sms_quiet_to_range"
        CHECK ("sms_quiet_to_hour" BETWEEN 0 AND 23),
    -- Equal hours would mean a quiet period of either zero or twenty-four
    -- hours depending on which way you read it, and the two answers are
    -- "every text goes" and "no text ever goes".
    ADD CONSTRAINT "organizations_sms_quiet_not_equal"
        CHECK ("sms_quiet_from_hour" <> "sms_quiet_to_hour"),
    -- Twilio alphanumeric senders are 11 characters, letters and digits.
    ADD CONSTRAINT "organizations_sms_sender_shape"
        CHECK ("sms_sender_id" IS NULL OR "sms_sender_id" ~ '^[A-Za-z0-9 ]{1,11}$');
