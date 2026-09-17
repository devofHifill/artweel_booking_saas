-- Whether a studio wants an automated message sent at all.
--
-- NOT the same thing as notification_templates.is_active, which sits one table
-- over and looks like it would do. That flag chooses between a studio's own
-- wording and the built-in text: with it off the message STILL SENDS, it just
-- sends the default. Reusing it as an on/off switch would have quietly changed
-- what it means for anybody already relying on it, and the two failures are
-- very different — wrong words versus no message.
--
-- ABSENT MEANS ON, and that is the whole design:
--
--   * No backfill. Every existing studio keeps sending exactly what it sends
--     today, with no rows written and nothing to get wrong.
--   * A template key added in a later release is live everywhere immediately,
--     rather than depending on a migration remembering to insert a row for it.
--   * Turning something back on can DELETE the row rather than update it, so
--     the table only ever holds deliberate exceptions.
--
-- Per template key rather than per channel. "Do we send a 2-hour reminder" is
-- the question an owner actually asks; "do we send it by SMS" is answered by
-- the customer's own consent, which is not the studio's to override.
--
-- Enforcement is in the OUTBOX WORKER, not at enqueue. Messages are created in
-- half a dozen places and a check at each one is a check somebody will forget
-- to add to the seventh; `processBatch` is the single point every message
-- passes through on its way out. A suppressed message is marked SKIPPED rather
-- than deleted, so the delivery log can show the studio what did not go and
-- why — a message that silently never existed is unanswerable when a customer
-- asks why nobody told them.
CREATE TABLE "notification_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_rules_organization_id_template_key_key"
    ON "notification_rules"("organization_id", "template_key");

ALTER TABLE "notification_rules"
    ADD CONSTRAINT "notification_rules_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
