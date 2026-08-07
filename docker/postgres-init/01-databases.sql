-- Runs once, on first container start, against a fresh data volume.
--
-- booking_dev  is created by POSTGRES_DB.
-- booking_test is created here: the concurrency and DST suites need a database
-- they can truncate freely without destroying development data.
-- booking_shadow is Prisma's migration diffing workspace.

CREATE DATABASE booking_test  OWNER booking;
CREATE DATABASE booking_shadow OWNER booking;
