# Booking gaps — the guest page, and one at the counter

Written 2026-09-02, after walking `/demo/tourflow/booking.html` and
`/public/kiln-house` side by side in a browser. Extended the same day, after a
second pass over the demo's operator screens turned up G0 — which the first pass
should have found and did not.

---

## What this is

The thirteen-item TourFlow parity pass covered the **operator dashboard**. The
guest booking page was deliberately left out of it — `TOURFLOW-PARITY-PLAN.md`
line 250 keeps its warm palette on purpose, because a booking page is a pottery
studio's storefront and TourFlow's cool slate is a B2B dashboard aesthetic.

That decision was about **paint**. It was never a decision about **capability**,
and no document has compared the two surfaces on what they can actually do.
This one does.

**The headline: four of the gaps are not missing features at all.** They are
capabilities that exist, are tested, and have no caller — the same pattern the
parity pass found five times in the dashboard, and which `HANDOFF.md` names as
the thing to keep looking for.

| Capability | Exists at | Has a caller |
|---|---|---|
| Manual booking at the counter | `bookings/booking.admin.service.ts:286` | **No** |
| Stripe checkout, seats held first | `payments/payment.service.ts:139` | **No** |
| Deposit split (`dueNow` / `balance`) | `payments/money.ts:38` | **No** |
| Course enrolment + course checkout | `public.route.ts` (3 routes) | **No** |

A studio can therefore sell a six-week course through the API and has no way to
show it to a customer — and can take a booking over the phone through the API
and has no way to do it from its own dashboard.

**A note on scope.** The first row is operator-side, not guest-facing, so it
sits outside this document's title. It is here anyway because it was found by
the same sweep, it is the same fault, and separating it into a document of its
own would mean sequencing two plans against each other for no gain. It is the
only operator-side stage here, and it is marked as such.

---

## Method

The same one the parity pass used, and for the same reason it worked:

1. Read the demo screen.
2. Open ours.
3. Sort every difference into three piles — **behaviour we lack**, **behaviour
   the demo fakes**, and **behaviour we have that it does not**.
4. Build only the first pile.

The third pile is where the time is saved. It is also where the damage gets
done if it is skipped: the demo has **no** guest self-service anywhere in
`booking-flow.js` — no manage, no cancel, no reschedule, no waitlist. We have
all four, plus a live refund-and-credit quote at cancel time. Matching the demo
screen-for-screen would mean deleting them.

**Where the method failed the first time, recorded so it is not repeated.**
The first pass compared one surface — the guest page — and reported it as *the*
comparison. Manual booking and the export buttons are operator-side and were
never looked at, so G0 below was missed entirely and had to be found by someone
asking. Step 1 of the method says *read the demo screen*; it does not say which,
and the demo has fifteen. Sweep the operator screens for the no-caller pattern
before treating this document as complete.

---

## What the demo fakes — do not port

Verified by reading `booking-flow.js`, not inferred:

- **The signature** is a click that renders your typed name. Its own caption
  says a production build captures a real one.
- **Payment** is demo mode. No card is charged, and the fields ship pre-filled
  with `4242 4242 4242 4242`.
- **Reviews, star ratings and the hero stats** are hardcoded strings. There is
  no review system behind them.
- **"Add to Calendar"** and **"Print"** are buttons on a prototype with no
  booking to export.
- **Every Export button.** All five of them — Bookings, Customers, Payments,
  Reports and the manifest's PDF — raise a toast and download nothing.
  `bookings.js:78` says "In production this streams a CSV". Ours on Payments and
  Reports are real files. Do not read the demo's five against our two and
  conclude we are behind by three.

---

## Stage map

| | | Ships | Migration | Status |
|---|---|---|---|---|
| **G0** | Manual booking at the counter | a phone booking, and a dead button fixed | none | **DONE** — 5 tests, no migration |
| **G1** | Checkout + price summary | money actually moves | none | **DONE** — 10 tests, no migration |
| **G2** | Courses on the booking page | a cohort can be bought | none | **DONE** — 8 tests, no migration |
| **G3** | Service detail view | what am I buying | **1 — applied** | **DONE** — 8 tests |
| **G4** | Month calendar picker | pick a date, not a list | none | **DONE** — browser-verified |
| **G5** | Confirmation extras | reference, ICS, prep notes | **1 — applied** | **DONE** — 11 tests |
| **G6** | Browse + filters | only if service counts justify it | none | **SKIPPED** — 2026-09-02 |
| **G7** | Export on Bookings and Customers | two CSVs | none | **SKIPPED** — 2026-09-02 |

G0, G1 and G2 need no migration and no new server code. They are the three that
ship revenue, and they are first for that reason.

---

## G0 — Manual booking at the counter (operator-side)

**The gap, and it is the worst one here.** `createManualBooking` exists, is
routed at `POST /bookings`, is gated to front desk with the comment "A booking
taken over the phone or at the counter", and `role-split.test.ts:128` asserts
403 for an instructor and **201 for front desk**. Outside its own definition and
route, the string `createManualBooking` appears nowhere in the repository. No
client code calls it.

**There is also a live defect sitting on top of it.** The Dashboard's primary
call to action, `Dashboard.tsx:170`, is:

```tsx
<Link className="button-link primary" to="/bookings">New booking</Link>
```

It navigates to the bookings **list**, which has no create form. The most
prominent button on the first screen an owner sees promises an action the
product cannot perform. That is not a missing feature; it is a button that lies,
and it should be fixed in this stage whether or not the rest of it ships.

**Why this outranks G1.** A counter booking is money today. Checkout is money
once Stripe onboarding completes, and `OPEN DECISIONS` item 3 has the Connect
platform application sitting in an approval queue. A studio taking a booking
over the phone right now has no path that does not involve the database.

**What moves.** A create form on `/bookings`, opened from both the Dashboard CTA
and a button on the Bookings screen itself. The request body is already fixed by
the route's Zod schema and needs nothing added:

```
serviceTypeId, sessionId?, staffId?, startsAt?, seats, customer{name,email,phone?}, notes?
```

Both booking modes are already covered — `sessionId` for a class, `staffId`
plus `startsAt` for an appointment. The form chooses which pair to send from the
service's `bookingMode`, exactly as the public page already does.

**What not to build.** The demo's form also captures amount, payment status,
payment method and a guide. Do not copy it:

- **Amount** is computed from our own records. `payment.service.ts` is explicit
  that no client-supplied total influences anything, and a hand-typed amount on
  the counter form is the same hole through a different door.
- **Payment status and method** belong to the payments ledger, which is real
  here and faked in the demo. A counter booking that is paid in cash is a
  payment record, not a dropdown on a booking form.
- **Guide** is `staffId`, which the schema already has, and which the
  `staff_time_blocks` exclusion constraint will reject if that instructor is
  already teaching. Let Postgres answer it.
- **Waiver** does not exist. See the open decision below.

**Tests.** The route's permission gate was covered; the booking it produces was
not. `tests/admin/counter-booking.test.ts` — 5 tests, all passing:

- a counter booking takes the seats, prices from the service record, carries
  `source: 'admin'`, and appears in `listBookings`
- an existing customer is matched by email — deliberately with different
  capitalisation, which is what happens when an address is read down the phone
- a full class is refused, and `seats_taken` does not move
- an appointment against an instructor already teaching is refused as the app's
  own 4xx, not a raw Prisma error and a 500
- a class booking with no date is refused — the form cannot submit it, but the
  guard lives in the service rather than the schema

No migration.

### What shipped, 2026-09-02

- `components/CounterBookingForm.tsx` — the form. Class, date (with seats left
  per date and full ones disabled), places, customer, notes. Appointments swap
  the date list for instructor + date + time.
- `Bookings.tsx` — a "New booking" action gated to the same three roles as
  `requireFrontDesk`, opening the form in the existing `Modal`. Reads `?new=1`
  on arrival and clears it on close, so a refresh does not reopen a dismissed
  dialog.
- `Dashboard.tsx:170` — the dead CTA now points at `/bookings?new=1`.
- `lib/api.ts` — `todayIn` and `plusDays` moved out of `Classes.tsx`, which was
  their only home. The form needed both, and a third copy of a date helper is
  how three copies drift.

**Walked in a browser, not just tested.** Took a real booking through the
dashboard: 2 places on Beginner Wheel Throwing, Sep 10. It landed as
`source: admin`, `19000` cents, `CONFIRMED`, the session went from 0 to 2 seats
taken, one customer record was created, and the row appears in the list as
"Beginner Wheel Throwing ×2 · $190". That booking is still in `booking_dev` —
`npm run db:seed` clears it.

**A trap worth recording.** Editing an import before deleting the local
functions it replaced left Vite serving a module with a duplicate declaration,
and the browser held it after the file on disk was already correct. The symptom
is a page that renders its shell and shows zero of everything, with the real
error only in the Vite log — not the console. `location.href` to force a full
reload clears it. Nothing was wrong with the code.

---

## G1 — Checkout and the price summary

**The gap.** The page creates a booking and never asks for money.
`POST /public/:slug/checkout` computes the price server-side from our own
records — there is no amount field in the request body, deliberately — takes the
seat hold *before* creating the Stripe session, and returns a `checkoutUrl`.
None of it is reachable from the page.

**What moves.** `booking-page.client.ts` submits to `/bookings` today. It gains
a branch: when the service requires payment, POST `/checkout` and redirect to
`checkoutUrl` instead.

**The branch that matters — and it is not the happy path.** `startCheckout`
throws in two cases the page must handle rather than surface as a 500:

- `PAYMENTS_NOT_ENABLED` — the studio has no `stripeAccountId`, or
  `stripeChargesEnabled` is false. Most studios on the first day of a trial are
  in exactly this state. **Fall back to the current free booking path.** Do not
  block the booking; a studio that has not finished Stripe onboarding still
  needs to take a class booking, and today it can.
- `NO_PAYMENT_REQUIRED` — `dueNowCents` is 0. **This is a free class and
  nothing else.** See the correction below.

### Correction, found while building: `none` means pay in full

The paragraph above originally read "a free taster or a deposit of `none`".
That was wrong, and wrong in the direction that would have shipped a page that
never asked anybody for money.

`depositFor` (`money.ts:70`) returns the **whole total** for `depositType:
'none'` — no deposit configured means payment in full at booking, not payment
of nothing. So `requiresPayment` is true for every priced service, and
`dueNowCents` is 0 only when the total is 0.

**What that means for the product, which is bigger than a wiring job.** Once a
studio finishes Stripe onboarding, every priced booking through its page now
goes to checkout before it is confirmed. Before G1 every booking was taken
unpaid regardless of what the studio had priced. That is what "money actually
moves" has to mean, but it is a change in behaviour for any connected studio,
not just a new capability sitting beside the old one.

Two things make it safe to ship:

- **A studio without Stripe is untouched.** `willCharge` is false and the page
  takes the booking free, exactly as before. That is most studios today — none
  of the six seeded ones is connected.
- **Nothing else could pay instead.** Class packs and credits do not appear in
  the public flow at all — grep finds zero references — so no existing
  non-card route to a booking was closed off. That absence is its own gap, and
  it belongs to whoever picks up credits on the booking page.

Read that gating **before** submit, not from a thrown error, so the summary can
say what will happen. `getPublicServices` already selects `depositType` and
`depositValue`; the organization's Stripe state is not in the public read model
and needs adding to it as a single boolean — `acceptsPayment` — never the
account id.

**The summary panel.** `priceBooking` already returns `subtotalCents`,
`travelFeeCents`, `totalCents`, `dueNowCents`, `balanceCents` and `kind`. That
is precisely the demo's "charged today / due on the day" split, already
computed and already tested. The panel is a rendering job over an existing
return value.

It shows: service, date and time, seats, travel fee where a mobile booking has
one, total, and — when a deposit applies — due now and balance. Plus the
cancellation policy in words, which today appears only *after* booking, on the
manage page.

**Where the price is computed stays where it is.** The client renders what the
server returns. It does not multiply anything. A second copy of the deposit
maths in JavaScript is how the two copies disagree.

**Tests.** Extend `tests/public/`:

- a service with a percentage deposit sends the guest to checkout, and
  `dueNowCents` matches `priceBooking`
- a studio with `stripeChargesEnabled: false` books free and does **not** reach
  Stripe
- a zero-price service books free
- travel fee appears once on a mobile booking, not once per seat — the case
  `money.ts:43` calls the error a customer never forgives

No migration.

### What shipped, 2026-09-02

`tests/public/checkout-wiring.test.ts` — 10 tests, all passing.

**One deviation from this plan, made deliberately.** The plan said G1 needed no
new server code. It needed a little: `POST /public/:slug/quote`, which runs
`priceBooking` and returns the breakdown plus a `willCharge` flag.

The alternative was working the deposit out again in `booking-page.client.ts`,
and `money.ts` opens by saying an amount charged to a customer is computed on
the server. A second copy of that arithmetic in a string of browser JavaScript
is exactly the drift this plan warns about two stages later. The endpoint takes
the READ budget — it reserves nothing and charges nothing — and the
authoritative number is still the one `startCheckout` computes.

- **`public.service.ts`** — `getStudioPage` gains `acceptsPayment`, derived
  from the Stripe columns in a separate query so the account id never enters
  the shape that reaches `__BOOKING__`. Services gain their resolved
  `cancellationTiers`, from one query for the studio's policies rather than
  `resolvePolicyForService` per service. New `quoteBooking`.
- **`booking-page.client.ts`** — a summary panel on the details step (line
  items, total, and the due-now/balance split when a deposit applies), the
  cancellation promise in words BEFORE money moves, a submit that branches to
  `/checkout` and redirects, and handling for the `?paid=1` / `?cancelled=1`
  returns.
- The paid return deliberately does **not** render a booking. The webhook
  creates it, not the browser coming back, so the page says the confirmation is
  on its way rather than inventing one.

**Walked in a browser, both branches.** With no Stripe: summary reads "Total
$86 / Payable at the studio", button stays "Confirm booking", the free path is
unchanged. With Stripe connected and a 50% deposit: "Total $86 / Due now $43 /
Due on the day $43", button reads "Continue to payment", and submitting created
a hold plus a **$43 PENDING** payment before redirecting. The test flags on
`kiln-house` were reverted afterwards.

**A trap.** `booking-page.client.ts` is one `String.raw` template literal, so a
backtick anywhere in it — including inside a comment — ends the script and
produces a parse error a hundred lines further down. Do not quote identifiers
in comments in that file.

---

## G2 — Courses on the booking page

**The gap.** `/public/:slug/courses`, `/courses/:seriesId/enrollments` and
`/courses/:seriesId/checkout` all exist and are tested. `booking-page.ts`
mentions courses zero times. A studio's six-week course is unsellable through
its own booking page.

**What moves.** A second section under the service list — "Courses" — listing
each open cohort with its dates, price, and places left. Selecting one runs the
existing enrolment flow rather than the session flow.

**The one thing not to get wrong.** A cohort carries its own price, and it is
the cohort's that counts. `payment.service.ts:165` spells out why: the service's
`priceCents` is the per-class drop-in rate, and charging it for a six-week
course undercharges by a factor of six. Deposit terms still come from the
service, because "50% up front" is a studio policy, not a per-cohort one.

**Tests.** `tests/public/courses-on-page.test.ts` — 8 tests, all passing.

No migration.

### What shipped, 2026-09-02

- **`public.service.ts`** — `listPublicCourses(organizationId)` split out of
  `getPublicCourses`, so the page renders cohorts in its first response without
  a second studio lookup. `getStudioPage` returns them. `quoteBooking` now
  takes an optional `courseSeriesId` and resolves the cohort's price, mirroring
  `startCheckout` exactly.
- **`booking-page.ts`** — a Courses section, server-rendered like the service
  cards. A full or closed cohort still renders, disabled: a student deciding
  whether to wait for the next one needs to see this one ran.
- **`booking-page.client.ts`** — a course flow that is two steps, Course then
  Details. No time step: a cohort's dates are fixed when the studio creates it,
  and offering a choice would imply somebody could attend week three and skip
  week two. Submits to `/enrollments` or `/courses/:id/checkout`, and handles
  the `?enrolled=1` return.

### Two things found by walking it, neither in the plan

**A live bug: the course container was on sale as a drop-in.** A
`COURSE_SERIES` service was listed beside the real classes, priced at its
per-class rate. A customer could have bought **one week of a $480 course for
$95**. It had always been there and was invisible only because no studio had a
cohort yet — the same "nobody had one, so nobody saw it" shape as the
permanently-unbookable instructor. Now filtered at the query, not the template,
so a future template change cannot put it back.

**Courses and classes part company on payment, and the page has to know it.**
`enrollPublic` refuses ANY priced cohort — `COURSE_REQUIRES_PAYMENT` — so
`/enrollments` sells free courses only. G1's fallback does not carry over: a
class at a studio without Stripe books unpaid, while a priced course at that
same studio has no path at all. The course step now says so plainly and points
at the studio's contact details, rather than rendering a button guaranteed to
409. That asymmetry is a product decision someone made earlier and it is worth
knowing about — it means **a studio cannot sell a course until Stripe
onboarding completes**, which `OPEN DECISIONS` item 3 has sitting in a queue.

**Walked in a browser, both branches.** Created a real six-week $480 cohort on
`clay-and-co`. Without Stripe: the explanation, no button. With Stripe: summary
reads "Six Weeks at the Wheel $480 / Sessions 6 / Total $480", button reads
"Continue to payment", and submitting created a **$480 PENDING** payment with
holds across all six weeks — the cohort price, not the $95 drop-in. The Stripe
flag was reverted afterwards; the cohort was left in place as useful fixture
data.

---

## G3 — The service detail view

**The gap.** Our service card shows name, blurb, duration, capacity, price. The
demo's detail page also answers: what is included, where do I meet you, what
should I bring, what happens if I cancel, and when is the next one.

For a first-time guest booking a three-hour wheel class, "what should I bring"
is not decoration. It is the question that otherwise arrives as a phone call.

**Schema.** `ServiceType` has `description` and nothing else free-text. This
stage adds two nullable columns and no more:

- `highlights String[]` — what is included, as bullets
- `preparationNotes String?` — "before you come"

Meeting point is **not** a new column. `Location` already carries the address,
and `ServiceLocation` already joins them. The cancellation policy is already on
`cancellationPolicyId`, with `tiers` as JSON — render the resolved tiers through
`evaluatePolicy`, do not restate them as prose that can drift.

**Migration mechanics.** `prisma migrate dev` needs a TTY and fails on this box.
Use `prisma migrate diff --from-migrations … --script` into a temp file, write
it to `prisma/migrations/<timestamp>_service_detail_fields/migration.sql`, then
`prisma migrate deploy`. The test database is separate and needs its own run or
every suite fails with "column does not exist".

**The operator side is part of this stage, not a follow-up.** Two columns no
form can write are two columns that stay null forever — the exact fault the
parity pass found five times. `ServiceForm.tsx` gains both fields in the same
change.

### What shipped, 2026-09-02

`tests/public/service-detail.test.ts` — 8 tests, all passing. Migration
`20260902120000_service_detail_fields`, applied to `booking_dev`,
`booking_test` and `booking_test_b`.

**Deviation: two TEXT columns, not a `String[]`.** This plan specified
`highlights String[]`. There is no array column anywhere in this schema, while
`organizations.about` already establishes the idiom — owner-authored prose kept
as text and split in the renderer. So `highlights` is one bullet per line. It
bounds with a plain CHECK, needs no array handling, and a line is the easiest
thing for an owner to type into a textarea, which is what actually decides
whether these ever get filled in.

Bounds asserted at both ends, matching the storefront-copy migration: zod for a
readable message, CHECK so a fixture or a psql window cannot put a
thousand-line list onto a booking page. Both are tested — a constraint nobody
exercises is one that quietly stops matching its schema.

**Where the detail renders.** Above the times, not as a step of its own. A
first-time customer wants it before committing to a Tuesday; a returning one
should not click past a screen they have read. An extra step would charge every
booking for a question only some people have. It also sits above the two empty
states, because "no dates yet" is exactly when somebody wants to know what the
class involves before deciding to check back.

**Meeting point took no column**, as planned: it is the Location's address,
already joined and already published for fixed venues only.

**A trap this stage walked straight into.** `Classes.tsx` builds the edit draft
field by field, and its type carries a comment warning that a field the type
forgets is a field the next save silently resets. Adding the columns to the
schema, the API and the form was not enough — the values round-tripped as empty
until both were added to `ServiceOption` **and** to the `setEditing({...})`
literal. Two places, and the form looked correct in between.

**Walked in a browser, both ends.** Wrote highlights and preparation notes on
Clay & Co's wheel class, saw them render as a bulleted list, a meeting point
and a prep paragraph above the time list; then edited them from the dashboard
form and confirmed the new line reached the database.

---

## G4 — The month calendar

**The gap.** We render a flat chronological list of sessions. The demo renders
a month grid with per-day seat counts, disabled days, and month paging.

**Cheaper than it looks.** `getPublicAvailability` already takes
`fromLocalDate` and `toLocalDate` and returns slots and sessions. A month view
is one call over a month-wide range, grouped by local date in the client. **No
new endpoint, no new query, no migration.**

Keep the list. The grid is better for "which Saturday", the list is better for
"the soonest thing" — the demo has only the grid and is worse for it. Default
to whichever the service's cadence suggests: a class running most evenings
wants the list; a monthly workshop wants the grid.

**The trap.** Grouping instants into days must use the studio's IANA zone, not
the browser's. All instants are `timestamptz` and recurrence stores wall-clock
intent re-resolved per date. A guest in Chicago booking a Portland studio must
see Portland's Saturday. `dayIn(startsAt, tz)` in `booking-page.client.ts`
already does this — use it, do not reimplement it.

### What shipped, 2026-09-02

**No migration, no new endpoint, no new server query** — as predicted. The
window went from 28 days to 90 in one existing call, and month paging is
arithmetic over what came back.

- **`ymdIn(iso, tz)`** — the sortable `YYYY-MM-DD` key the grid needs.
  `dayIn` produces a label for a human and cannot key a cell. Both take the
  studio's zone, and they must agree about which day it is. Checked directly:
  8pm Monday in New York is Tuesday in UTC, so a naive grouping files a Monday
  evening class under Tuesday for a guest in Berlin. `ymdIn` files it under
  Monday, which is the day the studio and the student both mean.
- **The grid is a day filter, not a replacement.** The list stays. A grid
  answers "which Saturday" and a list answers "the soonest thing"; the
  prototype has only the grid and is worse for it.
- **Month paging walks months that HAVE something**, not calendar months —
  skipping an empty November beats showing it. Prev/next disable at the edges
  of what was loaded.
- **The calendar cell count differs by mode.** Sessions show seats left;
  appointment slots have no seat count, so the cell shows how many start times
  are free. Both answer what a cell exists to answer.

**A correction made while walking it.** The list was first scoped only by day,
so paging to October left September at the top of it — a grid and a list side
by side disagreeing about which weeks they described. The list is now scoped to
the visible month, then narrowed to a chosen day.

**Verified in a browser, both booking modes.** EVENT: September and October
grids, correct seat counts per day, day filter cutting four sessions to one,
prev/next disabling at each end. APPOINTMENT: 287 slots across three months,
grid counting start times per day, one click cutting the list to that day's 12.

**No new automated tests, and this is why.** G4 is entirely inside
`clientScript`, a string of browser JavaScript, and this repo has no client
test harness — which is exactly why the standing rule is to walk the UI in a
browser before committing. The server behaviour it depends on
(`getPublicAvailability` over a range) was already covered. Asserting that a
string contains another string would have been coverage in name only.

### Fixed in passing: an expired fixture

`tests/public/course-enrollment.test.ts` pinned its cohort to
`startLocalDate: '2026-09-01'`, which stopped being in the future on
2026-09-02 and took three tests with it — a started cohort answers
`COURSE_ALREADY_STARTED`, so the failures were about a date, not a defect. Now
relative. It surfaced on the regression run for every stage from G1 onward,
which is what a test with an expiry stamped on it costs.

---

## G5 — Confirmation extras

Today: class, when, with whom, places, travel, total, manage link.

Add, in this order of worth:

1. **A booking reference.** There is no short human-quotable id. `cancelToken`
   is 32 random bytes and must never be shown. A `Booking.reference` column —
   short, per-organization unique — is the honest fix, and it is a migration.
   Until then, show nothing rather than a truncated uuid.
2. **Preparation notes** from G3, which is where a guest will actually read them.
3. **Add to calendar.** Nothing in `src/` emits `VCALENDAR` — grep confirms it.
   A small `text/calendar` route on the booking token, or a `data:` URI built
   client-side. Not a library.
4. **Print** — a `@media print` block, not a button.

Items 2–4 need no migration. Item 1 does, and can wait for a migration that has
another reason to exist.

### What shipped, 2026-09-02

All four, including the reference. `tests/public/confirmation-extras.test.ts` —
11 tests. Migration `20260902140000_booking_reference`, applied to all three
databases.

**The reference is a GENERATED column, which made item 1 far cheaper than this
plan assumed.** `reference` is `GENERATED ALWAYS AS (upper(substr(replace(id,
'-', ''), 1, 8))) STORED`. Three things fall out of that:

- **Bookings are created in four places** — `bookSeats`, `bookAppointment`, the
  hold path and the course fan-out. A column the database fills cannot be
  forgotten by a fifth one added later.
- **Existing rows got one for free.** No backfill, no ordering question, no
  migration that behaves differently on a busy database than an empty one.
- **Writing it raises**, which is the guardrail that keeps it derived rather
  than drifting into a second identity for the booking. There is a test that
  asserts the failure.

Hex, uppercased. The alphabet is 0–9A–F, which contains no O, I or L — so 0 and
1 cannot be misread as letters when somebody reads it down a phone.

**Deliberately not unique, and this is the interesting call.** Eight hex
characters of a v4 uuid is 4.3 billion values, and a collision inside one
studio is remote — but a unique index would turn that remote event into a
**failed booking**. A reference is a convenience for quoting, not a key: two
bookings sharing one costs a studio a second glance, where a rejected booking
costs them a customer. Indexed for lookup, not constrained.

**The .ics is served, not built in the browser.** `GET
/public/bookings/:token/calendar.ics`. A route works from the confirmation
EMAIL, where there is no page script to build a blob, and on a phone, where
tapping a `text/calendar` URL opens the calendar app and tapping a `data:` URI
is unreliable. `ics.ts` is about forty lines and hand-written: the format
needed is one VEVENT with six properties, which is not worth a dependency to
audit and ship.

Two details in it that a library would have handled and a naive version would
not: RFC 5545 line folding measured in **octets, not characters** (a studio
called "Café Céramique" is longer than it looks, and folding on character count
splits a multi-byte character across two lines, which fails an import with a
message nobody can act on), and the UID carries the **booking id, not the
token** — a UID syncs onward into other calendars and devices, and the token is
a credential.

**Where each piece landed.** Reference and calendar link on both the in-flow
confirmation and the manage page; preparation notes on the manage page, which
is where somebody actually reads them — it is the page they return to the night
before, from the link in their email. Print is a `@media print` block, not a
feature.

**Caught while checking the print rules:** the Cancel button was not marked
`no-print`, so a paper copy would have carried a red rectangle offering to
cancel the booking it was a record of.

**Walked in a browser.** Took a real booking, read reference `76E23D43` on the
confirmation and the manage page, downloaded the .ics and unfolded it back to
the original text with no line over 75 octets.

---

## G6 — Browse and filters — SKIPPED 2026-09-02

**Decided, not deferred.** Both of this stage's own conditions still argued
against it after G0–G5 shipped, and Suren agreed to close it rather than leave
it open. The trigger below stands: if the median studio ever passes roughly a
dozen bookable things, reopen it with real numbers from `/admin`. Nothing about
this demo will produce those numbers.

The original reasoning follows, unchanged.

---


The demo's storefront — hero search, category filter, date filter, an index of
everything, an empty state — exists because a tour operator runs dozens of
activities.

**Kiln House has three services.** A search box over three cards is worse than
no search box: it implies there is something to find.

**The trigger, written down so it is not re-litigated:** build this when the
median active studio passes roughly a dozen bookable things (services plus open
cohorts). Until then a longer service list is the correct answer, and it is what
we already have. Revisit with real numbers from `/admin` — not from this demo.

---

## G7 — Export on Bookings and Customers — SKIPPED 2026-09-02

**Decided, not deferred.** No asker on record, and the comparison that
suggested it turned out to be five buttons of which three do nothing. Reopen
when a studio asks, and build the one they asked for.

The original reasoning follows, unchanged.

---


**The state of play.** The demo has five Export buttons and all five are toasts.
We have two real ones and three absent:

| Screen | Demo | Ours |
|---|---|---|
| Payments | toast | Real CSV — `Payments.tsx:720` |
| Reports | toast | Real CSV per tab — `Reports.tsx:806` |
| Manifest | toast (PDF) | Real `window.print()` + print stylesheet — `Register.tsx:246` |
| Bookings | toast | **Absent** |
| Customers | toast | **Absent** |

**Why this is conditional rather than TODO.** The comparison cannot justify it.
Reading five buttons against two says we are behind by three, but three of the
five do nothing at all, so the demo is evidence of *an operator wanting a
button*, not evidence of a working feature anyone relied on. `Payments.tsx:710`
already records where our two came from: a reconciliation CSV is the one export
request that comes from **outside** the studio — an accountant asks for it.
Neither a bookings list nor a customer list has an equivalent asker on record.

**The trigger:** build it when a studio asks, and build the one they asked for.
If it lands, reuse the existing helper shape — Blob, `text/csv;charset=utf-8`,
leading BOM so Excel opens it as UTF-8 — rather than writing a third variant.

**Cheap and worth doing regardless:** the exports we have export *what is on
screen*, filters included. Whatever is added must do the same, or the file will
not match the list the operator was looking at when they clicked.

---

## Declined, with reasons

- **Adult/child pricing tiers.** The demo prices one activity for two ages.
  Ceramics studios run a kids' class as a *different service* — different
  duration, different clay, different supervision ratio. Modelling it as a price
  tier on one service would be modelling tours, not studios. Declined until a
  real studio asks.
- **A tax line.** US sales tax on instructional classes varies by state and is
  frequently not owed at all. A wrong tax line is worse than none, and getting
  it right is a project, not a row in a summary. Out of scope here.
- **PayPal.** We are Stripe Connect end to end. Adding a second processor for
  parity with a prototype that charges nobody is not a trade worth making.
- **"Pay Later."** We already have it: it is what every booking does today when
  no deposit is configured. It needs a label in the summary, not a payment
  method.
- **Reviews and ratings.** No review system exists. The demo's are hardcoded
  strings. Inventing the display without the substance is the "fake number to
  fill the slot" that `analytics.service.ts:443` already declined once.

---

## The open decision: waivers

**This one is not mine to close.**

The product has a recorded stance that waivers do not exist —
`analytics.service.ts:443` and `dashboard.service.ts:335` both say so, and two
dashboard rows were built as deliberate substitutes rather than fake a waiver
metric. That decision was about **not inventing a number**. It was not a
decision never to build the thing.

The case for building it: a studio running wheels and kilns has a physical-risk
profile a tour operator would recognise, and studios in the US do collect
liability releases today, on paper.

The case against: it is genuinely net-new — a document per organization, a
signature captured and stored per booking, retention rules, and operator
visibility of who has signed. It is a workstream, not a step in a flow. And
`OPEN DECISIONS` item 2 says the binding constraint on Phase 2 is that **nobody
has talked to three US ceramics studios yet**. Waivers rest on inference about
how a studio actually works, which is exactly the category that document says to
interview before building, not after.

**Recommendation: put it on the interview list, not the build list.** Ask the
three studios whether they collect a release and how. If two of three do, it is
a workstream with a known shape. If they do not, we did not build it.

I said last session that the waiver was a top priority. That was before I found
the recorded stance, and it was wrong to rank it above the checkout wiring —
which is finished code with no caller, and which no interview is needed to
justify.

---

## Order of work, and the checkpoint

> **CLOSED 2026-09-02.** G0–G5 shipped in order; G6 and G7 were skipped by
> decision. See "Where this ended up" below. The plan as originally written
> follows.

**Do G0, then G1 and G2, then stop and reassess.** Not all eight.

**G0 first, and on its own.** It is the only one of the three that is blocked by
nothing — no Stripe approval queue, no guest-page rewrite — and it carries a
defect fix that should not wait behind a feature. Ship the Dashboard link fix
even if the form slips.

G1 and G2 are wiring: no migration, no new server code, no new tests of business
logic — only tests that the page reaches the logic that already exists. Both
ship money. Together they answer the question this plan cannot answer from the
outside, which is how much of the booking page's client script survives contact
with a redirect to Stripe and back.

G3 is the first stage with a migration and should be judged after G0–G2 have
shown what the client costs.

G4, G5, G6 and G7 are independent of each other and can be dropped, reordered,
or picked up individually.

**Before calling this document complete**, do the operator-screen sweep named at
the end of the Method section. Three of the four no-caller findings turned up
without looking hard, and the fourth was missed entirely until someone asked —
which is a poor basis for believing there are only four.

---

## Where this ended up — 2026-09-02

Six stages shipped in one day: G0, G1, G2, G3, G4, G5. G6 and G7 were skipped
by decision, both because their own written triggers still argued against them.

**37 new tests**, two migrations, and every stage walked in a browser rather
than only asserted.

| | Shipped | Tests | Migration |
|---|---|---|---|
| G0 | Manual booking at the counter | 5 | — |
| G1 | Checkout + price summary | 10 | — |
| G2 | Courses on the booking page | 8 | — |
| G3 | Service detail view | 8 | `20260902120000_service_detail_fields` |
| G4 | Month calendar picker | — (browser) | — |
| G5 | Confirmation extras | 11 | `20260902140000_booking_reference` |

### What the plan got wrong, and what that cost

Worth keeping, because the pattern is more useful than the individual errors:

- **`depositType: 'none'` means pay in FULL, not pay nothing.** The plan said
  the opposite. Building to it would have shipped a page that never asked
  anybody for money. Found by reading `depositFor`, not by testing.
- **The reference was assumed to need a backfill.** A `GENERATED ALWAYS` column
  made it cheaper than the four stages that supposedly did not need migrations.
- **"No new server code" for G1 was optimistic.** Keeping the deposit
  arithmetic in one place cost one small read endpoint.
- **`String[]` for highlights had no precedent** in a schema with no array
  columns and an established text-and-split idiom.

Every one of those was found while building the thing, not while planning it.
Two of them — the deposit and the drop-in-priced course container — would have
been money defects in production.

### Three live defects found by walking screens, not by reading code

- **The Dashboard's "New booking" button went to a list with no form.** The most
  prominent control on the first screen an owner sees named an action the
  product could not perform.
- **A `COURSE_SERIES` service was on sale as a drop-in.** One week of a $480
  course for $95. Invisible only because no studio had a cohort yet.
- **The Cancel button would have printed** on a customer's paper copy of their
  own booking.

### What is still open

- **A studio cannot sell a course until Stripe onboarding completes.**
  `enrollPublic` refuses any priced cohort, so there is no unpaid path for one
  the way there is for a class. A product decision made earlier; G2 is what
  makes it visible to customers. `OPEN DECISIONS` item 3 is the queue it waits
  on.
- **Credits and class packs do not appear in the public flow at all.** Not a
  regression from G1 — grep found zero references before it — but now that the
  page takes card payment, "I already have a pack" has nowhere to go.
- **Waivers**, still an interview question rather than a build item.
- **The operator-screen sweep** named above has not been done. Four no-caller
  faults were found without looking hard, which is a poor basis for believing
  there are only four.

---

## Constraints that shape all of it

- **Never run git or gh commands.** Suren does version control by hand. Build
  files, say when a commit is the natural next step, stop.
- **Correctness lives in Postgres.** Seat counts move only under
  `SELECT … FOR UPDATE`; holds are taken before Stripe sessions exist. Nothing
  in this plan touches that, and nothing in it may work around it.
- **The suite takes ~40 minutes** and must not be edited while running. The perf
  gate runs alone.
- **Two sessions, two databases.** `booking_test` and `booking_test_b` both
  exist; the second session sets `TEST_DATABASE_URL`.
- **Marketing copy may not describe unshipped features.** A test enforces it. If
  G2 makes courses publicly bookable, the "being built next" copy needs
  revisiting in the same change.
