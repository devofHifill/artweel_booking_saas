# Booking SaaS

Multi-tenant booking platform for ceramics studios — classes, private lessons
and mobile parties, in one schedule that knows how many wheels the studio owns.

**Phase 0 and Phase 1 are complete.** 327 tests plus an isolated performance
gate. The scheduling core was built first and proven before any screen existed
to hide its failures: overbooking, timezone drift and resource collisions are
prevented by database constraints, not by application code remembering to check.

Two packages, no workspace root — `server/` (Express + Prisma) and `client/`
(React + Vite) each have their own `package.json`.

Requires **Node 22+** and Docker.

---

## Getting started

Start Postgres (with PostGIS) and Redis:

```bash
docker compose up -d
```

Install both packages:

```bash
cd server && npm install && cd ../client && npm install
```

Create the server environment. The defaults in `.env.example` work as-is for
local development — third-party keys are optional and fall back to in-memory
fakes:

```bash
cd server && cp .env.example .env
```

Apply migrations and generate the Prisma client:

```bash
cd server && npx prisma migrate deploy && npm run prisma:generate
```

Set up the test database (a separate one, because the suites truncate freely):

```bash
cd server && node scripts/deploy-test-db.mjs
```

Confirm it all works:

```bash
cd server && npm test
```

Seed a demo studio. This prints the booking page URL and a login:

```bash
cd server && npm run db:seed
```

Then run the two dev servers in separate terminals — API on 4000, dashboard on
5173:

```bash
cd server && npm run dev
```

```bash
cd client && npm run dev
```

| URL | What it is |
|---|---|
| `http://localhost:4000` | Marketing site |
| `http://localhost:4000/public/clay-and-co` | A studio's public booking page |
| `http://localhost:5173` | Studio dashboard |
| `http://localhost:4000/api/health` | Asserts Postgres, PostGIS and btree_gist are live |

### Secrets

`server/.env` is gitignored and must stay that way. `server/.env.example` is the
committed template and has to stay in step with `src/config/index.ts` — the app
validates its environment at startup and refuses to boot on anything missing,
so a stale template turns a fresh clone into a guessing game.

For anything deployed, generate real values:

```bash
openssl rand -base64 48
```

### Ports

Postgres is on **5434**, not 5432 or 5433. This machine has a native Windows
Postgres bound to `0.0.0.0:5433`, and it wins the race for IPv4 localhost over
Docker's port proxy — clients silently connect to the wrong server and fail
authentication with a confusing credentials error. Redis is on 6380.

### Postgres is not interchangeable here

The image is `postgis/postgis:16-3.4` and two extensions are mandatory:

| Extension | Why it is required |
|---|---|
| `btree_gist` | Lets an EXCLUDE constraint combine equality (`staff_id`) with range overlap (`tstzrange`). Without it the most important constraint in the system cannot be created. |
| `postgis` | Service-area containment for mobile bookings. |

`GET /api/health` asserts both are installed rather than assuming it.

---

## What Phase 0 has established

### Three concurrency guarantees, all enforced by the database

| Guarantee | Mechanism | Where |
|---|---|---|
| A session can never be oversold | Row lock (`SELECT … FOR UPDATE`) + `CHECK (seats_taken <= capacity)` | `sessions` |
| A staff member cannot be in two places at once | `EXCLUDE USING gist (staff_id WITH =, tstzrange WITH &&)` | `staff_time_blocks` |
| An exclusive resource cannot be double-allocated | Partial `EXCLUDE`, `WHERE (exclusive)`, kept honest by a `BEFORE` trigger | `resource_allocations` |

Counted resources (eight wheels) deliberately use a *different* mechanism —
a locked row plus a `SUM` — because no exclusion constraint can express
"at most eight".

### Why `staff_time_blocks` exists

Postgres cannot enforce an exclusion constraint across two tables. If
appointments lived in `bookings` and classes lived in `sessions`, an instructor
with a 2pm private lesson and a 2pm group class would collide undetected.

Both write into one table instead. One table, one constraint, no possible
overlap. External calendar events deliberately do **not** live here — see
`busy_blocks`, which carries no constraint because a Google sync must never
fail just because someone double-booked themselves in Google.

### What was deliberately not carried over from the WordPress plugin

| Plugin behaviour | Why it was dropped |
|---|---|
| `UNIQUE KEY (staff_id, booking_date, booking_time)` | Only caught identical start times. A 60-min booking at 10:00 and a 30-min at 10:30 both inserted. |
| `staff_id = NULL` for event bookings | MySQL permits unlimited NULLs in a unique index, so events had no protection at all. |
| Read seat count → decide in PHP → insert | Textbook check-then-insert race. Two simultaneous bookings for the last seat both won. |
| `DATE` + `TIME` columns, mixed `strtotime`/`gmdate` | No timezone anywhere. Fine for one studio in one city; broken for a US multi-tenant product. |
| Live Google Calendar API call inside slot generation | External network call on the read path. Availability now reads a local mirror only. |
| `md5(booking_id + email)` cancel token | Guessable by anyone who knows the customer's email. Now 32 random bytes. |
| Global unique keys (`categories.name`, `staff.email`) | Break the instant a second tenant exists. Every unique is now composite with `organization_id`. |

---

## Gate status — PHASE 0 COMPLETE

All four exit conditions pass. **76/76 tests green**, typecheck clean.

| # | Condition | Status |
|---|---|---|
| 1 | Zero overbooking under concurrency | **PASS** |
| 2 | DST correctness across two US timezones | **PASS** |
| 3 | Availability p95 < 200 ms over 31 days | **PASS** — p95 156 ms, median 132 ms |
| 4 | Zero cross-tenant reads or writes | **PASS** |

### Condition 1 — concurrency

- 100 simultaneous requests for the final 5 seats → exactly 5 bookings, 95
  typed 409 failures, `seats_taken = 5`
- 20 requests for 3 seats each against a capacity of 10 → exactly 3 win
- Partial overlaps, contained overlaps and cross-type (appointment vs class)
  collisions all rejected; genuinely back-to-back bookings all allowed
- 20 simultaneous single-wheel allocations against 8 wheels → exactly 8 win
- Holds and direct bookings competing for one pool of 10 seats → exactly 10 win
- Direct SQL writes that bypass the service layer are still rejected

That last point is the one that matters: the guarantee lives in Postgres, not
in application code.

### Condition 2 — time

- A weekly 7pm class holds 7pm across both 2026 transitions, in New York and
  Los Angeles; the two coasts stay exactly 3 hours apart throughout
- 02:30 on spring-forward Sunday does not exist → moved forward to 03:30 and
  reported as `shifted`
- 01:30 on fall-back Sunday happens twice → first occurrence chosen (still
  EDT) and reported as `ambiguous`
- 09:00–17:00 local is 7 real hours on spring-forward Sunday, 9 on fall-back
- America/Phoenix (no DST) stays at a flat 24 hours

Rule validity is an **instant** comparison, not a date one — `effectiveUntil`
of `2026-06-16T00:00:00Z` is 15 June 20:00 in New York, so a 10am class on the
16th is correctly excluded. This is the classic off-by-one-day bug.

### Condition 3 — performance

The budget is met structurally: every read happens up front in a fixed number
of queries, and everything after that is in-memory set arithmetic. The suite
asserts that a 1-day and a 31-day query issue **the same number of queries**,
and that `fetch` is called zero times during availability.

First implementation measured **251 ms** — it expanded each RRULE once per
staff *per day* (248 parses for a month). Expanding once per range and
bucketing by date brought it to **156 ms p95**. Work now scales with the
number of rules, not the length of the window.

### Condition 4 — tenant isolation

Every test supplies a **valid ID belonging to another studio** — the realistic
attack, an authenticated user of studio A passing studio B's identifiers.
Seat booking, holds, hold conversion and release, cancellation, session
cancellation, resource allocation and availability all reject with 404 and
leave the victim's data untouched. Two studios can share a category name and
employ the same freelance instructor by email; duplicates within one studio
are still rejected.

---

## Layout

```
docker-compose.yml            postgis + redis
docker/postgres-init/         creates booking_test and booking_shadow
server/
  prisma/
    schema.prisma             core domain
    migrations/
      *_init_core_domain/     Prisma-generated DDL
      *_concurrency_constraints/  hand-written: EXCLUDE, CHECK, trigger
  scripts/deploy-test-db.mjs  migrate against TEST_DATABASE_URL
  src/
    config/                   zod-validated env, read once
    lib/                      logger, AppError + BookingErrorCode, prisma
    middleware/               error handler, 404
    modules/health/           asserts extensions are present
    scheduling/
      pg-error.ts             SQLSTATE → typed booking error
      session.service.ts      creates sessions AND their staff time blocks
      booking.service.ts      bookSeats, bookAppointment, cancelBooking
      hold.service.ts         createHold, convertHold, releaseHold, sweep
      resource.service.ts     counted and exclusive allocation
      time/zoned.ts           DST policy, interval algebra
      time/recurrence.ts      RRULE → local dates → per-date wall clock
      travel/travel.ts        haversine, caching, fee bands
      availability/           the engine
  tests/
    helpers/fixtures.ts       studio fixture, db reset
    gate/                     the exit-gate suites
```

## Commands

```bash
npm test
```

```bash
npm run test:perf
```

```bash
npm run typecheck
```

`npm test` runs everything except the wall-clock timing suite, which lives in
`tests/perf/` and runs alone via `npm run test:perf`. That split is
deliberate: the same measurement reported 146 ms isolated and 234 ms sharing a
process with the scrypt-heavy auth tests. A gate that fails because of what
else was on the CPU is a gate people learn to ignore, so the structural
invariants that hold under any load (query count, no network on the read path)
stay in the default run and only the stopwatch moved.

```bash
npm run prisma:migrate
```

```bash
npm run dev
```

## Phase 1 — Self-Serve MVP (in progress)

| Workstream | Status |
|---|---|
| W1.1 Auth and tenancy | **DONE** — 32 tests |
| W1.2 Admin CRUD | **DONE** — 45 tests |
| W1.3 Public booking page | **DONE** — 21 tests |
| W1.4 Payments (Stripe Connect) | **DONE** — 35 tests |
| W1.5 Notifications | **DONE** — 28 tests |
| W1.6 Google Calendar sync | **DONE** — 26 tests |
| W1.7 Owner dashboard | **DONE** — 19 tests |
| W1.8 Onboarding and billing | **DONE** — 24 tests |
| W1.9 Marketing site and SEO | **DONE** — 22 tests |

### W1.1 — Auth and tenancy

**Identity is global, authority is per-studio.** The organization is
deliberately *not* baked into the access token: a freelance instructor
genuinely teaches at three studios, and encoding tenancy in the token would
force a re-login to switch. Two middlewares answer two questions —
`authenticate` (who is this) and `withOrganization` (what may they touch).

| Decision | Reasoning |
|---|---|
| scrypt, not argon2id | Ships inside Node — no native module to build on Windows or in a slim CI image. Memory-hard, OWASP-listed. Parameters travel with the hash, so cost can be raised without invalidating passwords. Never bcrypt: it truncates at 72 bytes. |
| Refresh rotation + family revocation | A replayed token means either a client retry or a theft, and we cannot tell which — so the whole rotation lineage dies. Turns a stolen token from a permanent backdoor into a self-limiting incident. |
| Tokens stored as SHA-256 | A leaked database yields no usable sessions. Not password-hashed: 32 random bytes need no stretching. |
| 404, not 403, for non-members | 403 confirms the studio exists, letting an outsider enumerate organizations by id. |
| Identical login failure for wrong password and unknown email | Otherwise login is a free membership oracle. A decoy hash is verified for missing users so latency does not leak either. |
| Validation *replaces* `req.body` | Undeclared fields are stripped, so mass assignment is closed by construction rather than by remembering to check. |
| Password reset revokes all sessions | People reset because they think someone else has the password. Leaving sessions alive defeats the exercise. |
| Always 202 on forgot-password | Same enumeration concern. |

Covered by tests: `alg: none` bypass, cross-secret forgery, tampered
signatures, refresh replay, mass assignment, email casing, last-owner
protection, and cross-studio access to every organization route.

### W1.2 — Admin CRUD

Everything a studio owns hangs off `/api/organizations/:organizationId`, and
`authenticate` + `withOrganization` run once on that router **before any child
route exists**. A new module cannot forget its tenant check, because there is
nowhere to forget it. Handlers read `req.tenant.organizationId`, already proved
to belong to the caller, and never trust an id from a body or query string.

**Nothing with history is ever hard-deleted.** A booking is part of the
studio's financial record; deleting the service, instructor or location it came
from would orphan a customer's receipt. Delete returns 409 and points at
deactivation, which is what the studio almost always meant.

Validation exists to stop damage that surfaces *later*, in front of customers:

| Refusal | What it prevents |
|---|---|
| Class capacity below seats already sold | `seats_taken > capacity` would trip the CHECK constraint on some unrelated later write, with an error nobody can explain |
| Equipment quantity below peak committed usage | Nothing fails at edit time — it fails on the day, when the wheels aren't there. Uses a sweep line over allocation boundaries, so two non-overlapping 4-wheel classes peak at 4, not 8 |
| Day off when bookings exist | Availability would stop offering the slot while the booking stayed live; the customer arrives and nobody is there |
| Deactivating staff with upcoming commitments | Same failure, from the other direction |
| Service area with no centre or radius | Every address silently counts as in range, so the studio starts accepting jobs three hours away |
| Travel bands not in ascending order | Lookup takes the first band covering the distance, so the customer is charged a price nobody intended |
| Policy tiers not in descending order, or missing a 0-hour tier | The first matching tier wins; a bad ladder quietly applies the wrong refund terms |
| Exclusive resource with quantity > 1 | The EXCLUDE constraint permits one allocation regardless, so the extra units would never be usable |
| Unparseable RRULE | The instructor becomes silently unbookable forever, with no error anywhere |

Cancellation terms are **data, not code** — every studio wants different terms
and they change seasonally. Encoded in application logic, each change is a
deploy, which for a self-serve product with nobody staffing support is not
viable. `evaluatePolicy` is pure and shared, so the quote a customer is shown
and the money actually moved can never disagree.

`GET /schedules/:staffId/rules/:ruleId/preview` turns an RRULE into real dates
with DST anomalies flagged (`shifted` / `ambiguous`), because a wrong recurrence
pattern otherwise fails silently.

### W1.3 — Public booking page

Live at `/public/:slug`. Seed a demo studio with `npm run db:seed` and open
`http://localhost:4000/public/clay-and-co`.

**Server-rendered, not a client bundle.** This is the link a studio puts in its
Instagram bio: it has to paint fast on a phone over mobile data and be legible
to a crawler, because "pottery classes brooklyn" is a search a studio wants to
win. The service list is real HTML in the first response with JSON-LD attached;
the step flow is progressive enhancement on top of it. One request, no build
step, nothing loaded from a CDN.

**The flow adapts rather than asking pointless questions.** A studio with one
venue never sees a "choose a location" step. A class skips the instructor step;
an appointment includes it. A mobile booking inserts an address step — and asks
for it *before* any time is chosen, because letting somebody pick a slot and
then telling them they are out of range is the worst thing a mobile flow can do.

**What the public surface deliberately withholds:**

| Withheld | Why |
|---|---|
| Staff email and phone | Explicit `select`, so adding a column can never silently publish it |
| Instructors marked private | Filtered at the query, not the template |
| Service-area centre coordinates | That point is frequently the owner's home address |
| Exact distance in coverage replies | Three requests would trilaterate the centre |
| `noindex` on the manage page | The token in the URL *is* the credential |

Bookings are re-validated against live availability before writing. The
exclusion constraint would catch a stale page anyway, but a customer deserves
"that time has just been taken" rather than a 500.

### W1.4 — Payments (Stripe Connect)

**Express accounts, direct charges, no application fee.** The studio is the
merchant of record: money lands in their balance, they own the dispute, and we
never hold customer funds. Standard accounts would drop a one-person pottery
studio into Stripe's full dashboard; Custom would make us responsible for their
compliance. Taking a cut of revenue is the exact thing our pricing positions
against, so there is no `application_fee_amount` anywhere.

**The order of operations is the design.** Seats are held *first*, then the
customer goes to Stripe. Reversed, somebody can be three fields into their card
details when the last seat sells, and the failure arrives after payment instead
of before. The Stripe session is also forced to expire no later than the hold,
or a customer could pay for seats already returned to the pool.

**The webhook creates the booking, not the browser redirect.** A customer who
pays and immediately closes the tab must still end up booked, so nothing
depends on them coming back.

| Guard | Why |
|---|---|
| `express.raw` mounted **before** `express.json` | Stripe signs exact bytes; a reparsed body cannot verify, and the failure looks like a bad secret rather than middleware order |
| Unique `(provider, event_id)` | Stripe retries and does not promise single delivery — a redelivered `checkout.session.completed` would otherwise create a second booking |
| Duplicates still return 200 | A non-2xx makes Stripe retry a duplicate forever |
| No amount field exists in the checkout schema | The price is computed from our own records; a client-supplied total has nowhere to be supplied |
| Hold released if Stripe errors | Otherwise seats sit reserved for a checkout that will never exist |
| `chargesEnabled` mirrored from Stripe | An account can exist, look finished, and still be unable to charge |
| Deterministic refund idempotency keys | A double-clicked refund cannot return the same money twice |

Refunds use the **same `evaluatePolicy`** the customer saw quoted on the manage
page, so the promised number and the paid number cannot disagree. They are
apportioned across the payments that actually happened — a deposit and a
balance are two charges, possibly on two cards, and "refund 50%" has to be
split, most recent first.

**Money lives in its own table.** The old plugin kept `payment_status` and
`transaction_id` as columns on the booking, which cannot represent a deposit
plus a balance plus a partial refund — exactly what a $450 mobile party needs.

**Testing without Stripe:** the provider sits behind an interface with a fake
implementation that signs real HMACs. That is not a shortcut around testing
payments — it is what makes the dangerous paths reproducible. Real Stripe
cannot be asked to redeliver a webhook on demand, deliver it before the
redirect, or fail a signature check, and those are where money gets lost.
With no `STRIPE_SECRET_KEY` configured the fake is used automatically; config
refuses to boot in production without real keys.

### W1.5 — Notifications

**A transactional outbox, not inline sending.** Messages are written as rows
and drained by a worker. Sending inside the request would let a slow email
provider fail a booking, and would lose the message entirely if the process
died mid-send.

**Reminders are dated rows, not timers.** A `setTimeout` lives in one process
and dies with it; a row with a future `scheduled_for` survives a restart, a
deploy and a crash.

**Claiming uses a lease, not a status flag.** The worker pushes
`scheduled_for` forward and increments `attempts` inside
`FOR UPDATE SKIP LOCKED`. Several workers can drain one queue without ever
being handed the same message, and a worker that dies mid-send strands
nothing — the row simply becomes due again. No reaper, no rows stuck in
`PROCESSING` forever. Sending happens *outside* the transaction, because
holding a database connection across a call to an email provider is how a
pool dies.

| Rule | Why |
|---|---|
| Opt-out beats consent, always | Someone who replied STOP has not resubscribed by ticking a box later. TCPA requires an explicit opt-in, and getting it wrong is per-message statutory damages |
| Quiet hours apply to reminders, **not** confirmations | Somebody booking at 11pm is plainly awake; holding their receipt until 8am reads as a failed booking |
| Skipped SMS is a row with a reason | "They replied STOP in March" is a very different support answer from "we have no number for them" |
| Permanent vs transient failures classified | Retrying a malformed address five more times delays every message behind it |
| `dedupeKey` unique per booking/template/channel | A retried Stripe webhook must not produce two confirmation emails |
| Destination and body snapshotted at enqueue | A customer changing their email tomorrow must not redirect a message queued today |
| Reconciliation sweep | The outbox row is written just *after* the booking commits — keeping the scheduling core ignorant of notifications is worth more than closing a millisecond window, so a sweep catches anything orphaned by a crash in it |

Studios can override any message. Substitution is deliberately dumb —
`{{token}}`, no loops, no conditionals — so a studio owner editing their
confirmation cannot write something that throws at send time, and unknown
tokens collapse to nothing rather than showing a customer `{{staffLine}}`.

Inbound STOP/START is handled at `/webhooks/twilio/sms` with signature
verification. Twilio auto-replies on its own, but only *it* would know the
opt-out happened — our database would carry on queueing messages that get
silently dropped, which looks like working software and is not.

### W1.6 — Google Calendar sync

**The loop guard is the reason this workstream is hard.** Everything we write
to an instructor's calendar comes straight back on the next push. Without a way
to recognise our own events, a class we publish returns as a busy block, blocks
its own time, and makes its remaining seats unbookable.

The previous WordPress implementation hit exactly this and worked around it by
switching calendar checks off for event-type services — fixing the symptom by
deleting the feature. Here, an event is recognised as ours by **two independent
signals**: a private marker written into the provider's own metadata, and a row
in `calendar_event_links`. Belt and braces, because a marker can be stripped by
a calendar client and a link row can be lost.

**Per-instructor OAuth, not a service account.** A service account means one
shared identity reading one hard-coded calendar — it cannot represent "each
instructor's own calendar", and every studio would point at the same place.
Scope is `calendar.events`, not full `calendar`: asking for less is the
difference between an instructor clicking Allow and closing the tab.

| Decision | Why |
|---|---|
| Refresh tokens AES-256-GCM encrypted at rest | A refresh token is a long-lived key to somebody's calendar; a leaked dump or a stray `SELECT` must not hand it over |
| `invalid_grant` → `NEEDS_REAUTH`, no retry | Terminal. Retrying a dead credential forever while the calendar silently stops syncing is the worst outcome |
| 410 on the sync cursor → full rebuild | We cannot know what was missed; a stale busy block would make an instructor permanently unavailable |
| Watch channels renewed before expiry | Google caps them at ~a week. Miss it and inbound sync stops with no error anywhere |
| Push token verified against the stored channel | Otherwise anyone who guesses the endpoint can trigger syncs |
| Transparent ("free") events ignored | Their calendar, their call — a tentative lunch marked free should not block a booking |
| Busy blocks deleted on disconnect | Otherwise the instructor stays permanently unavailable for times their calendar no longer claims |

Outbound writes go through the same lease-claim queue as notifications, so
Google being slow cannot slow a booking and a crash cannot lose a write.
Repeated edits to one booking collapse into a single pending job.

### W1.7 — Owner dashboard

React + Vite in `client/`, proxying `/api` to the server. Run both, then sign
in with the seeded owner account printed by `npm run db:seed`.

```bash
cd client && npm run dev
```

**A studio booking by phone goes through the same scheduling core as a
customer on the website.** A back door that skips the overlap and capacity
rules is how double bookings get created by the people least able to explain
them. The one deliberate difference is that manual booking ignores the
minimum-notice window — that rule exists to protect prep time on the website,
and a customer standing at the desk is exactly who it was never meant to stop.

**Drag-to-reschedule is a convenience over the real mechanism, not a
replacement for it.** The drop calls the same reschedule endpoint the
customer-facing flow uses, which cancels and rebooks through the core. Verified
in the browser: dragging a lesson from 10am to 2pm moved it; dragging a second
lesson onto that same slot was refused by the `EXCLUDE` constraint with *"That
time is no longer available for this instructor"*, and the card stayed put.
The Phase 0 database guarantee holds all the way up through the UI.

| Decision | Why |
|---|---|
| Times rendered in the **studio's** zone, never the browser's | An owner checking today's schedule from an airport must see when customers actually turn up |
| One refresh in flight, shared by all callers | Five parallel 401s would otherwise fire five refreshes, four of them replays of a rotated token — and rotation treats a replay as theft |
| Cancelled bookings excluded from customer counts | A reschedule is cancel-then-rebook, so counting them shows "2 bookings" for one moved appointment |
| Bulk cancel reports per booking | A studio cancelling a snow day needs to know which ones went, not one failure hiding nineteen successes |
| Today view leads with alerts | A studio cannot discover a dead calendar connection or a failed reminder batch on its own |

### W1.8 — Onboarding and billing

**The gate condition is met.** Walked in a browser as a brand new studio:
signup → "Set up my studio" → "Publish my booking page" → a live page that
took a real customer booking. **Four interactions and one form.**

The signup captured the browser's timezone (`Asia/Calcutta` in that run), and
the seeded 10:00–18:00 working hours, the generated availability and the
resulting booking all landed correctly at 10:00 *local* — the timezone chain
holds from signup to slot.

**Setup seeds rather than asks.** Three classes, an instructor, opening hours,
a cancellation policy and equipment, all typical for a ceramics studio. The job
becomes editing, not inventing. It is idempotent and purely additive: a studio
that already made its own class keeps it and gets nothing forced on top.

**Progress is derived from the data, not from a clicked flag.** Somebody who
added a class through the normal admin screens has done that step and is never
asked again — and the wizard cannot drift out of sync with reality.

#### What happens when someone stops paying

This is the part that is easy to get wrong in both directions, so the states
are deliberately distinct:

| State | Studio admin | Public booking page | Data |
|---|---|---|---|
| `TRIALING` | full | live | — |
| `PAST_DUE` | **full** | **live** | — |
| `SUSPENDED` | read-only | shows "not taking bookings" | intact |
| `CANCELED` | read-only | shows "not taking bookings" | intact |

`PAST_DUE` changes nothing but the warning. A bounced renewal is usually an
expired card, and taking a working studio offline mid-week over an
administrative problem costs them real money. There is a 7-day grace period,
and it is set on the *first* failure only — Stripe retries an invoice several
times, and resetting the clock each time would hand an unpaying account an
indefinite runway.

`SUSPENDED` stops new public bookings, because otherwise the product is free to
anyone who ignores the invoice. It never deletes anything, reads stay open so a
studio can still look up tomorrow's bookings and phone the customers, and the
public page explains itself instead of 404ing.

Billing and onboarding routes are mounted **before** the subscription gate.
Blocking the page where somebody would have paid is the most self-defeating
checkout wall it is possible to build.

Plan limits bite on **create**, never on read: a studio that downgrades keeps
the instructors it already has and simply cannot add more. Refusals name the
plan that fixes them — "upgrade to continue" with no specifics is how a paying
customer becomes a support ticket.

### W1.9 — Marketing site and SEO

Server-rendered at the root: home, pricing, three competitor comparison pages
and three long-form guides, plus `sitemap.xml` and `robots.txt`.

**The copy may not describe a feature that does not ship.** A trial that starts
on a false promise churns in week one and produces refund requests from people
a competitor told the truth to. Piece tracking, kiln loads, courses and
waitlists appear only under a "Being built next — not available yet" heading,
and a test asserts they never appear in shipping copy.

**Comparison pages name what competitors do better.** A page that only attacks
is not believable, and a studio that switches on a false promise churns anyway.
"Momence is a capable product… if you run a yoga or pilates studio, it is a
reasonable choice and we would not pretend otherwise" — then the specific
places it fits a ceramics studio badly.

**No analytics script, no cookie, no consent banner.** Page views are stored as
a daily aggregate with no identifier, and only the referrer *host* is kept — a
full referrer can carry a search query. The number actually worth acting on is
which landing page produced a *trial*, which comes from first-touch
attribution passed once at signup and then discarded.

| SEO decision | Why |
|---|---|
| Unique title and description per page, asserted in tests | Duplicated metadata reliably suppresses a whole set of pages |
| FAQ and Article structured data | Turns a blue link into a result occupying four times the space |
| Unknown paths return a real 404 | A site answering 200 for every URL teaches a crawler that none are meaningful |
| Zero JavaScript needed for content | The visitor is on mobile data; the crawler decides whether anyone ever arrives |
| `Disallow: /public/bookings/`, `Allow: /public/` | A management link contains its own credential; a studio's booking page should be found |

A test parses every JSON-LD block on every page and asserts it is valid JSON
containing no `</script>` — the same breakout the booking page already had.

---

## Phase 1 complete

All nine workstreams done. **327 tests** in the default suite plus the isolated
timing gate, p95 152 ms.

The exit gate was met in W1.8 and verified in a browser: a stranger signing up
and publishing a live booking page that took a real customer booking, in four
interactions.

### What Phase 2 adds

The vertical depth that makes this a category product rather than a cheaper
competitor: course series with attendance and make-up credits, piece tracking
with pickup notifications, kiln and firing management, waitlists and packages,
and the embeddable widget plus WordPress plugin.

Scope is fixed. Every studio interviewed will ask for something adjacent, and
Phase 2 is where that costs the most.

**Twilio A2P 10DLC is now the binding constraint.** The code is done and the
provider adapter is written, but US SMS is filtered by carriers without an
approved campaign — messages look sent and never arrive, which is the worst
possible failure mode. Email-only reminders are the fallback. The **Stripe
Connect platform application** is in the same position: code complete, waiting
on an approval that cannot be shortcut.
