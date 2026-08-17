-- S1 — platform-level (Artweel) authority.
--
-- Safe against the OLD code still serving requests during a deploy, which is
-- the rule in DEPLOY.md: `migrate deploy` runs before the new containers start.
-- Everything here is new, so its indexes and constraints build on an empty
-- relation and no existing table is touched. No index on bookings, sessions or
-- payments, so nothing needs CREATE INDEX CONCURRENTLY.

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_admins_user_id_idx" ON "platform_admins"("user_id");

-- One LIVE grant per human, while every revoked grant is kept as history.
--
-- This has to be a PARTIAL index. A plain UNIQUE on (user_id, revoked_at) would
-- read as equivalent and enforce nothing, because Postgres treats NULLs as
-- distinct in a unique index: every live grant has revoked_at = NULL, so the
-- constraint would allow unlimited duplicates of exactly the rows it exists to
-- prevent. A plain UNIQUE on (user_id) alone would go too far the other way and
-- make re-granting impossible after a revocation.
CREATE UNIQUE INDEX "platform_admins_user_id_live_key"
    ON "platform_admins"("user_id")
    WHERE "revoked_at" IS NULL;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Granting admin is recorded, but the grantor's own account being deleted must
-- not delete the record of the grant — hence SET NULL rather than CASCADE.
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_fkey"
    FOREIGN KEY ("granted_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
