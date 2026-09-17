-- S7 — read-only support sessions.
--
-- A new table and nothing else. No column is added to an existing table and no
-- existing behaviour changes, so the OLD code serving requests mid-deploy is
-- unaffected: it never issues a support token, so it never reads this.
--
-- The row is what makes a support session revocable. The token is a JWT and so
-- is unrevokable on its own; `authenticate` reads this row on every request
-- carrying one, which turns "ended_at is set" into an immediate hard stop
-- rather than something that takes effect whenever the token happens to expire.

CREATE TABLE "support_sessions" (
    "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" UUID         NOT NULL,
    "actor_user_id"   UUID         NOT NULL,
    "actor_email"     TEXT         NOT NULL,
    "reason"          TEXT         NOT NULL,
    "read_only"       BOOLEAN      NOT NULL DEFAULT true,
    "expires_at"      TIMESTAMPTZ(3) NOT NULL,
    "ended_at"        TIMESTAMPTZ(3),
    "read_count"      INTEGER      NOT NULL DEFAULT 0,
    "write_count"     INTEGER      NOT NULL DEFAULT 0,
    "endpoints"       JSONB,
    "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_sessions_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "support_sessions_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- A reason that can be satisfied with one character records only that somebody
-- typed a character. Asserted here as well as in zod because this column is the
-- entire point of the table: "who" and "what" are usually recoverable from
-- other evidence afterwards, "why" never is.
ALTER TABLE "support_sessions"
    ADD CONSTRAINT "support_sessions_reason_len"
    CHECK (char_length("reason") >= 8 AND char_length("reason") <= 500);

-- The banner query: is anyone inside this studio right now.
CREATE INDEX "support_sessions_organization_id_expires_at_idx"
    ON "support_sessions" ("organization_id", "expires_at");

-- "What has this operator been doing", for the audit surface.
CREATE INDEX "support_sessions_actor_user_id_created_at_idx"
    ON "support_sessions" ("actor_user_id", "created_at");
