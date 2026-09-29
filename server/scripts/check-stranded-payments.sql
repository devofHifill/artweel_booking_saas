-- Payments stranded by the old reschedule. READ-ONLY: this changes nothing.
--
-- Until the fix in PR #9 (docs/ux-audit-findings.md #15), moving a booking —
-- from the dashboard calendar, or by the customer through the API — cancelled
-- it and created a NEW booking for the new time. Any payment stayed on the
-- cancelled original, and the refund path only looks at a booking's own
-- payments: if the customer later cancels the replacement, they are refunded
-- nothing.
--
-- A failed move left the same trail: the original cancelled and a
-- "-rollback" copy booked in its place.
--
-- One row per stranded payment. The fix for each is manual and needs a
-- decision (move the payment to the replacement, or refund it), so this only
-- lists them.
--
-- Run on a server:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < server/scripts/check-stranded-payments.sql

SELECT * FROM (
-- One row per payment, paired with the replacement booked closest after its
-- booking was cancelled — a customer moved twice in a minute must not have
-- each original matched to both replacements.
SELECT DISTINCT ON (p.id)
  o.name                         AS studio,
  c.name                         AS customer,
  c.email                        AS customer_email,
  st.name                        AS activity,
  orig.reference                 AS cancelled_ref,
  orig.id                        AS cancelled_booking_id,
  rep.reference                  AS replacement_ref,
  rep.id                         AS replacement_booking_id,
  rep.status                     AS replacement_status,
  rep.starts_at                  AS replacement_starts_at,
  rep.source                     AS moved_by,
  p.id                           AS payment_id,
  p.status                       AS payment_status,
  p.amount_cents - p.refunded_cents AS unrefunded_cents,
  p.currency,
  rep.created_at                 AS moved_at
FROM bookings rep
JOIN bookings orig
  ON  orig.organization_id = rep.organization_id
  AND orig.customer_id     = rep.customer_id
  AND orig.service_type_id = rep.service_type_id
  AND orig.id             <> rep.id
  AND orig.status          = 'CANCELLED'
  -- The original was cancelled, then the replacement made, moments apart.
  AND rep.created_at >= orig.updated_at - interval '1 second'
  AND rep.created_at <  orig.updated_at + interval '2 minutes'
JOIN payments p
  ON  p.booking_id = orig.id
  AND p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
  AND p.refunded_cents < p.amount_cents
JOIN customers     c  ON c.id  = rep.customer_id
JOIN service_types st ON st.id = rep.service_type_id
JOIN organizations o  ON o.id  = rep.organization_id
WHERE rep.source IN (
  'admin-reschedule', 'admin-reschedule-rollback',
  'reschedule', 'reschedule-rollback'
)
ORDER BY p.id, rep.created_at - orig.updated_at
) stranded
ORDER BY moved_at;
