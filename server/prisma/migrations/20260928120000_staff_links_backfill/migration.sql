-- Staff added on Staff & Guides were missing two links the product relies on.
-- The code now makes both when a staff member is created or an invitation is
-- accepted; this repairs the records made before that.
--
-- No schema change. Both statements only ADD links that are missing, so
-- running this against a database that has none to add changes nothing.

/*
  1. Every staff member placed nowhere now works at every active location.

  An instructor with no `staff_locations` row is never offered for a One to one:
  the booking page always asks for availability AT a location, and the engine
  filters staff by it. No screen could add the row, so this was everybody added
  after setup.

  Unambiguous to repair, because "linked to nothing" was never a choice anybody
  could make — there was no way to make it. Staff already linked somewhere are
  left exactly as they are.
*/
INSERT INTO "staff_locations" ("id", "staff_id", "location_id")
SELECT gen_random_uuid(), s."id", l."id"
FROM "staff" s
JOIN "locations" l
  ON l."organization_id" = s."organization_id"
 AND l."is_active" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "staff_locations" sl WHERE sl."staff_id" = s."id"
)
ON CONFLICT ("staff_id", "location_id") DO NOTHING;

/*
  2. Staff records meet the logins they belong to.

  Accepting an invitation created a membership and never set `staff.user_id`,
  so My schedule — which finds your record by login — was empty for every
  instructor who signed in. Matched on email, and only to a user who is a
  MEMBER of that studio, which is what the code does from now on.

  Only unlinked rows are touched: a link somebody set by hand stays.

  Timezones are NOT repaired here. Staff created through the API defaulted to
  America/New_York, but a row saying New York cannot be told apart from one
  that means it, so that is fixed by editing the person — the Staff form now
  has a timezone field, and changing it moves their hours with it.
*/
UPDATE "staff" s
SET "user_id" = u."id"
FROM "users" u
JOIN "memberships" m ON m."user_id" = u."id"
WHERE s."user_id" IS NULL
  AND m."organization_id" = s."organization_id"
  AND u."email" = s."email";
