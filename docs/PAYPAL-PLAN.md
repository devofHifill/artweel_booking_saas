# PayPal plan: a studio takes payments through Stripe or PayPal

> **Status: parked, not started (2026-10-13).** Kept for future development.
> No code was written. Written against `main` at `dd22058`. Before picking it
> up, re-check the code references below (file names, the count of Stripe
> checks) and the PayPal facts, since both will have moved on.

Written 2026-10-13.

## What this is, and what it is not

**Each studio chooses ONE provider for customer payments: Stripe or PayPal.**
All of that studio's online payments — class bookings, deposits, courses,
class packs — go through the provider it chose. Refunds go back through
whichever provider took the money.

Not in scope, deliberately:

- **A customer choosing at checkout** (option 2). Doubles every money path
  for a modest gain. Revisit only if real studios lose bookings over it.
- **Studios paying bookaihub with PayPal.** The subscription stays on Stripe
  Billing. It is our money, not theirs, and nothing about this plan needs it.
- **Venmo, Pay Later, Apple Pay through PayPal.** PayPal can add these later
  on the same integration; none is needed to ship.

## Before any code: two blockers

1. **PayPal must approve us as a platform before a live payment is possible.**
   Multiparty ("Complete Payments Platform") integrations are built and
   tested in the sandbox freely, but live calls are refused with 401 until
   PayPal approves the partner, assigns a representative and works through
   their integration checklist with us. That is an approval queue, exactly
   like Stripe Connect's. **Apply on day one**, in parallel with the build;
   it is the long pole, not the code. Needs a PayPal **business** account for
   the platform.
2. **Merge `fix/refunds-simplify` first.** It rewrites refunds in
   `payment.service.ts`, the file this work changes most. Building PayPal on
   `main` as it stands means rebuilding the refund half after that merge.

## How PayPal differs from Stripe, and what each difference decides

| | Stripe today | PayPal | Consequence |
|---|---|---|---|
| **When money moves** | On Stripe's page; we learn from `checkout.session.completed` | When **we** call *capture* after the customer approves the order | We capture **only after re-checking the seat hold**. A customer returning after their hold lapsed is not charged at all — better than Stripe, where they are charged and then refunded |
| **Carrying context** | `metadata` map on the session, echoed on the webhook | One short `custom_id` per order | The checkout context moves into **our database**: `custom_id` is our Payment id, and the hold/customer/seat details live on our rows. Cleaner than echoing them through a third party anyway |
| **Order lifetime** | Session `expires_at`, 30-minute floor | An approved order not captured within a few hours is reversed (one PayPal page says 3 hours; **confirm in sandbox**) | Our hold, not PayPal's clock, decides. `CHECKOUT_HOLD_MIN_MINUTES = 32` is Stripe's floor and must not be applied to PayPal |
| **Onboarding** | Connect Express, account links | Partner Referrals: we create a referral, the owner signs in or signs up on PayPal, PayPal returns their merchant id | A studio with an existing PayPal business account just logs in and grants consent — likely faster than Stripe for them |
| **"Can take payments"** | `charges_enabled` via `account.updated` | `payments_receivable` and `primary_email_confirmed` from the merchant-integration status call, plus onboarding and consent-revoked webhooks | Same shape as `refreshConnectStatus`; same rule that a missed webhook must never leave a studio stuck |
| **Acting for the studio** | `Stripe-Account` header | `PayPal-Auth-Assertion` (an unsigned JWT naming the studio's merchant id) + our partner attribution id | Every refund and capture on a studio's behalf carries it |
| **Webhook verification** | Local signature check, synchronous | Signature verified with PayPal (an API call or certificate check) — **asynchronous** | `PaymentProvider.verifyWebhook` becomes async. Separate route: `/webhooks/paypal` |
| **Idempotency** | `Idempotency-Key` | `PayPal-Request-Id` | Same keys we already derive (`checkout_<holdId>`, `refund_<scope>_<paymentId>`) |
| **Who the money belongs to** | Direct charges on the studio's account | Same: the studio is the payee, we take no fee | Unchanged position: we are never the merchant of record |

Cards without a PayPal account: PayPal's checkout normally offers a "debit
or credit card" option to guests, so a PayPal studio is not limited to
customers who have PayPal. **Confirm what US buyers actually see in sandbox**
before saying so in any guide or marketing copy.

## Where the code is Stripe-shaped today

- **One provider per process.** `provider.registry.ts` picks Stripe or the
  fake at startup. It has to become *per studio* (choose by
  `organization.paymentProvider`) and *per payment* (refund through
  `payment.provider`, never the studio's current choice).
- **73 references to `stripeAccountId` / `stripeChargesEnabled` in 14
  files** — booking admin, integrations, onboarding checklist, public booking
  page, storefront, shell/alert bell, and five platform-admin services. Each
  is really asking "can this studio take money, and where does it go?".
- `handleWebhook` hard-codes `provider: 'stripe'` on the dedupe table (the
  column already exists and is part of the unique key — good).
- `Payment.provider` and `providerAccountId` already exist — good. The
  `providerPaymentIntentId` column will hold PayPal's **capture id**; the name
  is Stripe's but the meaning ("the thing a refund is issued against") holds.
  Comment it rather than rename it.
- The provider dropdown in Settings → Payment Settings exists but is
  decorative: `value="stripe" disabled`, stored nowhere.

## Stages

Each stage leaves `main` shippable. Rough sizes assume one developer.

### P0 — Groundwork, no behaviour change (2–3 days)

1. `organizations.payment_provider` (`STRIPE` | `PAYPAL`, default `STRIPE`),
   additive migration.
2. One helper, `paymentAccount(org)` → `{ provider, accountId, canCharge,
   canPayOut }`, and every one of the 73 references goes through it. This is
   the change that prevents the classic miss: a sixth screen that still asks
   Stripe whether a PayPal studio can take money, and tells its customers no.
3. Provider registry keyed by name; refunds pick by `payment.provider`.
4. `verifyWebhook` async; `handleWebhook(provider, event)`.

Exit: the full suite passes unchanged. Nothing user-visible.

### P1 — The PayPal adapter (3–4 days)

`paypal.provider.ts` implementing the interface, thin like the Stripe one:
OAuth token caching, Partner Referrals, merchant-integration status, Orders
create/capture, capture refund, webhook verification. A `FakePayPalProvider`
for tests, as deterministic as the Stripe fake.

Config: `PAYPAL_ENV` (sandbox|live), `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `PAYPAL_PARTNER_MERCHANT_ID`, `PAYPAL_BN_CODE`,
`PAYPAL_WEBHOOK_ID`. Production boots without them (PayPal is optional); a
studio choosing PayPal on a deployment without them is refused with a clear
message.

### P2 — Choosing a provider and connecting PayPal (3 days)

- Columns: `paypal_merchant_id` (unique), `paypal_payments_receivable`,
  `paypal_email_confirmed`, `paypal_onboarded_at`, plus the referral
  tracking id.
- Settings → Payment Settings: the dropdown becomes real. Connect / Finish
  setup / Refresh status work for PayPal exactly as for Stripe.
- **Switching rules.** Refused while any payment is `PENDING` or any paid
  checkout hold is live — a payment in flight must complete where it started.
  Allowed otherwise; past payments keep refunding through their own provider,
  so **the old provider's account fields are kept, not cleared**.
- Webhooks: onboarding completed, consent revoked (a studio that revokes us
  must stop taking payments immediately, and the alert bell must say why).

### P3 — Checkout (4–5 days)

Bookings, courses and class packs, in that order, each through the same
`startCheckout` / `startPackCheckout` entry points branching on the
provider at the edge only.

- Create order → redirect to PayPal → customer approves → returns to
  `/public/:slug/paypal/return` → **we capture under the hold's lock**, then
  convert the hold exactly as `onCheckoutCompleted` does today.
- `CHECKOUT.ORDER.APPROVED` / `PAYMENT.CAPTURE.COMPLETED` webhooks cover the
  customer who approves and closes the tab: the webhook captures (or records
  the capture) instead. Capture is idempotent via `PayPal-Request-Id`, so the
  return and the webhook racing each other capture once.
- Cancel / abandon → hold released, as for `checkout.session.expired`.
- Every gate test that exists for Stripe checkout gets a PayPal twin:
  duplicate webhook, webhook before redirect, redirect before webhook, hold
  expired before approval, course all-or-nothing, pack credits minted once.

### P4 — Refunds and disputes (2–3 days)

- `issueRefunds` dispatches per payment's provider. Partial refunds work the
  same way (PayPal supports them on a capture).
- `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` keep our rows honest when a
  studio refunds from inside PayPal rather than from bookaihub.
- Disputes are the studio's to answer in PayPal, as with Stripe. We record
  that one was opened so the payment row does not claim a clean success.

### P5 — Every surface that names a provider (3 days)

Integrations card, setup checklist step, alert bell, Payments list, booking
page copy, platform admin (studio detail Integrations section with
Refresh / Reset for PayPal, the Integrations overview, Webhooks), both
Stripe guides plus a PayPal section in each, `DEPLOY.md`.

**Marketing copy says nothing about PayPal until P6 is done** — the existing
rule that the site may not describe unshipped features, enforced by a test.

### P6 — Sandbox walkthrough, then live (2 days of ours + PayPal's queue)

A stranger's studio, start to finish in the PayPal sandbox: choose PayPal,
onboard, book and pay, book a deposit, enrol in a course, buy a pack, cancel
and refund each, revoke consent and watch the studio stop taking money.
Recorded — PayPal's go-live checklist asks for exactly this kind of evidence.

Live needs PayPal's approval (blocker 1), live credentials configured by our
PayPal representative, and one real low-value payment refunded end to end.

**Total: roughly 3–4 weeks of build**, plus PayPal's approval time, which
we do not control.

## Decisions needed from Suren

1. **Who applies for PayPal partner approval, and under which business?**
   It has to start now to not be the thing we wait on.
2. **Can a studio switch provider after taking payments?** The plan allows it
   (with the in-flight rule above). Forbidding it is simpler but strands a
   studio that picked wrong.
3. **Default for new studios** — Stripe (as today), or ask during setup?
   Recommendation: Stripe default, PayPal as the alternative in Payment
   Settings, so the setup checklist does not grow a question most studios
   do not need.
4. **Plan gating** — available on every plan, or Studio/Pro only?

## Unknowns to settle in the sandbox, before P3

- How long an approved-but-uncaptured order really lives.
- Exactly what a US guest buyer sees (card without a PayPal account?).
- Whether referral links and merchant status calls behave fully in sandbox
  before partner approval.
- The current onboarding webhook names for this integration type.

Sources checked 2026-10-13:
[PayPal multiparty integration checklist](https://developer.paypal.com/docs/multiparty/integration-checklist),
[Configure sandbox and live accounts](https://developer.paypal.com/platforms/create-account/),
[Issue a refund (platforms)](https://developer.paypal.com/platforms/checkout/issue-refund),
[Payment lifecycle](https://developer.paypal.com/platforms/checkout/apm/reference/lifecycle.md),
[Stripe: PayPal payments](https://docs.stripe.com/payments/paypal.md).
