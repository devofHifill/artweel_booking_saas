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

## Status — 2026-09-02

**Phases 0, 1 and 2 are code-complete. Since then: a design-system port,
superadmin Stages 1 and 2, the thirteen-item TourFlow parity pass, and — on
2026-09-02 — the booking-page pass, G0 to G5.** Both typechecks clean.

**990 tests, 983 green.** The seven are known and neither is a defect:

- six in `tests/gate/course-enrollment.test.ts`, whose cohort fixture is pinned
  to `startLocalDate: '2026-09-01'` and so has "already started" since
  2026-09-02. The sister file in `tests/public/` had the same bug and was
  fixed; this one also asserts the generated dates, so start and expectations
  must move together.
- one in `tests/gate/seat-concurrency.test.ts` — the raw
  `PrismaClientKnownRequestError` symptom described under ENVIRONMENT GOTCHAS.
  Passes when the file is run alone.

**The perf gate is marginal, not regressed.** Five consecutive runs on an idle
machine: 200.9, 218.6, 186.5, 168.9, 198.4ms against a 200ms threshold. It
straddles its own line. Availability reads `sessions`, `busy_blocks` and one
`service_types` row — it never touches `bookings`, so the new `reference`
column and index cannot reach it. Worth either more headroom or a less noisy
measurement before it is trusted as a gate.

Read `BOOKING-PAGE-PLAN.md` for the most recent work and
`TOURFLOW-PARITY-PLAN.md` for the pass before it. `PHASE-2-CLOSEOUT.md` is
history; everything in it landed.

**What is actually left:**

- **Staging is well behind**, at `e8824d4`. Everything from D12 onward exists
  only in git, and since 2026-09-02 that includes the whole booking-page pass
  (G0–G5, see `BOOKING-PAGE-PLAN.md`).

  **TWO MIGRATIONS ARE OWED. This is no longer a code-only deploy.**

  - `20260902120000_service_detail_fields` — `highlights` and
    `preparation_notes` on `service_types`
  - `20260902140000_booking_reference` — `reference` on `bookings`, a
    GENERATED column, plus its index

  Both are additive and nullable, so the order is forgiving, but shipping the
  code without them gives an app querying three columns that do not exist.
  Run `prisma migrate deploy` before the code goes out, not after.

  If `THEME_PACK` is set, rebuild rather than restart, because Vite bakes the
  client's half in at build time.
- **The browser debt is paid.** D12, D13, the schedule surface and the new
  topbar were all walked on 2026-09-01 — deposit round-trip, all four schedule
  write paths, the "cannot be booked" empty state, both new menus.
- **Since the thirteen:** the whole `/schedules` surface got a UI (working
  hours, per-date exceptions, and `/my-schedule` for an instructor's own),
  light + indigo became the default, the topbar was matched to the prototype,
  and theme packs landed — `THEME_PACK` / `VITE_THEME_PACK`, product-wide shape
  only, deliberately not a studio setting.
- **D3 Calendar is partial** by decision — month and week shipped; day view and
  the side panel were declined with reasons, and add-slot belongs to Classes,
  which already has it.

**What the parity pass turned up, which is the useful part.** Five of the
thirteen items were not styling gaps at all but capabilities with no caller:
a studio could not create an activity (D4), connect a calendar (D11), set a
notice window, booking horizon or deposit (D13), or give an instructor working
hours — which meant **anyone hired after signup was permanently unbookable**,
silently. The onboarding wizard seeds hours for the FIRST instructor only. That
pattern is the thing to keep looking for.

Two harness faults were fixed the same day: worker stops that did not await the
tick in flight, and a Prisma client shared across every test file. Together
they were producing up to 47 phantom failures in a run.

Deployed to staging on 2026-08-12: W2.1 (course cohorts + paid checkout),
W2.2a (attendance registers) and W2.2c (drop-in class scheduling).

Deployed 2026-08-14: W2.2b make-up credits, W2.3 piece tracking, W2.4 kiln
firings, W2.6a waitlists, W2.6b class packs, W2.7 widget + WordPress plugin.
All three migrations — `..._credits_pieces_firings`, `..._waitlists` and
`..._class_packs` — applied cleanly, with no half-applied or rolled-back rows,
and all seven new tables verified present.

Those three had to go together and must never be split: `..._class_packs`
renames `make_up_credits` to `class_credits`, and old code asking for the old
name gets `relation does not exist`. Since `migrate deploy` runs before the new
containers start, splitting them would break the live API in that window. The
migration's own comment claims the rename makes the rollout safe; it makes the
*data* safe, which is not the same thing.

Also deployed 2026-08-14: the sweep worker (`src/workers/sweep.worker.ts`).
Three expiry sweeps had been written and tested but never called from `src/`,
so waitlist offers held their seats permanently and no trial ever ended — see
`PHASE-2-CLOSEOUT.md` C2.1.

**Check `Sweep worker started` after every deploy.** That grep caught a deploy
that had silently shipped nothing: health was green, every route returned 200
and uptime showed a fresh restart, because the container really had restarted —
on the old image. No external signal can distinguish that from a good deploy.
The API logs four startup lines; three means the build did not include your
change.

The Phase 2 deploy applied migrations `..._course_series_enrollments` and
`..._course_holds` cleanly against the live database, and health reports
`database`, `postgis` and `btreeGist` all ok. No new environment variables and
no new Stripe event types were needed — paid courses reuse
`checkout.session.completed` with different metadata.

Staging is live and verified at `https://artweel.fillforge.cloud` (marketing +
booking pages) and `https://app.artweel.fillforge.cloud` (dashboard). See
`DEPLOY.md` for the runbook and the section below for the shape.

Shipping: auth/tenancy, admin CRUD, public booking page, Stripe Connect
payments, notifications (email + SMS outbox), Google Calendar two-way sync,
owner dashboard, onboarding + billing, marketing site + SEO, multi-week course
cohorts with all-or-nothing enrolment, attendance registers, make-up credits,
piece tracking through the firing cycle, kiln firings, waitlists, and an
embeddable booking widget with a WordPress plugin.

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
| Docker | Desktop frequently isn't running, and it also **shuts itself down mid-session**. Start `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`, poll `docker info`, then `docker compose up -d`. |
| Postgres crash recovery | When Docker dies with Postgres running, the container comes back up but **rejects connections for ~40s** while it fsyncs the data directory. `docker compose ps` says "running" the whole time, so a test run started too early fails with `Can't reach database server` and looks like a code fault. Poll `docker exec booking-postgres pg_isready -U booking -d booking_dev` until it says *accepting connections*. |
| Migrations | `prisma migrate dev` needs a TTY and fails here. Use `prisma migrate diff --from-migrations … --script` into a temp file, write it to a new `prisma/migrations/<timestamp>_name/migration.sql`, then `prisma migrate deploy`. |
| PowerShell + .NET | `[System.IO.File]::WriteAllText` uses the *process* CWD, not `Set-Location`. Always pass absolute paths. |
| Perf suite | Must run **alone**: `npm run test:perf`. It is excluded from `npm test`. Running it alongside anything else inflates p95 and produces a false failure. |
| Suite length vs edits | The suite now takes ~40 minutes, which is long enough that editing source while it runs is easy to do by accident — and the result then describes code that no longer exists. It happened once here and produced two false failures. Kill a run you have invalidated rather than reading its output. |
| Two sessions, two databases | **Never run two suites against one database.** They truncate between tests and corrupt each other. On 2026-09-01 this produced 35 failures that were not real; the tell was `signUpStudio failed: 500` and, in the Postgres log, two backends hitting `organizations_slug_key` a second apart. `booking_test` and `booking_test_b` both exist and are migrated — the second session sets `TEST_DATABASE_URL`. |
| A quiet machine, or a phantom gate failure | Five full-suite attempts on 2026-09-01: one killed by Docker Desktop restarting mid-run, one by concurrent runs, one by edits, one by the port proxy dropping connections under load. Only the fifth, on an otherwise idle machine, was clean. A gate test reporting a raw `PrismaClientKnownRequestError` where it expects the app's own error is almost always this, not the code. |
| Test plan defaults | `signUpStudio` defaults orgs to plan `PRO` so plan limits don't interfere with unrelated suites. Billing tests pass `plan: 'SOLO'` explicitly. |

---

## COMMANDS

```
cd server && npm test              # 990 tests, ~42 min — see the warning below
cd server && npm run test:perf     # isolated timing gate — run alone (marginal, see Status)
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

Runbook: `DEPLOY.md`. Code at `~/artweel`.

**`root@fillforge` does not resolve** — it is shorthand, not a hostname, and it
sent a session hunting on 2026-09-01. The box is whatever
`artweel.fillforge.cloud` resolves to; the local `my-vps` SSH alias is a
DIFFERENT machine and does not answer.

**Check the deployed commit after every pull.** `git log --oneline -1` in
`~/artweel`. It was one behind what was expected once, and the only reason that
cost nothing is that the missing commit touched test files, which never enter
the image.

Staging is currently at `e8824d4`, well behind the branch head.

**That is no longer a code-only deploy.** Two migrations are owed — see the
Status section at the top for their names. Run `prisma migrate deploy` before
the code goes out.

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

1. ~~**Product name.**~~ **Settled 2026-08-14: the product is Artweel.** The
   repo, staging hostnames, WordPress plugin and embed protocol already said
   so; only the marketing footer and two JSON-LD fields held out, and they were
   moved to match. Nothing is indexed under any name while staging carries
   `X-Robots-Tag: noindex`.
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

### W2.2a — attendance registers (DONE, 2026-08-12)

**A register belongs to a SESSION, not to a course.** Week three of a six-week
course and a Saturday drop-in are the same thing to an instructor holding a
phone: a list of people who should be in the room. Hanging the register off
courses would have left drop-in classes without one and duplicated the logic
the moment they needed it. New module at `/api/organizations/:id/sessions`:

- `GET /sessions?from=&to=` — find tonight's class, with outstanding counts
- `GET /sessions/:id/register` — the roster, plus `markable`
- `POST /sessions/:id/register` — mark the whole class in one request

Everything is `requireMember`, not `requireAdmin`. An admin-only register is a
register nobody fills in — the instructor in the room is the person marking it.

Rules that keep the record trustworthy, all in `markAttendance` so the bulk and
single paths cannot drift:

- **A future class cannot be marked.** Checked against session START, not end,
  so a register can be taken while the class is running — which is when it
  actually happens.
- **A cancelled booking cannot be marked**, and does not appear on the
  register at all. Somebody who cancelled in advance is not a no-show, and
  conflating the two makes a student look unreliable for doing the right thing.
- **Bulk marking is all-or-nothing.** A request naming a booking from another
  class is rejected whole (`NOT_ON_REGISTER`), never applied in part.
- `CONFIRMED` is the undo, for a mistapped row on a phone.

The course roster now carries `attendance: { attended, missed, upcoming,
unmarked }` per enrolment. `unmarked` is deliberately distinct from `upcoming`:
a class that ran and never had its register filled in is a different problem
from one that has not happened yet.

**Dashboard page** at `/register` (`client/src/pages/Register.tsx`) — the first
admin CRUD page the dashboard has. Built for a phone in an apron pocket: marks
are held locally and submitted as ONE request, tapping the same button twice
clears it, and a not-yet-started class renders no save controls at all. Verified
against a real database, not just typechecked.

### W2.2c — scheduling drop-in classes (DONE, 2026-08-12)

Found while testing the register: sessions could only be created by generating
a cohort or by `seed.ts` calling `createSession` directly, so a studio could
take a register for a class it had no way to schedule. Now `POST`, `PATCH` and
`DELETE` on `/sessions`, admin-only — putting a class on the calendar is a
different authority from marking who turned up.

**A course and a term of drop-ins fail differently, and that is the point.**
Cohort generation rolls back whole, because a course with a hole in week four
is broken — students bought the run. Twelve independent Saturdays are not: if
the instructor is busy on one, the other eleven are still worth having. So a
repeat SKIPS the clashing date and reports it in `skipped[]`, and only fails
outright (`ALL_DATES_UNAVAILABLE`) when nothing could be scheduled.

- Times arrive as wall-clock intent; the instant is derived. A repeat across
  the November transition holds its advertised hour.
- A `COURSE_SERIES` service cannot take a loose session — that would be a
  seventh week nobody enrolled in and nobody could sell.
- Capacity cannot drop below `seatsTaken`. Allowing it would leave the CHECK
  constraint permanently violated for that row, so every later booking and
  cancellation on the class would start failing.
- **Instructor swaps are refused, not half-done.** The time block is what the
  exclusion constraint compares against, so a swap must move block and session
  together and be rejected whole if the new instructor is busy. That is a
  scheduling operation, not a field edit. `STAFF_CHANGE_UNSUPPORTED` says so
  rather than silently leaving the old instructor blocked and the new one free.
- Cancelling cancels every booking first (returning seats, clearing blocks),
  then the session. Refunds stay manual, as with cohorts.

### W2.2b / W2.3 / W2.4 — credits, pieces, firings (DONE, 2026-08-12)

Built **without studio interviews**, on Suren's explicit instruction, accepting
rework. The engineering response to that was to put every uncertain judgement
into DATA rather than code — see ASSUMPTIONS below, which is the list to take
into an interview.

**Make-up credits.** A missed course session mints a credit; a credit buys a
seat in another class. Policy (on/off, expiry days, notice required, notice
hours, cross-cohort) lives on `organizations`. Two things are enforced in
Postgres rather than trusted to code, because both are what a retried request
or two staff on two phones would otherwise break:

- **one absence, at most one credit** — partial unique index on
  `source_booking_id`, which is what makes issuance idempotent when a register
  is saved twice
- **one credit, at most one seat** — the row is locked `FOR UPDATE`, and the
  seat is claimed through the ordinary `bookSeats` path BEFORE the credit is
  marked spent, so a full class leaves the credit intact. Losing a race gives
  the seat back.

**Pieces.** `GREENWARE → AWAITING_BISQUE → BISQUE_FIRING → BISQUED →
AWAITING_GLAZE → GLAZE_FIRING → FINISHED → COLLECTED`, plus `BROKEN` from
anywhere. Transitions are a table, not branches. Every move is kept in
`piece_events` — "where is my mug" needs the status, "you said it was ready
three weeks ago" needs the history. Reaching FINISHED queues the pickup
message once, guarded by `notified_at` stamped *before* queueing: a missed
message beats a repeated one.

**Firings.** Almost no new correctness code, because a kiln was already an
exclusive `Resource` from Phase 0 — a firing takes a `ResourceAllocation` and
the `EXCLUDE` constraint refuses the second load. Firings that are not
exclusive resources are rejected outright (`KILN_NOT_EXCLUSIVE`), since a
"kiln" with quantity 8 would silently accept eight simultaneous firings. The
allocation covers **cooling**, not just the elements-on hours. Completing a
glaze load advances every piece in it, which is what notifies the owners.

Firing status transitions are deliberately **advisory, not a gate** — a studio
that fired on Saturday and opened the app on Monday can mark a load complete
without walking it through loading/firing/cooling. Only the terminal states
are enforced.

> **ASSUMPTIONS TO TEST WITH A STUDIO.** Each is a guess, and each is cheap to
> change because it is a setting or a table:
>
> 1. One absence = one credit. A studio running "three misses and you repeat
>    the term" thinks in a different currency. Changing this means dropping the
>    partial unique index and adding an ordinal.
> 2. Credits require advance notice by default. This rewards the student who
>    warns you over the one who vanishes — but may read as harsh.
> 3. Credits default to spendable on any class, not just the same cohort.
> 4. 90-day credit expiry, 30-day piece hold. Both invented.
> 5. Two firings, bisque then glaze, in that order. Single-fire, raku and
>    multiple glaze firings all break this; the transition table is where to
>    widen it.
> 6. Firings are scheduled in advance like a class. Some studios instead fill
>    a kiln opportunistically and fire when full — a queue, not a calendar.
>    That model keeps the table and drops the times.
> 7. Piece labels are free text, because studios already have a system
>    (initials, a number, a coloured dot) and software that insists on its own
>    makes staff maintain two.

### W2.6a — waitlists (DONE, 2026-08-12)

The one place in the product where demand arrived, was refused, and left no
trace. A studio whose Saturday class fills every week could not answer "how
many did I turn away" — which is the number that justifies a second session,
and is now `seatsWanted` on the studio view.

**The mechanism is an OFFER, not a broadcast.** When a seat frees it is held
for exactly one person for a window (`WAITLIST_OFFER_TTL_MINUTES`, default 12
hours) and they are emailed a claim link. Broadcasting would be simpler and is
wrong twice: the fastest email-checker wins rather than the longest waiter, and
everyone else follows a link to a failure.

The hold is the **same `BookingHold` as Stripe checkout** — identical problem
shape, a seat reserved for somebody who has not committed yet. A second
reservation mechanism would have meant two things that can each believe a seat
is theirs.

- **The trigger lives inside `cancelBooking`**, not at its callers. Seats come
  back from at least five places (studio cancel, token cancel, reschedule,
  failed credit redemption rollback, course cancellation) and wiring each is
  how the fifth gets missed. This means `scheduling/` dynamically imports a
  module — the wrong direction, taken deliberately, because a waitlist that
  fires on *some* cancellations is worse than none.
- **Offer TTL is 12 hours, not 10 minutes.** A checkout hold waits on somebody
  already typing a card in; this waits on somebody noticing an email. Ten
  minutes would cycle the seat through the whole queue unclaimed while the
  class showed full.
- Somebody wanting 2 seats is **skipped, not blocking**, when only 1 frees —
  but keeps their position, so a later double cancellation still reaches them
  first.
- Turning an offer down passes the seat on **immediately** rather than waiting
  out the window.
- A failed offer email **revokes the offer** and returns the person to the
  queue. A seat held for somebody who was never told is the worst state
  available: the class shows full for nobody.

Constraints in Postgres, not code: one live queue place per customer per class
(partial unique index), an OFFERED row must have both a hold and an expiry, and
a CLAIMED row must name its booking.

**Not built:** class packs — the other half of W2.6. Prepaid bundles are a
money construct closer to billing than to queueing.

### W2.7 — embeddable widget + WordPress plugin (DONE, 2026-08-12)

Two lines on a studio's own site:

```html
<div data-studio="clay-and-co"></div>
<script src="https://artweel.fillforge.cloud/embed.js" async></script>
```

**The whole risk of this feature is the framing header, and it is why the
tests are mostly about what must still REFUSE to be framed.** Helmet sets
`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` globally.
`allowEmbedding` undoes both, for `/public/*` only. Relaxing helmet globally
instead would make the dashboard clickjackable — an attacker overlays an
invisible copy and an owner clicks something they cannot see. Four tests assert
the API, marketing site, authenticated endpoints and webhooks still refuse.
A future blanket relaxation fails there, loudly.

`frame-ancestors *` rather than a per-studio allowlist: a booking page is
public, there is no session or cookie in it, and the only credential in the
whole surface arrives by email. An allowlist would be configuration protecting
nothing.

> **Two bugs found by driving a real browser that every header assertion
> missed.** Both are now pinned by tests:
>
> 1. **`Cross-Origin-Resource-Policy`.** Helmet defaults it to `same-origin`,
>    which blocks `embed.js` from loading on anybody else's site —
>    `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`. CORS does not cover this: a
>    classic `<script src>` is a no-cors request, so
>    `Access-Control-Allow-Origin` is never consulted and CORP decides alone.
>    Every header looked right and nothing appeared.
> 2. **Height measured with `scrollHeight`.** Inside an iframe the viewport IS
>    the frame, so scrollHeight is bounded below by the frame's current height
>    — a 900px frame around 683px of content reports 900 forever and can never
>    shrink. Now measured from the body's own box.

The **WordPress plugin** (`wordpress-plugin/`) is a shortcode, a block and a
settings page, and deliberately contains no booking logic at all. Duplicating
seat arithmetic onto hundreds of shared-host installs you cannot patch is
precisely the mistake the original WP Booking Flow plugin made. It renders a
div; the flow improves without studios updating anything. Not syntax-checked —
no PHP on the Windows box.

### W2.6b — class packs (DONE, 2026-08-12)

"Ten classes for £400, valid six months." A purchase that books nothing —
which is the only genuinely new thing in it, since every other payment in the
system attaches to a session or a cohort.

**The structural decision: there is now ONE entitlement currency.**
`MakeUpCredit` was renamed to `ClassCredit` with a `source`
(`ABSENCE | PACK | GRANT`). A missed class and a prepaid pack produce the same
thing — a seat the customer is owed — and separate tables would have meant two
redemption paths, two double-spend guards, and a customer looking at two
balances. Spending a pack credit reuses `redeemCredit` unchanged: it already
locks the row `FOR UPDATE`, claims the seat through `bookSeats` before marking
it spent, and hands the seat back on a lost race.

> **The migration RENAMES rather than dropping.** Prisma's generated diff would
> `DROP TABLE make_up_credits`, discarding every credit a studio currently owes
> its students — which is money. The hand-written migration renames the table,
> the type, all five indexes and all four constraints, then widens it. Worth
> remembering the next time a model is renamed: `migrate diff` will always
> propose the destructive version.

- **Price, credit count and validity are snapshotted onto the purchase**, never
  read through to the pack. A studio raising prices cannot retroactively charge
  somebody more, and shortening validity cannot expire a credit already in a
  customer's hands.
- **Issuance is idempotent via the status transition**, not a count.
  `updateMany ... where status = 'PENDING'` wins once or reports zero rows;
  counting existing credits instead would let two webhook deliveries both count
  nine and both mint the tenth.
- **Over-the-counter sale** (`POST /packs/:id/sell`) issues immediately without
  payment. The studio took cash in the room; the software's job is to record
  it, not insist on processing the card.
- **Refunds cancel only UNSPENT credits.** Somebody who used four of ten keeps
  those four — clawing them back would mean un-booking them from classes they
  have already attended. Whether the cash refund should be partial is the
  studio's call.
- Packs get their own `startPackCheckout` rather than a third branch in
  `startCheckout`: no seat, no hold, no session, no service, no deposit. Its
  Stripe session lives an hour rather than ten minutes, because nothing is
  reserved and so nothing is starved.

**Phase 2 is complete.**

### NEXT: what is left

Every Phase 2 workstream is built. What remains is unfinished edges, not
missing features. These are sequenced, with reasoning, in
`PHASE-2-CLOSEOUT.md`; the list below is the raw inventory:

- ~~**Dashboard pages** for courses, credits, pieces, firings, waitlists and
  packs.~~ **Done, and this was the largest gap.** Courses, Pieces, Firings and
  Packs all have screens and routes. Credits and waitlists deliberately do not:
  a credit belongs to a person and lives on `CustomerDetail`, and a waitlist
  belongs to a class and lives on `Classes`. Nothing here needs curl any more.
- **Refunds for a cancelled course enrolment.** `refundForCancellation` is
  booking-shaped and course money sits on the enrolment.
- **Credits and class packs cannot be spent on the booking page.** They appear
  nowhere in the public flow — grep finds zero references. This was harmless
  while every public booking was free; since G1 the page takes card payment, so
  "I already have a pack" now has nowhere to go.
- **A studio cannot sell a course until Stripe onboarding completes.**
  `enrollPublic` refuses any priced cohort, so unlike a class there is no
  unpaid fallback. A decision made earlier; G2 is what made it visible to
  customers. Waiting on OPEN DECISIONS item 3.
- **The operator screens have not been swept** for the "capability with no
  caller" fault. Seven instances turned up this week without looking
  systematically — the Dashboard's dead button, checkout, deposits, courses,
  manual booking, and the activity and instructor filters. Seven is unlikely to
  be the total.
- **The WordPress plugin has never been run.** No PHP on the Windows box, so
  it has not even been syntax-checked. It wants a real WordPress install
  before anyone trusts it.
- **Deploying everything since `e8824d4`** — the parity pass, the schedule
  surface, theme packs and the whole booking-page pass. See the migrations
  named at the top: this is not a code-only deploy.
- **Phase 3**, which the spec scopes as public API + webhooks, Outlook/Apple
  calendar, reporting, gift cards, memberships and a second vertical.

**Phase 2 exit gate:** a studio runs a full six-week course (enrolment,
attendance, one absence, a redeemed make-up credit) and a full firing cycle
(piece created → both firings → collected, with the pickup notification
delivered).

Both halves are now covered by tests — the course half across
`tests/admin/credits`, the firing half by "takes a pot from wet clay to
collected, notifying its owner once" in `tests/admin/pieces-firings`. What has
NOT happened is a real studio running either one, which is what the gate
actually asks for.
