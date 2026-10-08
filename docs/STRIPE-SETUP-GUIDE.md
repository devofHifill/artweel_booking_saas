# Stripe setup guide — superadmin and studio operator

Everything needed to take money through bookaihub, start to finish, on both
sides: what the **superadmin** (the platform — us) sets up once in Stripe and on
the servers, and what each **studio operator** (owner or admin of a studio)
does to start getting paid.

There are two separate Stripe relationships, and most confusion comes from
mixing them up:

| | Who pays whom | Stripe feature | Where it lives in bookaihub |
|---|---|---|---|
| **Studio payments** | A customer pays the studio for a booking | **Connect** (Express dashboard, direct charges) | Studio: Integrations, Settings → Payment Settings |
| **Subscription billing** | The studio pays bookaihub 39 / 89 / 189 a month | **Billing** (Checkout + customer portal) on our own account | Studio: Plan and billing (`/billing`) |

Money for bookings goes straight into the studio's own Stripe balance. We never
hold it and take no application fee.

---

## Part A — Superadmin (platform) setup

Do every step in **test mode / sandbox** first, finish Part B against it, and
only then repeat for live mode (A9). Test and live are separate worlds in
Stripe: keys, Connect settings, webhook destinations and connected accounts do
not carry over.

### A1. Stripe account

1. Sign in at <https://dashboard.stripe.com> with the platform's Stripe account
   (the one the bookaihub keys belong to).
2. Top-left account switcher → make sure you are in the right account, and in
   the **sandbox / Test mode** (orange "Test mode" banner).
3. **Settings → Business → Public details**: set the public business name
   (**bookaihub**), support email, support phone and website
   (`https://bookaihub.com`). Studios see this name on Stripe's onboarding
   page ("bookaihub uses Stripe for secure payments").

### A2. Turn on Connect

1. Left nav → **Connect** (or **More → Connect**) → **Get started** if Connect
   has never been set up.
2. Platform type: **Platform** (studios sell their own services to their own
   customers; we provide software). Not "Marketplace".
3. When asked how connected accounts are set up, choose the options that match
   what the code creates:
   - Dashboard for connected accounts: **Express**
   - Who pays Stripe's processing fees: **the platform** (`fees_collector:
     application`)
   - Who is liable for negative balances / losses: **the platform**
     (`losses_collector: application`)
   - Charge type: **Direct charges**
   - Onboarding: **Stripe-hosted**
4. **Platform profile** (Connect → Settings → Platform profile) exists only in
   **live mode** — in the sandbox Stripe shows "Settings are hidden". Complete
   it when going live (A9); Stripe will not create live connected accounts
   until it is done.
5. **Connect → Settings → Branding**: upload the bookaihub icon, set the brand
   colour and business name. This styles the onboarding pages and the studio's
   Express dashboard.
6. **Connect → Settings → Onboarding options / Countries**: make sure the
   **United States** is allowed (the app creates US accounts —
   `STRIPE_ACCOUNT_COUNTRY=US`).
7. **Connect → Settings → Onboarding options → Countries**, section "Add the
   products they need": tick **Payments** ("Let accounts accept payments from
   their own customers") alongside **Transfers**. The app requests card
   payments itself, so this is not blocking, but it keeps the dashboard's
   defaults in line with what the app creates.
8. **Connect → Settings → Express dashboard**: leave payouts visible so studios
   can see their balance and payouts.

> **Accounts v2.** Stripe now refuses the old Accounts v1 `accounts.create`
> call for new Connect platforms ("Stripe no longer recommends Accounts v1 for
> new Connect integrations"). The app creates connected accounts through
> **Accounts v2** (`POST /v2/core/accounts`) and uses the v1 APIs for
> everything else, which Stripe supports. Nothing to configure for this — but
> if you ever see that message in bookaihub, the server is running code older
> than the fix.

### A3. API keys

1. **Developers → API keys** (test mode).
2. Copy the **Secret key** (`sk_test_…`). This becomes `STRIPE_SECRET_KEY`.
3. The publishable key is not used — every Stripe page is hosted by Stripe.
4. Never paste the secret key into chat, tickets or the repo.

### A4. Webhook destinations — two of them

Stripe scopes each destination to **either** "Your account" **or**
"Connected accounts" and gives each its own signing secret. We need both.

**Workbench → Webhooks → Create an event destination**, twice:

| Setting | Destination 1: platform | Destination 2: connect |
|---|---|---|
| Name (suggested) | `bookaihub-live-platform` | `bookaihub-live-connect` |
| Events from | **Your account** | **Connected accounts** |
| API version | **`2026-07-29.dahlia`** | **`2026-07-29.dahlia`** |
| Destination type | Webhook endpoint | Webhook endpoint |
| URL | `https://bookaihub.com/webhooks/stripe` | `https://bookaihub.com/webhooks/stripe` |
| Events | `customer.subscription.created`<br>`customer.subscription.updated`<br>`customer.subscription.deleted`<br>`invoice.payment_succeeded`<br>`invoice.payment_failed` | `checkout.session.completed`<br>`checkout.session.expired`<br>`account.updated` |

Notes:

- The URL is `PUBLIC_URL` + `/webhooks/stripe` — **not** `/api/webhooks/…`
  and not the `app.` host.
- The bookaihub destinations run on `2026-07-29.dahlia`, and the webhook
  handlers read every field from where dahlia puts it (including a
  subscription's renewal date, which moved onto its items in 2025-03-31.basil).
  `2025-01-27.acacia` also works. What matters is that **both destinations use
  the same version** — Stripe shapes each payload by its destination's version,
  so a new or replacement destination should match the existing one. This is
  separate from the version the server uses for its own calls to Stripe
  (pinned to acacia in `stripe.provider.ts`); the two do not need to match.
- Pick exactly the events above. A destination subscribed to something else
  (for example `account.external_account.updated` instead of
  `account.updated`) looks healthy and never delivers what we need.
- After creating each one, open it and **Reveal** the **Signing secret**
  (`whsec_…`). Note which secret belongs to which destination.

### A5. Customer portal (for subscription billing)

Studios manage their bookaihub subscription in Stripe's customer portal
(**Manage billing** on the Plan and billing page). Stripe refuses to open the
portal until it has been configured once per mode.

1. **Settings → Billing → Customer portal**.
2. Turn on: **Update payment methods**, **View invoice history**, **Cancel
   subscriptions** (at end of period is safest).
3. Leave **Switch plans** off for now — plan changes go through bookaihub.
4. Set the business information / links (terms, privacy) and **Save**.

No Products or Prices need creating: checkout builds the 39 / 89 / 189 prices
from the `plan_settings` table at the moment of checkout.

### A6. Server configuration (live box)

On the server, `server/.env.production` (live: `ssh my-vps`, directory
`/home/ubuntu/jeff-saas`):

```bash
STRIPE_SECRET_KEY="sk_test_…"                       # A3
STRIPE_WEBHOOK_SECRET="whsec_CONNECT…,whsec_PLATFORM…"  # A4: both, comma-separated, no spaces needed
STRIPE_ACCOUNT_COUNTRY=US
PUBLIC_URL="https://bookaihub.com"                  # booking pages + webhooks
APP_URL="https://app.bookaihub.com"                 # dashboard; Stripe return URLs are built from it
```

- The order of the two secrets does not matter; the server tries each.
- The API refuses to start in production without both Stripe values, or with
  a localhost `APP_URL` / `PUBLIC_URL`.
- Apply with the normal deploy (`deploy/deploy.sh`), which restarts the API.

Check what the box has without printing secrets:

```bash
ssh my-vps "cd /home/ubuntu/jeff-saas && grep -E '^STRIPE_' server/.env.production | sed -E 's/=(\"?)(sk|rk)_(test|live)_.*/=\1\2_\3_<set>/; s/whsec_[A-Za-z0-9]+/whsec_<set>/g'"
```

You should see `sk_test_<set>` and **two** `whsec_<set>` values.

### A7. Verify the platform side

1. Stripe → **Workbench → Webhooks** → each destination → **Send test event**
   (platform: `invoice.payment_failed`; connect: `account.updated`).
   Deliveries should show **200**. A **400** is almost always the wrong
   signing secret; a **404** is the wrong URL.
2. "Resend" and repeated "Send test event" reuse the same event id, and the
   app answers duplicates with 200 without processing them again. To see a
   fresh event processed, trigger a new one (`stripe trigger
   invoice.payment_failed` from the Stripe CLI).
3. bookaihub → **Admin → Webhooks** (`/admin/webhooks`): the events appear
   with their type and processed time.
4. bookaihub → **Admin → Integrations** (`/admin/integrations`): every studio's
   Connect state at a glance.

### A8. Supporting studios from the bookaihub superadmin

Superadmin access is granted on the box, never through the app:

```bash
ssh my-vps "cd /home/ubuntu/jeff-saas && docker compose -f docker-compose.prod.yml exec -T api npm run platform:grant -- you@example.com 'why'"
```

(`platform:list` and `platform:revoke` work the same way.) A non-admin, or an
expired session, sees every `/api/platform/*` route as **404 / "Route not
found"** — sign in again before assuming something is broken.

Per studio: **Admin → Studios → (studio)**.

| Need | Where | What it does |
|---|---|---|
| See Connect state | **Integrations** section | Charges / payouts enabled, account connected or not |
| Studio finished onboarding but still shows restricted | Integrations → **Refresh Stripe status** | Re-reads the account from Stripe and saves the verdict (audited as `organization.stripe_refresh`). Use when the `account.updated` webhook was missed. |
| Account belongs to another Stripe account / old sandbox ("can't be reached with the platform's Stripe key") | Owner clicks **Finish Stripe setup**, or **Actions → Reset Stripe connection** | The owner's button now swaps an unreachable account for a new one by itself. Reset clears it from our side first (reason required; audited as `organization.stripe_reset`, old account id kept in the audit row). Both refuse a studio that is already taking payments. |
| Change the studio's plan | **Actions → Change plan** | Reason required, audited |
| Check what happened | **Admin → Audit** (`/admin/audit`) | Every platform action with actor, reason, before/after |

### A9. Going live (real money)

1. Stripe → **Activate account** (live mode): business details, bank account,
   identity, for the **platform** itself.
2. Switch the dashboard to **Live mode** and repeat **A2** (platform profile,
   branding, countries), **A3** (live `sk_live_…`), **A4** (two new live
   destinations with new secrets) and **A5** (customer portal, live).
3. Update the server env (A6) with the live key and the two live secrets;
   deploy.
4. Every studio has to connect again. Accounts created in test mode do not
   exist in live mode — they show as "can't be reached". The owner's **Finish
   Stripe setup** replaces them automatically; or reset them from A8 first.
5. Run one real low-value booking end to end and refund it.

### A10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Stripe would not start payment setup: Stripe no longer recommends Accounts v1…" | Server running code from before the Accounts v2 change | Deploy current `main` |
| "This studio's Stripe account can't be reached with the platform's Stripe key" | Account was created under a different Stripe account / sandbox, or access revoked | Owner: **Finish Stripe setup** (creates a new one). Superadmin: Reset Stripe connection |
| Same message for a studio that **was** taking payments | The server has the wrong `STRIPE_SECRET_KEY` | Fix the key; do **not** reset — the studio's real account is fine |
| Studio finished onboarding, still "not yet able to take payments" | Stripe still wants details, or `account.updated` was missed | Owner: **Refresh status** (Settings → Payment Settings) — shows what Stripe still needs. Superadmin: Refresh Stripe status |
| Webhook deliveries **400** | Signing secret missing from `STRIPE_WEBHOOK_SECRET` | Put both secrets in, comma-separated; deploy |
| Webhook deliveries **404** | Wrong URL | `https://bookaihub.com/webhooks/stripe` |
| Webhook 200 but nothing changes | Duplicate event id (resend / test event) | Trigger a new event |
| "No configuration provided…" when opening Manage billing | Customer portal never saved in this mode | A5 |
| Customer gets "This studio is not set up to take payments yet" | Studio has no Connect account with charges enabled | Part B |

---

## Part B — Studio operator setup

Done by the studio's **owner or an admin** (front-desk members can see the
status but cannot connect). Takes about 10 minutes. Have to hand: the legal
name and date of birth of the person responsible, home address, last four
digits of their SSN (sometimes the full SSN), EIN if registered as a company,
the business website (your bookaihub booking page works), and the bank
account for payouts.

### B1. Start in bookaihub

Either:

- **Integrations** (left nav) → Payments card → **Connect Stripe**, or
- **Settings → Payment Settings** → **Connect Stripe**.

You are taken to Stripe's own page, branded **bookaihub**. Everything you enter
there goes to Stripe; bookaihub never sees your bank or identity details.

### B2. On Stripe's onboarding pages

1. **Email and phone** — enter your mobile number and the code Stripe texts
   you. If you already have a Stripe login, you can sign in instead.
2. **Business type** — *Individual / sole proprietor* if you have not
   registered a company; otherwise *Company* (LLC, corporation…) or
   *Non-profit*.
3. **Business details** — legal business name and EIN (companies), industry
   (for example *Education* or *Recreational services*), and the business
   website. If you have no website, use your bookaihub booking page address.
4. **Personal details / representative** — legal first and last name, email,
   date of birth, home address, phone, SSN last 4 (Stripe may ask for the full
   number or an ID document later). Companies also add owners and directors.
5. **Payout account** — the bank account (routing + account number) that
   should receive the money, or a debit card.
6. **Public details** — the **statement descriptor** customers see on their
   card statement (keep it recognisable, e.g. your studio name) and a customer
   support phone number.
7. **Review and submit** → **Agree and submit**.

You are sent back to **bookaihub → Settings → Payment Settings**, which checks
with Stripe straight away.

### B3. What the status means

| Payment Settings shows | Meaning | Do this |
|---|---|---|
| **Not connected** | No Stripe account yet | **Connect Stripe** |
| **Connected — not yet able to take payments** | Stripe still needs something, or is verifying | **Finish Stripe setup** to fill in what is missing, then **Refresh status**. The note under the buttons says how many details Stripe still wants. |
| **Connected — taking payments**, Payouts **Enabled** | Done | Nothing |
| "Your Stripe setup link expired before you finished" | The Stripe page sat open too long | **Continue Stripe setup** — you continue where you left off |
| "…can't be reached with the platform's Stripe key…" | Your account was made under an old setup | **Finish Stripe setup** — a fresh account is created; go through B2 again |

Verification sometimes takes Stripe a few minutes to a day. Come back and press
**Refresh status**, or just look again later — Stripe tells bookaihub when it
changes.

### B4. Payment settings

Still on **Settings → Payment Settings**:

- **Deposit percentage** — what a *new* activity starts at (0 = full payment).
  Deposits are set per activity afterwards (Activities → the activity).
- **Let guests pay a deposit instead of the full amount** — the master switch
  for deposits everywhere.
- **Allow "pay on arrival" bookings** — lets customers book without paying
  online.
- **Accept cash at the meeting point**.
- **Save changes**.

Cancellation refunds follow **Settings → Cancellation Policy**.

### B5. Test it

1. Open your booking page (**View booking page**, top right) and book a class.
2. Pay with a card. In test mode use `4242 4242 4242 4242`, any future expiry,
   any CVC, any ZIP.
3. The booking shows as paid under **Bookings**, and the money under
   **Payments**.

### B6. Day to day

- **Refunds**: **Bookings** → cancel the booking (one, or several selected at
  once). The refund follows your cancellation policy and goes back from your
  Stripe balance. Owners and admins only.
- **Payouts, balance, disputes, tax forms**: in Stripe's Express dashboard —
  sign in at <https://connect.stripe.com/express_login> with the email or phone
  used during onboarding.
- **Processing fees** are Stripe's standard rates; bookaihub takes no cut.

### B7. Paying for bookaihub (your subscription)

1. **Plan and billing** (account menu → Plan and billing, or `/billing`).
2. **Choose Solo / Studio / Pro** → Stripe Checkout → pay. You come back to
   Plan and billing; the plan switches as soon as Stripe confirms, usually
   within a minute.
3. **Manage billing — card, invoices, cancellation** opens Stripe's customer
   portal once you have subscribed.
4. While subscribed, to change plan, contact bookaihub support for now (see the
   known gap below).

---

## Appendix — Stripe test-mode values

Only in test mode / sandbox. Real values must never be used in test mode, and
these never work in live mode.

| Field | Test value |
|---|---|
| Phone | **Use test phone number** button (or `000 000 0000`) |
| SMS code | **Use test code** button (or `000000`) |
| Date of birth | `01/01/1901` (passes verification) |
| SSN last 4 / full | `0000` / `000-00-0000` |
| Address line 1 | `address_full_match` (any city/state/ZIP) |
| EIN | `00-0000000` |
| Bank routing / account | `110000000` / `000123456789` |
| Website | any URL, e.g. your booking page |
| ID document | use Stripe's "test document" option if asked |
| Card that succeeds | `4242 4242 4242 4242` |
| Card that needs 3-D Secure | `4000 0025 0000 3155` |
| Card that is declined | `4000 0000 0000 0002` |

## Known gaps (not yet built)

- **Changing plan while subscribed** starts a second Checkout, which would
  create a second subscription. Until plan changes update the existing
  subscription, change plans for paying studios by hand (cancel the old one in
  Stripe → Customers) and avoid pressing a different plan's button.
- The app has no "Open Stripe dashboard" button for studios; they use the
  Express login link in B6.

## Confirmed behaviour

- Stripe **does** send the v1 `account.updated` event for accounts created
  through Accounts v2; it reaches the connect destination and is processed
  (verified 2026-10-08). The return to Payment Settings also re-reads the
  status, so a missed event never leaves a studio stuck.
