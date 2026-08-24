-- S8 — disabling a user account.
--
-- Two nullable columns, no default, no backfill: every existing row is already
-- correct as NULL, which means "not disabled". The OLD code serving requests
-- mid-deploy never reads them, so this is safe against the rolling window the
-- deploy runbook cares about.
--
-- A TIMESTAMP rather than an `is_active` boolean. "When was this account
-- disabled" is a question somebody asks the first time a customer emails
-- saying they cannot log in, and a boolean has already discarded the answer.
-- Same reasoning as `revoked_at` on platform_admins and `suspended_by_platform_at`
-- on organizations.

ALTER TABLE "users"
    ADD COLUMN "disabled_at"     TIMESTAMPTZ(3),
    ADD COLUMN "disabled_reason" TEXT;

-- The login path filters on this, so it is worth an index — but only over the
-- rows that have it set, which is almost none of them. A full index on a column
-- that is NULL for every row but a handful is mostly empty pages.
CREATE INDEX "users_disabled_at_idx"
    ON "users" ("disabled_at")
    WHERE "disabled_at" IS NOT NULL;
