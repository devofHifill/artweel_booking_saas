/**
 * Money for people to read, one way (FB-17).
 *
 * Whole amounts without cents ("$95"), anything else with them ("$95.50"),
 * in the studio's currency. Every server-rendered surface (booking page,
 * storefront, emails, texts, the printed manifest, the Stripe line) used its
 * own copy of this, and two had drifted: the Stripe deposit line had no
 * currency symbol at all. The dashboard's `money()` in client/src/lib/api.ts
 * and the booking page script follow the same rule.
 */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
