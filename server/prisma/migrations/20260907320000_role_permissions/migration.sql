-- Per-studio role permissions, and a MANAGER role to go with them.
--
-- THE SAFETY PROPERTY, first, because everything else depends on it: the
-- defaults in `lib/permissions.ts` reproduce exactly what requireAdmin,
-- requireFrontDesk and requireMember allowed before this table existed. A
-- studio that never opens the permissions screen behaves identically to
-- yesterday, and this table only ever holds deliberate exceptions.
--
-- That is why there is no backfill. Inserting a row per role per permission
-- would make "no row" mean nothing, and the first bug in the defaults would be
-- frozen into every studio's data instead of being one edit away.
--
-- OWNER IS NEVER STORED. An owner can always do everything; a row saying
-- otherwise is how somebody locks themselves out of their own studio with no
-- way back in. The screen shows their column ticked and disabled for the same
-- reason.

-- Added, not replacing anything. INSTRUCTOR keeps its name in the database —
-- the screen calls it Guide, which is the customer-facing word, and renaming
-- an enum value in place would rewrite every membership row for a label.
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'MANAGER';

CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- One answer per role per permission per studio. Two rows disagreeing would
-- be resolved by whichever the query happened to return first.
CREATE UNIQUE INDEX "role_permissions_organization_id_role_permission_key"
    ON "role_permissions"("organization_id", "role", "permission");

-- Every read is "the exceptions for this studio", loaded once per request.
CREATE INDEX "role_permissions_organization_id_idx"
    ON "role_permissions"("organization_id");

ALTER TABLE "role_permissions"
    ADD CONSTRAINT "role_permissions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- An owner row must not exist even by accident: the application refuses to
-- write one, and this makes the database refuse too.
ALTER TABLE "role_permissions"
    ADD CONSTRAINT "role_permissions_never_owner"
        CHECK ("role" <> 'OWNER');
