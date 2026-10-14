-- Webhook events were logged without the studio they concern, so the platform
-- webhook log showed "—" in its Studio column. New events record it on
-- arrival; this fills it in for the ones already logged, from the stored
-- payload, using the same keys the handlers use. Data only, no schema change.

-- Checkout sessions carry the studio in their metadata.
UPDATE "webhook_events" w
SET "organization_id" = o."id"
FROM "organizations" o
WHERE w."organization_id" IS NULL
  AND w."payload" -> 'metadata' ->> 'organizationId' = o."id"::text;

-- Subscription and invoice events name our billing customer.
UPDATE "webhook_events" w
SET "organization_id" = o."id"
FROM "organizations" o
WHERE w."organization_id" IS NULL
  AND w."payload" ->> 'customer' = o."billing_customer_id";

-- account.updated is the connected account itself.
UPDATE "webhook_events" w
SET "organization_id" = o."id"
FROM "organizations" o
WHERE w."organization_id" IS NULL
  AND w."event_type" = 'account.updated'
  AND w."payload" ->> 'id' IN (
    o."stripe_account_id", o."pending_stripe_account_id", o."previous_stripe_account_id"
  );
