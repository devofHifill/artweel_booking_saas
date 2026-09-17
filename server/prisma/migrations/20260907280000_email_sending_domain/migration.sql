-- A studio's own sending address, and whether it can actually be used.
--
-- These two columns are ONE feature, not two. An earlier version of the
-- settings screen deliberately offered no from-address, on the grounds that
-- sending as a studio's domain needs SPF and DKIM records they publish and we
-- verify. That reasoning has not changed — what changes here is that the
-- verification STATE is now modelled, so the address can be stored and shown
-- without being used before it would work.
--
-- Resend rejects a from-address on an unverified domain with a 403. So using
-- `email_from_address` the moment somebody types it would not degrade
-- gracefully: every confirmation, reminder and receipt that studio sends would
-- fail, and the only place it would surface is the delivery log.
--
-- Hence the gate: the address is applied only while status is ACTIVE, and
-- until then mail goes out exactly as it does today — our address, their name
-- on it. NOT_SET is the default and describes every existing studio truthfully.
--
-- What is NOT here: any code that performs the verification. Creating the
-- domain with Resend, handing back DNS records and polling for them is a real
-- piece of work. This migration models the state so the screen can tell the
-- truth about it; it does not pretend the work is done.

CREATE TYPE "EmailDomainStatus" AS ENUM ('NOT_SET', 'PENDING', 'ACTIVE');

ALTER TABLE "organizations"
    ADD COLUMN "email_from_address" TEXT,
    ADD COLUMN "email_domain_status" "EmailDomainStatus" NOT NULL DEFAULT 'NOT_SET';

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_email_from_address_len"
        CHECK ("email_from_address" IS NULL OR char_length("email_from_address") <= 254);
