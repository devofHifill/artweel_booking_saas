# Handoff — Artweel Booking SaaS

Paste this into a new chat to resume work.

---

## What this is

A multi-tenant booking platform for **US ceramics studios** — classes, private
lessons and mobile pottery parties. Self-serve SaaS. Evolved from FDG's earlier
WordPress "WP Booking Flow" plugin, which is a design reference only, not code
to port.

**Positioning:** studio management that understands wheels, kilns and travel.
Competitors (Momence, Sawyer, Punchpass) treat location as a text label and
have no concept of equipment.

- Repo: `https://github.com/devofHifill/artweel_booking_saas.git`
- Code: `D:\Projects\2026\booking-saas`
- Spec: `D:\Projects\2026\booking-saas-spec.md`
- Phase plan: `D:\Projects\2026\booking-saas-phases.pdf`

## Status

**Phase 0 and Phase 1 complete and deployed to staging. Phase 2 W2.1 (course
cohorts, including paid checkout) complete locally, not yet deployed.** 385
tests green in the default suite, plus an isolated performance gate at 160ms
p95. Both typechecks clean.

Staging is live and verified at `https://artweel.fillforge.cloud` (marketing +
booking pages) and `https://app.artweel.fillforge.cloud` (dashboard). See
`DEPLOY.md` for the runbook and the section below for the shape.

Shipping: auth/tenancy, admin CRUD, public booking page, Stripe Connect
payments, notifications (email + SMS outbox), Google Calendar two-way sync,
owner dashboard, onboarding + billing, marketing site + SEO, multi-week course
cohorts with all-or-nothing enrolment.

Phase 1 exit gate was met and browser-verified: a stranger signed up, seeded a
studio, published, and the page took a real booking — four interactions.

---

## RULES THAT MUST NOT BE BROKEN

### 1. Never run git or gh commands

Suren does all version control manually — he is deliberately learning it. Do
not run `init`, `add`, `commit`, `push`, or repo creation. Not even `status`
unless asked in that moment. Build files; say when version control would be the
natural next step, then stop.

### 2. Phase 0's guarantees are settled — do not weaken them

Correctness lives in Postgres, not application code:

- `staff_time_blocks` has `EXCLUDE USING gist (staff_id WITH =, tstzrange WITH &&)`.
  Appointments AND sessions both write here, because Postgres cannot enforce
  exclusion across two tables — that is how an instructor with a 2pm lesson and
  a 2pm class gets caught.
- `sessions.seats_taken` is mutated only under `SELECT … FOR UPDATE`, with a
  `CHECK (seats_taken <= capacity)` backstop.
- Exclusive resources (kiln, room, van) use a partial `EXCLUDE WHERE (exclusive)`
  kept honest by a `BEFORE` trigger. Counted resources (wheels) use a locked row
  plus a `SUM` — no exclusion constraint can express "at most eight".
- All instants are `timestamptz`; recurrence stores wall-clock intent + IANA zone
  and is re-resolved per date. Never fixed-millisecond stepping.
- Availability makes **no external network call**; calendars are mirrored into
  `busy_blocks` by a background sync.

### 3. Marketing copy may not describe unshipped features

Piece tracking, kiln loads, courses and waitlists are Phase 2. They appear only
under "Being built next — not available yet". A test enforces this.

---

## ENVIRONMENT GOTCHAS

| Thing | Detail |
|---|---|
| Postgres port | **Fixed — everything is on 15432 now.** A native Postgres owns `0.0.0.0:5433` and beats Docker's proxy for IPv4 localhost (symptom: "invalid credentials" while the container is healthy). 5434 failed for a different reason: Windows reserves blocks of ephemeral ports and **re-rolls them on every reboot** — `5434–5533` was reserved on 2026-08-12 and no longer is. Symptom when it lands on you is `bind: An attempt was made to access a socket in a way forbidden by its access permissions` with nothing showing as a listener. Chasing it a few ports at a time just waits for the next reboot. 15432 is above the range these are drawn from. Inspect with `netsh int ipv4 show excludedportrange protocol=tcp`. |
| Test database | `prisma migrate deploy` only touches `booking_dev`. The test DB is separate and needs its own run, or every suite fails with "column does not exist": `DATABASE_URL="postgresql://booking:booking@localhost:15432/booking_test?schema=public" npx prisma migrate deploy` |
| Docker | Desktop frequently isn't running. Start `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`, poll `docker info`, then `docker compose up -d`. |
| Migrations | `prisma migrate dev` needs a TTY and fails here. Use `prisma migrate diff --from-migrations … --script` into a temp file, write it to a new `prisma/migrations/<timestamp>_name/migration.sql`, then `prisma migrate deploy`. |
| PowerShell + .NET | `[System.IO.File]::WriteAllText` uses the *process* CWD, not `Set-Location`. Always pass absolute paths. |
| Perf suite | Must run **alone**: `npm run test:perf`. It is excluded from `npm test`. Running it alongside anything else inflates p95 and produces a false failure. |
| Test plan defaults | `signUpStudio` defaults orgs to plan `PRO` so plan limits don't interfere with unrelated suites. Billing tests pass `plan: 'SOLO'` explicitly. |

---

## COMMANDS

```
cd server && npm test              # 385 tests, ~12 min
cd server && npm run test:perf     # isolated timing gate — run alone
cd server && npm run typecheck
cd server && npm run db:seed       # prints booking URL + login
cd server && npm run dev           # API on 4000
cd client && npm run dev           # dashboard on 5173
```

| URL | What |
|---|---|
| `localhost:4000` | Marketing site |
| `localhost:4000/public/clay-and-co` | A studio's booking page |
| `localhost:5173` | Studio dashboard |
| `localhost:4000/api/health` | Asserts Postgres + PostGIS + btree_gist |

---

## DEPLOYMENT (staging, live since 2026-08-12)

Runbook: `DEPLOY.md`. Box: `root@fillforge`, code at `~/artweel`.

The VPS is **shared** — n8n and FDGSMS run there too, and **Traefik owns 80/443**.
There is no host nginx and no certbot. Routing is container labels on the
external `n8n_default` network, certresolver `mytlschallenge`. Three containers
(`artweel-api`, `artweel-client`, `artweel-postgres`) and **nothing published to
a host port**.

> **Never run bare `docker compose` in `~/artweel` on the VPS.** It picks up the
> development compose file and publishes Postgres on `0.0.0.0:5434` with
> booking/booking. Docker writes published ports into iptables and bypasses
> ufw, so that is internet-reachable whatever the firewall says. This happened
> twice during the first deploy. Always `-f docker-compose.prod.yml`.

Staging is kept out of search results by a Traefik middleware setting
`X-Robots-Tag: noindex, nofollow`, because the app's own `robots.txt` always
emits `Allow: /`. That pairing is deliberate — a crawler has to be allowed to
fetch a page in order to see the noindex. Remove it when the naming decision is
settled.

**Stripe needs two event destinations**, both pointing at
`{PUBLIC_URL}/webhooks/stripe`, API version `2025-01-27.acacia` to match the SDK
pin:

| Scope | Events |
|---|---|
| Connected accounts | `checkout.session.completed`, `checkout.session.expired`, `account.updated` |
| Your account | `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed` |

Checkout sessions are direct charges created on the studio's account, which is
why they are connected-accounts scope. Stripe issues a separate signing secret
per destination and there is no combined scope, so `STRIPE_WEBHOOK_SECRET`
accepts a **comma-separated list** and `verifyWebhook` tries each.

`checkout.session.completed` now carries either `sessionId` or `courseSeriesId`
in its metadata, and `onCheckoutCompleted` branches on it — a course becomes an
enrolment, a class becomes a booking. No new event types are needed.

Not wired: automated backups, monitoring, live Stripe, Twilio SMS, Google
Calendar (blank credentials fall back to the in-memory fake).

## OPEN DECISIONS

1. **Product name.** Repo says "artweel"; code still says "Studio Bookings"
   everywhere (marketing titles, JSON-LD, notification sender, package names).
   Needs a decision then a find-and-replace. Matters because SEO bakes in
   `PUBLIC_URL` and re-indexing later is costly.
2. **Talk to three US ceramics studios.** Still open, and now the binding
   constraint on Phase 2 rather than a nice-to-have. W2.1 was built ahead of it
   on the judgement that cohorts and enrolment are structurally obvious —
   a six-week course is six dated sessions and one thing sold. Pieces, kilns
   and make-up credits are NOT in that category: they rest on inference about
   how a studio actually works, and they are the expensive ones to build wrong.
   Interview before W2.3 (piece tracking), not after.
3. **Stripe Connect platform application** and **Twilio A2P 10DLC** — both
   code-complete, both blocked on approval queues. Without 10DLC, US SMS is
   carrier-filtered: it looks sent and never arrives.

---

## PHASE 2 (~7 weeks, scope fixed)

Course series with cohorts → attendance + make-up credits → piece tracking with
pickup SMS → kiln/firing management → resources → waitlists + packages →
embeddable widget + WordPress plugin.

**Nothing else.** Every studio interviewed will request something adjacent;
those go to Phase 3. This is the phase where scope creep is most tempting and
most damaging.

### W2.1 — course series + cohorts (DONE, 2026-08-12)

A `CourseSeries` is a cohort: one run of a multi-week course. "Beginner Wheel"
is a ServiceType; "Beginner Wheel, Autumn 2026, Tuesdays 7pm" is a cohort, and
its six Tuesdays are Sessions.

**The one decision to understand before changing anything here:** an
`Enrollment` is what gets *sold*, but it is not what gets *scheduled*. It fans
out into one ordinary `Booking` per session. Seat counting, cancellation,
calendar sync, reminders and the week-three roster were already correct at
Booking granularity, and a parallel "series booking" would have forced a second
code path through every one of them. Six rows per enrolment buys all of that.
Money sits on the enrolment, not smeared across the weeks — `Booking.totalCents`
is 0 for fanned-out rows, and `Payment` gained a nullable `enrollmentId`.

Correctness properties, all gate-tested in `tests/gate/course-enrollment`:

- **All-or-nothing enrolment.** Every scheduled session is locked `FOR UPDATE`
  `ORDER BY series_index` before anything is decided. The ordering is the
  deadlock defence: without it two concurrent enrolments can hold week 1 wanting
  week 2 and vice versa. A course is full when its *tightest* week is full —
  selling five-sixths of a course is not something a studio can honour.
- **All-or-nothing generation.** Sessions and their `staff_time_blocks` are
  written in one transaction, so an instructor already booked on week four
  fails the whole cohort rather than creating one with a hole in it.
- **DST by construction.** The RRULE yields calendar dates; the wall-clock time
  is re-resolved per date. `expandLocalDates` rejects a rule carrying its own
  `COUNT`/`UNTIL`, because `sessionCount` governs. Generation reports
  `shifted`/`ambiguous` landings and the route surfaces them as warnings.
- **One active enrolment per person per cohort**, via a PARTIAL unique index
  (`WHERE status = 'ACTIVE'`). A plain unique constraint would permanently bar
  a student who cancelled by mistake from rejoining. Prisma cannot express this
  in schema, so it lives in the migration — and it reports as P2002 with the
  COLUMNS in `meta.target`, never the index name, which is what
  `isDuplicateEnrollment` matches on.

Admin API at `/api/organizations/:id/courses` (gated on the existing
`courseSeries` plan feature, so Solo is refused with 402). Public browsing at
`/public/:slug/courses` publishes the tightest week's seat count, deliberately
— showing week one's roomier number would promise what enrolment then refuses.

Marketing copy: `Multi-week courses` moved from `COMING_SOON` into the shipped
feature list; `Attendance registers and make-up classes` stayed behind, since
that is W2.2.

**Not built in W2.1:** a dashboard Courses page. Note the client has no admin
pages for services, staff, locations or resources either, so this is the
existing shape of the dashboard rather than a new gap.

### W2.1b — paid course checkout (DONE, 2026-08-12)

A priced cohort can now be bought online:
`POST /public/:slug/courses/:seriesId/checkout`.

**The hold is one row covering every week.** `BookingHold` gained
`courseSeriesId`, mutually exclusive with `sessionId` via a CHECK constraint.
Modelling it as N per-session holds was the tempting alternative and is wrong:
the expiry sweep works per row, so it could release week three while weeks one
and two stayed held, and the customer would return from Stripe having paid for
a course they can no longer join.

- `createSeriesHold` locks every session in `series_index` order — the same
  order `enrollInSeries` uses, so a paid checkout and a free enrolment racing
  on one cohort queue instead of deadlocking. Shared helpers `lockSeriesSessions`
  and `assertSeriesEnrollable` exist to keep those two paths honest with each other.
- `releaseHold` learned the course shape, so the existing sweep needed no
  changes. It reports **one place released**, not six — per-week counting would
  make the sweep's own totals meaningless.
- `convertSeriesHold` transfers the held seats rather than taking more.
  Double-incrementing here would silently shrink every week of the course.
  Idempotent via the hold's `released_at`: a redelivered webhook returns the
  existing enrolment. A hold that was *swept* has no enrolment, and that
  correctly raises `HOLD_EXPIRED`.
- **Price comes from the cohort, not the service.** `ServiceType.priceCents` is
  the drop-in price; charging it for a six-week course undercharges sixfold.
  Deposit terms still come from the service, since "50% up front" is a studio
  policy rather than a per-cohort one. The test fixture sets the two to
  different values on purpose so a mix-up cannot pass.
- `scheduleEnrollmentNotifications` sends **one** confirmation, then reminders
  before every week. Calling `scheduleBookingNotifications` per fanned-out
  booking would fire six identical receipts within a second.

Payment attaches to the enrolment (`Payment.enrollmentId`), leaving
`bookingId` null for course purchases.

**Still not wired:** refunds for a cancelled course enrolment.
`refundForCancellation` is booking-shaped and course money lives on the
enrolment, so cancelling a cohort still requires the studio to refund by hand —
which `cancelSeries` already assumes deliberately, since a called-off course
may owe full refunds, partial ones or credit.

### NEXT: W2.2 — attendance + make-up credits

Registers per session, marking absence, and a credit a student can redeem into
another cohort's session. The `Booking.status` enum already carries `ATTENDED`
and `NO_SHOW`, so the register writes to rows that already exist.

Phase 2 exit gate: a studio runs a full six-week course (enrolment, attendance,
one absence, a redeemed make-up credit) and a full firing cycle (piece created →
both firings → collected, with the pickup notification delivered).
