-- S2 — the platform audit log.
--
-- Safe against the OLD code still serving requests during a deploy: one new
-- table, nothing existing touched, no index on bookings, sessions or payments.

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "organization_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_audit_log_organization_id_created_at_idx"
    ON "platform_audit_log"("organization_id", "created_at");

CREATE INDEX "platform_audit_log_actor_user_id_created_at_idx"
    ON "platform_audit_log"("actor_user_id", "created_at");

CREATE INDEX "platform_audit_log_created_at_idx"
    ON "platform_audit_log"("created_at");

-- NO FOREIGN KEYS on actor_user_id or organization_id, on purpose.
--
-- An audit row has to outlive what it refers to, and stopping that is precisely
-- what a foreign key does. ON DELETE SET NULL would preserve the row and erase
-- the actor — the one field it exists to record. ON DELETE CASCADE would delete
-- the evidence together with the account or the studio. Both are worse than no
-- constraint, and S11 (archive/purge) makes deletion a real future event rather
-- than a hypothetical one. actor_email is denormalised for the same reason: a
-- bare uuid whose user row is gone tells a human nothing.

-- An empty action would make a row unreadable and unfilterable, and there is no
-- legitimate caller for one. This also gives the suite a way to force the audit
-- insert to fail on purpose, which is how the "a failed audit rolls back the
-- action" case is tested — without it, that direction is untestable and the
-- same-transaction guarantee rests on reading the code.
ALTER TABLE "platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_action_not_empty"
    CHECK (length("action") > 0);

ALTER TABLE "platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_target_type_not_empty"
    CHECK (length("target_type") > 0);
