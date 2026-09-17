-- S9 — invitations.
--
-- A new table only. The OLD code serving requests mid-deploy never reads it,
-- so this is safe against the rolling window.
--
-- This is what makes ADMIN, INSTRUCTOR and FRONT_DESK reachable. Signup only
-- ever mints an OWNER, and `inviteMemberSchema` has sat in auth.schema.ts
-- imported by nothing since W1.1 — so three of the four roles have been
-- enforced everywhere and grantable nowhere.

CREATE TABLE "invitations" (
    "id"                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id"    UUID           NOT NULL,
    "email"              TEXT           NOT NULL,
    "name"               TEXT           NOT NULL,
    "role"               "MembershipRole" NOT NULL,
    "token_hash"         TEXT           NOT NULL UNIQUE,
    "expires_at"         TIMESTAMPTZ(3) NOT NULL,
    "invited_by_user_id" UUID           NOT NULL,
    "accepted_at"        TIMESTAMPTZ(3),
    "accepted_user_id"   UUID,
    "revoked_at"         TIMESTAMPTZ(3),
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "invitations_invited_by_user_id_fkey"
        FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "invitations_accepted_user_id_fkey"
        FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

-- Ownership is TRANSFERRED between people who already have accounts; it is not
-- handed to somebody who has not yet clicked a link. Asserted here as well as
-- in zod because a row reaching this table any other way — a fixture, a psql
-- session — must not be able to mint an owner on acceptance.
ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_role_not_owner" CHECK ("role" <> 'OWNER');

/*
  ONE OPEN INVITATION PER PERSON PER STUDIO.

  Partial, so it constrains only invitations that are still live — a withdrawn
  or accepted one must not block inviting the same person again later, which is
  an ordinary thing to want (they left, they came back).

  On lower(email), because everything else in this codebase treats an address
  case-insensitively: `login` lowercases before lookup, and `upsertCustomer`
  does the same. Without the lower() here, Sam@studio.test and sam@studio.test
  would be two open invitations to one person, and whichever they clicked would
  leave the other dangling.
*/
CREATE UNIQUE INDEX "invitations_open_one_per_email"
    ON "invitations" ("organization_id", lower("email"))
    WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

CREATE INDEX "invitations_organization_id_created_at_idx"
    ON "invitations" ("organization_id", "created_at");

-- The expiry sweep.
CREATE INDEX "invitations_expires_at_idx" ON "invitations" ("expires_at");
