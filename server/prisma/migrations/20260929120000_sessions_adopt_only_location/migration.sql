-- Upcoming sessions with no location, in a studio that has exactly one, get
-- that location.
--
-- Once a studio has a location, the booking page asks for sessions AT it, so a
-- session with none matches nothing and is invisible to customers — confirmed
-- bookings included — while the dashboard lists it as normal. That happened to
-- every session scheduled before the studio's first location existed, and to
-- any scheduled later with "Where: Not set". The code now prevents both; this
-- repairs what is already there.
--
-- No schema change. Only rows that are unambiguous are touched:
--   * the studio has exactly ONE active location, so there is nowhere else the
--     session could be. Studios with several are left alone — which room is a
--     real choice, and a wrong guess sends customers to the wrong door.
--   * the session is upcoming. A class that already ran is history.
--   * the session is not part of a course; a cohort's venue is set on the
--     cohort, and course booking has no location step.
-- Running it again changes nothing.

UPDATE "sessions" s
SET "location_id" = only_loc."location_id"
FROM (
  SELECT "organization_id", MIN("id"::text)::uuid AS "location_id"
  FROM "locations"
  WHERE "is_active" = true
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
) only_loc
WHERE s."organization_id" = only_loc."organization_id"
  AND s."location_id" IS NULL
  AND s."course_series_id" IS NULL
  AND s."starts_at" >= now();
