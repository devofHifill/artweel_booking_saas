# Launch review tracker

One row per finding from the launch-readiness check and code review of
2026-11-25. Update the row, and the Progress line, whenever a status changes.

**Reviewed:** `main` at `dfe1508` (PR #89), the live server at bookaihub.com,
and the code in `server/src` and `client/src`.
**Code review depth:** payments, refunds, Stripe webhooks, billing, sign-in,
studio access checks, public booking, seat holds and the dashboard's sign-in
refresh were read in depth (about 15,000 of 88,000 lines). Calendar, reports,
staff and other screens were not reviewed line by line.

## Progress

**Bugs:** all 8 fixed and live. PR #90 was merged and deployed to bookaihub.com on 2026-11-25 (`9dd9fd6`). After the deploy the API reported healthy and logged no errors, and the dashboard served the new code. A box is ticked once its fix is live.
**Full test suite on the branch (2026-11-25):** 1,518 of 1,520 passed in 82 minutes, including the 15 new tests. The two failures are in platform code the branch doesn't touch, and both passed when re-run on their own: `platform/studios` overview metrics (the same 500 under load as the `main` baseline) and `platform/health` (the test database dropped the connection for a moment).
**Launch readiness:** 1 of 10 done (LR-10).

## Legend

- **Done:** ✅ fixed and deployed · ⬜ not yet · ➖ won't fix (reason given).
- **Severity:** `Serious` (money or bookings can go wrong) · `Minor`.
- **Status:** `Open` → `In progress` → `Fixed (local)` → `Deployed` ·
  `Decision` (needs Suren's or the client's call) · `Blocked` (waiting on
  someone else) · `Won't fix`.

---

## Code review — bugs

| Done | ID | Bug | Severity | Cause | Fix | Status |
|:-:|---|---|---|---|---|---|
| ✅ | RV-01 | A paid booking can be lost for good if Stripe's payment confirmation fails to process once | Serious | `payment.service.ts` `handleWebhook`: the event row is saved before processing. When processing fails, Stripe's retry hits the unique event id and is answered "duplicate", so it never runs again. A class checkout's steps (turn the hold into a booking, save the totals, link the payment) also aren't done as one unit, so a retry after a partial run fails. | Done: an event that failed, or died part-way (5+ minutes unfinished), runs again when Stripe redelivers it. A delivery that overlaps one still running gets 409 so Stripe tries later. A class checkout now books, totals and links the payment in one transaction, and a repeat skips once the booking exists. Tests in `checkout.test.ts` ("money is never kept without a place"). | Deployed |
| ✅ | RV-02 | A customer can book any class for the price of a cheaper (or free) option | Serious | The booking request names the service (sets the price) and the class date (gets the seat) separately. Nothing checks they belong together: `startCheckout` (`payment.service.ts`) for paid bookings, `createPublicBooking` (`public.service.ts`) for free ones. | Done: both paths refuse a class date that isn't one of that service's dates ("Class not found."), before anything is written, and paid checkout refuses a hidden service. Tests for both paths. | Deployed |
| ✅ | RV-03 | Paying in the last seconds of checkout charges the card but makes no booking | Serious | The Stripe checkout and the seat hold expire at the same moment (`startCheckout`). Stripe's confirmation arrives seconds later, and `convertHold` (`hold.service.ts`) rejects the expired hold. | Done: the hold now outlives the Stripe checkout by 15 minutes (`CHECKOUT_HOLD_GRACE_MINUTES`). A paid hold that has expired but not been released still converts, since its seats are still held. If the seats were already released, the customer is refunded in full automatically (classes and courses) and an error is logged. The customer gets no email in that rare case, only the refund. | Deployed |
| ✅ | RV-04 | Suspended studios (trial over, unpaid, or suspended by us) can still take paid class bookings | Serious | `POST /public/:slug/checkout` never checks the studio's status. Free bookings, waitlists and course checkout do. | Done: `startCheckout` refuses with STUDIO_INACTIVE, with the same rule and wording as a free booking. Test added. | Deployed |
| ✅ | RV-05 | A customer can cancel by link after the class and get a refund, in full if the studio never set a refund policy | Serious | `cancelByToken` (`public.service.ts`) only refuses bookings already cancelled. Rescheduling already refuses a booking that has started. | Done: online cancellation is refused (409 CANCEL_NOT_ALLOWED) once the booking has started or is marked attended or no-show. The manage page shows why instead of the Cancel button (checked in the browser). **Not changed:** a studio with no cancellation policy still refunds in full when a customer cancels *before* the start. The default policy is only created in onboarding. | Deployed |
| ✅ | RV-06 | Two dashboard tabs renewing the sign-in at once sign the user out of both | Serious | `client/src/lib/api.ts`: each tab renews on its own with the same saved token. The server treats the second use as theft and ends the whole session, and the losing tab also wipes the winner's new tokens. | Done: tabs take turns renewing through a Web Lock, and a tab that finds the sign-in already renewed uses it. Checked in the browser by loading the dashboard twice at once with an expired token. With the fix there's one renewal and both stay signed in. With the old code as a control, there's "Refresh token reuse detected" and a sign-out. | Deployed |
| ✅ | RV-07 | Sign-up returns the email-verification code in its response, so "verified" can't be trusted | Minor | `auth.controller.ts` `register` and `resendVerification` return the code in production. The comment says to remove it once email sending exists, and it now does. Nothing depends on "verified" yet beyond labels in admin screens. Also found: the code is never emailed, and the dashboard has no page to receive a verification link. In production an address only becomes verified by completing a password reset. | Done: the code is returned only outside production, as password reset already does. Test added. A real verification email and page would be a separate feature. | Deployed |
| ✅ | RV-08 | *(found while fixing RV-01)* The setting "Confirm bookings automatically when payment succeeds" does nothing when switched off: paid bookings are always confirmed | Minor | `convertHold` (`hold.service.ts`) creates every paid booking as CONFIRMED, and the webhook only ever sets CONFIRMED again. Making the setting work would need an approval flow that doesn't exist: no way to confirm a pending booking, and the email always says "You are booked in". It's on by default, so only studios that switched it off are affected. | **Decision (Suren, 2026-11-25): remove the toggle.** Done: it's off the Settings page (checked in the browser, and Save still works), the API no longer accepts it, and paid bookings are confirmed unconditionally. Test added. The database column stays, unused, until a real approval flow is built. Found after the deploy: the in-app setup guide (`client/src/guides/setup.md`) still listed the setting. The row is removed locally but not yet deployed. | Deployed |

## Launch readiness

| Done | ID | Item | Owner | Detail | Status |
|:-:|---|---|---|---|---|
| ⬜ | LR-01 | Switch Stripe to live mode | Suren + Jeff | Live runs on test keys (`sk_test_`), so no studio can take real money, and a BookAIHub plan can be "paid" with Stripe's public test card. Steps are in `docs/STRIPE-SETUP-GUIDE.md` A9. Needs Jeff's live secret key and the two live webhook secrets (asked for on Nov 20). | Blocked |
| ⬜ | LR-02 | Decide who pays Stripe fees and covers losses on studio payments | Suren + Jeff | Studios connect as Express accounts with BookAIHub paying Stripe's fees and covering negative balances (`stripe.provider.ts`), and no booking fee is taken. Options: Standard accounts, studio pays on Express, or a small booking fee. These settings are fixed when each studio's account is created, so **decide before LR-01**. | Decision |
| ⬜ | LR-03 | Stripe account name matches the site | Suren | The site names the business "BookAIHub". The Stripe account's business or public name must match it (Jeff's checklist). | Open |
| ⬜ | LR-04 | Daily database backups kept off the server | Suren | Backups only run during a deploy and stay on the same server (`/home/ubuntu/jeff-saas/backups`). A server failure would lose the data and the backups together. | Open |
| ⬜ | LR-05 | Server updates and reboot | Suren | 82 system updates pending and a reboot required. The server also runs n8n, fdgsms and SEBVM, so plan a quiet window. | Open |
| ⬜ | LR-06 | Google Calendar sync on live | Suren | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty on live, so studios can't connect a calendar there. Either set them up or hide the option. | Decision |
| ⬜ | LR-07 | Stripe customer portal in live mode | Suren | "Manage billing" opens Stripe's portal. Turn on payment method updates and invoice history for live mode (guide step A5; saved separately per mode). | Open |
| ⬜ | LR-08 | Text message approval (Twilio A2P 10DLC) | Suren | Twilio keys are set on live. Without 10DLC approval, US texts look sent but don't arrive (`HANDOFF.md`, open decision 3). Approval status not checked. | Open |
| ⬜ | LR-09 | Someone reads support@bookaihub.com | Suren | Mail records point to Hostinger, so it can receive mail. Send a test email and confirm it's read. | Open |
| ✅ | LR-10 | Full test suite green on `main` | Claude | Baseline on `main` at `dfe1508`, 2026-11-25: **1,502 of 1,504 passed** in 83 minutes. The two failures passed when re-run on their own: `gate/seat-concurrency` (a raw database error under load, the flake described in `TOURFLOW-PARITY-PLAN.md`) and `platform/studios` overview metrics (a 500 under load). | Done |

## Checked and fine (2026-11-25)

Security certificate (Let's Encrypt, valid to 7 Feb 2027) · www and http
redirect to https://bookaihub.com · `/api/health` reports database, PostGIS and
btree_gist ok · robots.txt and sitemap (22 URLs) · security headers (HSTS, CSP,
frame options) · email sending records for `email.bookaihub.com` (Resend DKIM
and SPF) · support mailbox records · disk 20% used, memory 2.9 of 7.8 GB ·
containers restart on their own · server type-checks and dashboard build pass.
