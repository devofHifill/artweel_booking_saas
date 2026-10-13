# Stripe: platform setup

What the platform sets up once in Stripe and on the server so studios can take payments and pay for their plan, and how to help a studio that is stuck.

This guide is only shown to platform admins. Studio owners have their own guide, **Connecting Stripe**, on their Help & Support page, which covers connecting their studio, their payment settings, and paying for their plan.

---

## Contents

1. [The two Stripe relationships](#1-the-two-stripe-relationships)
2. [Turn on the Stripe account](#2-turn-on-the-stripe-account)
3. [Turn on Connect](#3-turn-on-connect)
4. [API key](#4-api-key)
5. [Webhook destinations: two of them](#5-webhook-destinations-two-of-them)
6. [Customer portal](#6-customer-portal)
7. [Server configuration](#7-server-configuration)
8. [Check the platform side works](#8-check-the-platform-side-works)
9. [Helping a studio](#9-helping-a-studio)
10. [Going live](#10-going-live)
11. [Troubleshooting](#11-troubleshooting)
12. [Stripe test values](#12-stripe-test-values)
13. [Known gaps](#13-known-gaps)

---

## 1. The two Stripe relationships

Most confusion comes from mixing these up.

| | Who pays whom | Stripe feature | Where it shows in bookaihub |
|---|---|---|---|
| **Studio payments** | A customer pays the studio for a booking | **Connect** (Express dashboard, direct charges) | Studio: Integrations, Settings → Payment Settings |
| **Subscription billing** | The studio pays bookaihub 39 / 89 / 189 a month | **Billing** (Checkout + customer portal) on our own account | Studio: Plan and billing (`/billing`) |

Booking money goes straight into the studio's own Stripe balance. We never hold it and take no application fee.

Do every step in **test mode / sandbox** first, have a studio connect against it, and only then repeat for live mode ([section 10](#10-going-live)). Test and live are separate in Stripe: keys, Connect settings, webhook destinations and connected accounts do not carry over.

---

## 2. Turn on the Stripe account

1. Sign in at <https://dashboard.stripe.com> with the platform's Stripe account (the one the bookaihub keys belong to).
2. Use the account switcher at the top left to check you are in the right account, and in the **sandbox / Test mode** (orange "Test mode" banner).
3. **Live mode only, skip in the sandbox.** Public details (Settings → Business → Business details → Customer-facing information), the statement descriptor and branding can only be saved in live mode. The sandbox answers "Only live keys can access this method" or "Settings are hidden". Until then Stripe shows the account name, **bookaihub**, with default styling, which is fine for testing. Set them when going live:
   - Customer-facing information: business name **bookaihub**, support phone, support address, support email, website `https://bookaihub.com`, privacy and terms URLs.
   - Statement descriptor: `BOOKAIHUB` (shortened: `BOOKAIHUB` or `BOOKAI`). This is what studios see on their card statement for their bookaihub plan. Studio bookings carry each studio's own descriptor.

---

## 3. Turn on Connect

1. Left nav → **Connect** (or **More → Connect**) → **Get started** if Connect has never been set up.
2. Platform type: **Platform** (studios sell their own services to their own customers; we provide software). Not "Marketplace".
3. When asked how connected accounts are set up, choose what the code creates:

| Question | Answer |
|---|---|
| Dashboard for connected accounts | **Express** |
| Who pays Stripe's processing fees | **The platform** (`fees_collector: application`) |
| Who is liable for negative balances and losses | **The platform** (`losses_collector: application`) |
| Charge type | **Direct charges** |
| Onboarding | **Stripe-hosted** |

4. **Platform profile** (Connect → Settings → Platform profile) exists only in **live mode**. In the sandbox Stripe shows "Settings are hidden". Complete it when going live; Stripe will not create live connected accounts until it is done.
5. **Branding** (Settings → Business → Branding, applied to Connect from Connect → Settings → Onboarding interface): icon and brand colour. **Live mode only.** One set of branding covers both modes once set. It styles the onboarding pages, the studio's Express dashboard, Checkout and the customer portal.
6. **Connect → Settings → Onboarding options → Countries**: make sure the **United States** is allowed. The app creates US accounts (`STRIPE_ACCOUNT_COUNTRY=US`).
7. Same page, "Add the products they need": tick **Payments** ("Let accounts accept payments from their own customers") alongside **Transfers**. The app requests card payments itself, so this is not blocking, but it keeps Stripe's defaults in line with what the app creates.
8. **Connect → Settings → Express dashboard**: leave payouts visible so studios can see their balance and payouts.

> **Accounts v2.** Stripe refuses the old Accounts v1 `accounts.create` call for new Connect platforms ("Stripe no longer recommends Accounts v1 for new Connect integrations"). The app creates connected accounts through **Accounts v2** (`POST /v2/core/accounts`) and uses the v1 APIs for everything else, which Stripe supports. Nothing to configure. If a studio ever sees that message, the server is running code older than the fix.

---

## 4. API key

1. **Developers → API keys** (test mode).
2. Copy the **Secret key** (`sk_test_…`). This becomes `STRIPE_SECRET_KEY`.
3. The publishable key is not used: every Stripe page is hosted by Stripe.
4. Never paste the secret key into chat, tickets or the repository.

---

## 5. Webhook destinations: two of them

Stripe scopes each destination to **either** "Your account" **or** "Connected accounts" and gives each its own signing secret. We need both.

**Workbench → Webhooks → Create an event destination**, twice:

| Setting | Destination 1: platform | Destination 2: connect |
|---|---|---|
| Name (suggested) | `bookaihub-live-platform` | `bookaihub-live-connect` |
| Events from | **Your account** | **Connected accounts** |
| API version | **`2026-07-29.dahlia`** | **`2026-07-29.dahlia`** |
| Destination type | Webhook endpoint | Webhook endpoint |
| URL | `https://bookaihub.com/webhooks/stripe` | `https://bookaihub.com/webhooks/stripe` |
| Events | `customer.subscription.created`<br>`customer.subscription.updated`<br>`customer.subscription.deleted`<br>`invoice.payment_succeeded`<br>`invoice.payment_failed` | `checkout.session.completed`<br>`checkout.session.expired`<br>`account.updated` |

- The URL is `PUBLIC_URL` + `/webhooks/stripe`. **Not** `/api/webhooks/…`, and not the `app.` host.
- The webhook handlers read every field from where `2026-07-29.dahlia` puts it. `2025-01-27.acacia` also works. What matters is that **both destinations use the same version**, because Stripe shapes each payload by its destination's version. A new or replacement destination should match the existing one. This is separate from the version the server uses for its own calls to Stripe; the two do not need to match.
- Pick exactly the events above. A destination subscribed to something else (for example `account.external_account.updated` instead of `account.updated`) looks healthy and never delivers what we need.
- After creating each one, open it and **Reveal** the **Signing secret** (`whsec_…`). Note which secret belongs to which destination.

---

## 6. Customer portal

Studios manage their bookaihub subscription in Stripe's customer portal (**Manage billing** on their Plan and billing page). Stripe refuses to open the portal until it has been set up once in each mode.

1. **Settings → Billing → Customer portal**.
2. Turn on **Update payment methods**, **View invoice history** and **Cancel subscriptions** (at end of period is safest).
3. Leave **Switch plans** off. Plan changes go through bookaihub.
4. Set the business information and links (terms, privacy) and **Save**.

No Products or Prices need creating: checkout builds the 39 / 89 / 189 prices from the plan settings (**Plans & Limits**) at the moment of checkout.

---

## 7. Server configuration

On the server, in `server/.env.production` (live: `ssh my-vps`, directory `/home/ubuntu/jeff-saas`):

```bash
STRIPE_SECRET_KEY="sk_test_…"                           # section 4
STRIPE_WEBHOOK_SECRET="whsec_CONNECT…,whsec_PLATFORM…"  # section 5: both, comma-separated
STRIPE_ACCOUNT_COUNTRY=US
PUBLIC_URL="https://bookaihub.com"                      # booking pages + webhooks
APP_URL="https://app.bookaihub.com"                     # dashboard; Stripe return URLs are built from it
```

- The order of the two secrets does not matter; the server tries each.
- The API refuses to start in production without both Stripe values, or with a localhost `APP_URL` / `PUBLIC_URL`.
- Apply with the normal deploy (`deploy/deploy.sh`), which restarts the API.

To check what the server has without printing the secrets:

```bash
ssh my-vps "cd /home/ubuntu/jeff-saas && grep -E '^STRIPE_' server/.env.production | sed -E 's/=(\"?)(sk|rk)_(test|live)_.*/=\1\2_\3_<set>/; s/whsec_[A-Za-z0-9]+/whsec_<set>/g'"
```

You should see `sk_test_<set>` and **two** `whsec_<set>` values.

---

## 8. Check the platform side works

1. Stripe → **Workbench → Webhooks** → each destination → **Send test event** (platform: `invoice.payment_failed`; connect: `account.updated`). Deliveries should show **200**. A **400** is almost always the wrong signing secret; a **404** is the wrong URL.
2. "Resend" and repeated "Send test event" reuse the same event id, and the app answers duplicates with 200 without processing them again. To see a fresh event processed, trigger a new one (`stripe trigger invoice.payment_failed` from the Stripe CLI).
3. **Webhooks** (in this admin area): the events appear with their type and processed time.
4. **Integrations** (in this admin area): every studio's Connect state at a glance.
5. Have a test studio connect, following its **Connecting Stripe** guide, using the [test values](#12-stripe-test-values) below.

---

## 9. Helping a studio

Platform admin access is granted on the server, never through the app:

```bash
ssh my-vps "cd /home/ubuntu/jeff-saas && docker compose -f docker-compose.prod.yml exec -T api npm run platform:grant -- you@example.com 'why'"
```

`platform:list` and `platform:revoke` work the same way. A non-admin, or an expired session, sees every platform page as **Not found**. Sign in again before assuming something is broken.

For one studio: **Studios → (the studio)**.

| Need | Where | What it does |
|---|---|---|
| See Connect state | **Integrations** section | Charges and payouts enabled, account connected or not |
| Studio finished onboarding but still shows restricted | Integrations → **Refresh Stripe status** | Re-reads the account from Stripe and saves the result (audited as `organization.stripe_refresh`). Use when the `account.updated` webhook was missed. |
| Account belongs to another Stripe account or an old sandbox ("can't be reached with the platform's Stripe key") | Owner presses **Finish Stripe setup**, or **Actions → Reset Stripe connection** | The owner's button swaps an unreachable account for a new one by itself. Reset clears it from our side first (reason required; audited as `organization.stripe_reset`, old account id kept in the audit row). Both refuse a studio that is already taking payments. |
| Change the studio's plan | **Actions → Change plan** | Reason required, audited |
| Check what happened | **Audit Log** | Every platform action with who did it, the reason, and before/after |

---

## 10. Going live

1. Stripe → **Activate account** (live mode): business details, bank account and identity for the **platform** itself.
2. Switch the Stripe dashboard to **Live mode**. Set what the sandbox could not: public details and statement descriptor ([section 2](#2-turn-on-the-stripe-account)), platform profile and branding ([section 3](#3-turn-on-connect)). Then repeat countries and products (section 3), the API key (section 4, now `sk_live_…`), the two webhook destinations (section 5, on the same API version, with new secrets) and the customer portal (section 6, saved separately per mode).
3. Update the server configuration (section 7) with the live key and the two live secrets, and deploy.
4. Every studio has to connect again. Accounts created in test mode do not exist in live mode, and show as "can't be reached". The owner's **Finish Stripe setup** replaces them automatically, or reset them first from [section 9](#9-helping-a-studio).
5. Run one real low-value booking end to end, then refund it.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Stripe would not start payment setup: Stripe no longer recommends Accounts v1…" | Server running code from before the Accounts v2 change | Deploy current `main` |
| "This studio's Stripe account can't be reached with the platform's Stripe key" | Account was created under a different Stripe account or sandbox, or access was revoked | Owner: **Finish Stripe setup** (creates a new one). You: **Reset Stripe connection** |
| Same message for a studio that **was** taking payments | The server has the wrong `STRIPE_SECRET_KEY` | Fix the key. Do **not** reset: the studio's real account is fine |
| Studio finished onboarding, still "not yet able to take payments" | Stripe still wants details, or `account.updated` was missed | Owner: **Refresh status** (Settings → Payment Settings) shows what Stripe still needs. You: **Refresh Stripe status** |
| Webhook deliveries **400** | Signing secret missing from `STRIPE_WEBHOOK_SECRET` | Put both secrets in, comma-separated, and deploy |
| Webhook deliveries **404** | Wrong URL | `https://bookaihub.com/webhooks/stripe` |
| Webhook 200 but nothing changes | Duplicate event id (resend or test event) | Trigger a new event |
| "No configuration provided…" when a studio opens Manage billing | Customer portal never saved in this mode | [Section 6](#6-customer-portal) |
| Customer sees "This studio is not set up to take payments yet" | Studio has no Connect account with charges enabled | The studio follows its **Connecting Stripe** guide |

Stripe **does** send the `account.updated` event for accounts created through Accounts v2, and it reaches the connect destination (checked 2026-10-08). The owner's return to Payment Settings also re-reads the status, so a missed event never leaves a studio stuck.

---

## 12. Stripe test values

Only in test mode / sandbox. Real values must never be used in test mode, and these never work in live mode.

| Field | Test value |
|---|---|
| Phone | **Use test phone number** button (or `000 000 0000`) |
| SMS code | **Use test code** button (or `000000`) |
| Date of birth | `01/01/1901` (passes verification) |
| SSN last 4 / full | `0000` / `000-00-0000` |
| Address line 1 | `address_full_match` (any city, state and ZIP) |
| EIN | `00-0000000` |
| Bank routing / account | `110000000` / `000123456789` |
| Website | Any URL, for example the studio's booking page |
| ID document | Stripe's "test document" option if asked |
| Card that succeeds | `4242 4242 4242 4242` |
| Card that needs 3-D Secure | `4000 0025 0000 3155` |
| Card that is declined | `4000 0000 0000 0002` |

---

## 13. Known gaps

- **Changing plan while subscribed** starts a second Checkout, which would create a second subscription. Until plan changes update the existing subscription, change plans for paying studios by hand (cancel the old one in Stripe → Customers). Studios are told to contact us rather than press a different plan's button.
- Studios have no "Open Stripe dashboard" button. They sign in to Stripe's Express dashboard at <https://connect.stripe.com/express_login>.
