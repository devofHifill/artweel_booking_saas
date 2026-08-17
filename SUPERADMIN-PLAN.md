# Superadmin — implementation plan

A platform-level operator surface for Artweel (FDG), so studios can be
administered through the product rather than through `psql`.

Scope is fixed the same way Phase 2's was: adjacent requests go to a later
stage. Ordered so each step de-risks the next, and so a failure tells you which
thing broke.

---

## The design constraint everything hangs off

Tenant isolation in this codebase is *structural*. `withOrganization`
(`organization.route.ts:42`) proves membership once, before any handler runs, so
no module can forget its tenant check. That single property is the reason 144
route definitions across 19 modules are safe without each one being audited.

A superadmin is, by definition, an exception to it. So the goal of this plan is
not "give the operator access" — that part is four lines. The goal is to make
the exception **narrow, explicit, and recorded**, so that in six months you can
answer "what did that account touch?" with a query instead of a guess.

Three rules follow from that, and they shape every stage below:

1. **Platform authority is not a `MembershipRole`.** That enum means authority
   *within* a studio. Platform status lives in its own table.
2. **Platform status is never a token claim.** Same reasoning that kept the org
   out of the access token, but harder: a stolen token carrying god mode is
   cross-tenant compromise that cannot be revoked before expiry. Platform
   requests are rare; a DB check per request costs nothing.
3. **Most of this never touches a tenant.** Companies, users, subscriptions,
   plans, statuses and integrations are all *platform-owned* data. Those routes
   live at `/api/platform/*` and never go near `withOrganization`. Only
   "look inside a studio to debug it" needs the choke point, and that is one
   stage out of fourteen.

---

## Stage map

**Stage 1 — the minimum six. COMPLETE 2026-08-17.** S0–S6. Everything you will
reach for in the first month with real studios. Estimated at roughly a week; done
in a day, because most chunks reused machinery that already existed (the rate
limiter, the SUSPENDED semantics, the plan catalogue, the onboarding derivation,
the dashboard's card and tag patterns).

What that day actually bought, beyond the features: **eight defects caught before
they shipped**, six of them in code written the same day. Worth listing, because
the pattern in them is the useful part —

- a latent sweep bug that would have silently reset the new login limit (S0)
- a 404 whose *body* differed from a real 404, locating the surface (S1)
- a `@@unique` that Postgres would have ignored entirely (S1)
- `extendTrial` and `setPlan` both able to lift an abuse suspension, one route
  after the guard was introduced — with a comment already claiming otherwise (S4)
- a health check that counted released holds and so would read "degraded" forever
  (S5/S6)
- a queue display that read future reminders as a backlog (S6)
- a monitoring page whose error state never cleared (S6)

Five were found by writing a test that could distinguish the two cases; three only
by opening the page and looking at it. Neither method would have found the other's.

**Stage 2 — the next tier.** S7–S10. Support visibility and user administration.

**Stage 3 — each its own decision.** S11–S14. Deferred deliberately; see the
reasoning at each.

---

# STAGE 1 — the minimum six

## S0 — rate-limit the auth routes — **DONE 2026-08-17**

Landed as planned, plus one thing the plan did not anticipate and one thing it
over-promised.

**A latent bug in the limiter had to be fixed first.** `sweep()` took the window
as an argument and pruned *every* bucket with it, so whichever limiter happened
to trigger the sweep imposed its own window on all the others. Harmless while
every limiter used 60s — and S0 introduces the first 15-minute window, so any
marketing or public request would have pruned the login bucket back to the last
60 seconds and handed an attacker a fresh budget. The window is now stored per
bucket. It is worth knowing that this failure is invisible from inside a single
limiter: it returns 429 exactly when it should in isolation, and leaks only in
the presence of unrelated traffic. `tests/auth/rate-limit-window.test.ts` is the
regression test.

**The email-keyed limiter in the original plan was NOT built, deliberately.** The
plan claimed keying on IP and email separately would stop both distributed
guessing and account lockout. That reasoning does not hold: any per-email counter
that blocks before the password is checked is itself an account-lockout weapon,
because anyone who knows an address can spend that budget and hold the owner out
of their own studio. Doing it properly means counting *failed* attempts and
resetting on success, which needs a decision about which failure mode is worse.
Deferred rather than half-built; the comment in `auth.route.ts` records it.

**Refresh is intentionally unlimited.** Every signed-in client hits it on a
15-minute cycle unprompted, so a limit tight enough to matter would sign out a
whole studio behind one office IP — and rotation with family revocation already
protects it better than a counter would.

Limits are config, not constants: `AUTH_RATE_WINDOW_MINUTES` (15),
`AUTH_LOGIN_RATE_MAX` (20), `AUTH_REGISTER_RATE_MAX` (5), `AUTH_RESET_RATE_MAX`
(5), with login, register and reset on separate budgets.

**Test-suite note worth remembering.** Every fixture registers through
`/api/auth/register`, all from one IP under supertest, so `tests/setup.ts` raises
the limits to 100000 rather than disabling the limiters — they stay genuinely
mounted in all 34 files, so a wiring mistake still breaks the suite.
`tests/auth/rate-limit.test.ts` lowers them on purpose. That file must import
`src/app`, `src/lib/prisma` and `tests/helpers/fixtures` **dynamically**: all
three reach `src/config`, which validates the environment once at import time, and
a static import is hoisted above the assignments. It failed exactly that way on
the first run — five assertions passing 401s and 201s because the limits under
test were still 100000.

<details>
<summary>Original plan for this chunk</summary>

## S0 — rate-limit the auth routes (1 hour) — **prerequisite, do first**

`middleware/rate-limit.ts` exists and is applied to marketing (240/min) and
public (10/min writes). `auth.route.ts` has none, and there is no global limiter
in `app.ts`. So `/api/auth/login`, `/register`, `/forgot-password` and
`/reset-password` currently accept unlimited attempts.

This is already a W1.1 item. It becomes a **blocker** here: a platform account
with cross-tenant write, reachable through an unthrottled login endpoint, turns
one guessable password into every studio's data. The careful timing-attack work
in `auth.service.ts` assumes a door that is currently unlocked.

**Touches:** `modules/auth/auth.route.ts`

**Shape:** a strict limiter on login/forgot/reset keyed on IP *and* submitted
email (so one attacker cannot spread attempts across many addresses, and one
victim cannot be locked out by an attacker hammering their address from many
IPs — key them separately, not combined). A looser one on register.

**Tests:** the Nth attempt gets 429; the counter is per-key; a successful login
does not consume budget for other users.

</details>

---

## S1 — the platform gate — **DONE 2026-08-17**

Built as planned: `platform_admins` with the partial unique index, a CLI-only
grant path, `requirePlatformAdmin`, and `/api/platform/*` mounted outside both
organization routers. `GET /api/platform/me` is the client's discovery probe.
12 tests in `tests/platform/gate.test.ts`.

**Two things the plan got right and one it got wrong.**

Right: the partial index. `@@unique([userId, revokedAt])` would have looked
equivalent and enforced nothing, because Postgres treats NULLs as distinct — every
live grant carries `revoked_at = NULL`, so it would have permitted unlimited
duplicates of exactly the rows it exists to forbid. The test asserts it with a
direct `prisma.platformAdmin.create`, not through the service.

Right: checking the grant per request instead of putting it in the token. The test
that matters is "does not let an already-issued token outlive its grant" — same
token throughout, revoked mid-test, refused on the next call.

**Wrong: "404 not 403" is not sufficient on its own, and the plan's wording hid
that.** A hand-rolled `AppError.notFound('Not Found')` returns the right status
with the wrong body — the real handler answers `Route not found: GET /api/…`, so
status matched and body differed, which is a perfectly good oracle for locating
the surface. The gate now **delegates to the app's own `notFound`**, so the two
cannot drift apart later either.

Related: the router uses a new `authenticateOptional` rather than `authenticate`,
because `authenticate`'s 401 is itself a disclosure — "this route is real, bring
credentials" is the one fact the surface exists to withhold. No token, bad token,
ordinary owner and revoked admin now all leave by the same door.

**One caveat for whoever next runs `prisma migrate dev`:** Prisma cannot express
a partial index, so it does not know this one should exist and a generated
migration may include a DROP for it. `migrate diff` reports "no difference"
today, so it will not announce itself. The schema comment says so at the model,
and the double-insert test fails if the index goes missing.

**Verified by hand as well as by the suite:** grant, idempotent re-grant, list
with note, unknown-address failure (exit 1), revoke, and re-grant after revoke —
which leaves two rows for one user, exactly one of them live.

<details>
<summary>Original plan for this chunk</summary>

## S1 — the platform gate (half a day)

The foundation. Nothing else can be built until there is a way to say "this
human is Artweel, not a studio".

**Migration — `platform_admins`**

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid, FK `users` on delete cascade |
| `granted_by` | uuid null, FK `users` on delete set null |
| `granted_at` | timestamptz, default now |
| `revoked_at` | timestamptz null |
| `note` | text null — why this person has it |

Partial unique index on `user_id WHERE revoked_at IS NULL` — one live grant per
human, while keeping revoked rows as history. A boolean on `User` would give you
none of that history, which is the entire point of a table.

Clean against the `DEPLOY.md` redeploy rule: new table, nothing existing
touched, no index on `bookings` / `sessions` / `payments`.

**Bootstrap — deliberately not an API route.** The first platform admin cannot
be created through the UI, because creating one requires being one. Ship a CLI
script (`npm run platform:grant -- someone@example.com`) run on the box. An
HTTP endpoint that grants platform admin is a privilege-escalation endpoint
sitting permanently in your route table; a script that requires shell access on
the server is not.

**Middleware — `requirePlatformAdmin`**

Runs after `authenticate`. Looks up a live grant by `userId`. On failure returns
**404, not 403**, consistent with the existing non-member convention — a 403
confirms the platform surface exists, a 404 does not.

**Route group** `/api/platform/*` mounted in `app.ts`, with its own rate limiter
and never passing through `withOrganization`.

**Tests:** signed-out → 404; ordinary studio owner → 404; revoked admin → 404;
live admin → 200. Assert explicitly that the response for a non-admin is
byte-identical to the response for a route that does not exist.

**Why first:** it is the gate. Every later stage mounts behind it.

</details>

---

## S2 — the audit log — **DONE 2026-08-17**

`platform_audit_log`, a `withAudit` wrapper, and `GET /api/platform/audit`.
10 tests in `tests/platform/audit.test.ts`.

**`withAudit` rather than a bare `recordPlatformAction`.** It opens the
transaction, hands the caller the transaction client plus an `audit(patch)`
callback to fill in before/after once it knows them, and writes the row before
committing. The point is that the shortest thing to write is also the correct
one: there is no convenient path that records outside the transaction. The lower-
level helper takes `tx` as its first argument with **no default** for the same
reason — defaulting it to the global client would make the unsafe call the
tidiest, and that failure is invisible in review because the row still appears
and the tests still pass.

**Both failure directions are tested, which is unusual and was the point.**
Action throws → no row, and the action's own half-finished write is gone.
Audit insert fails → the action rolls back rather than succeeding unrecorded. The
second direction is normally untestable, so the migration adds
`CHECK (length(action) > 0)` partly to make it reachable: an empty action forces
the insert to fail on purpose. Without that, the same-transaction guarantee could
only be verified by reading the code.

**No foreign keys on `actor_user_id` or `organization_id`, deliberately.** This
reverses the plan, which specified `ON DELETE SET NULL` for the actor. That would
keep the row and erase the one field it exists to record. CASCADE would delete
the evidence along with the account. An audit row has to outlive what it refers
to, and preventing exactly that is a foreign key's job — S11 (archive/purge)
makes deletion a real future event rather than a hypothetical. `actor_email` is
snapshotted at write time so the record stays readable when the user row is gone
and a bare uuid means nothing. There is a test that deletes both the studio and
the actor and asserts the entry still names them.

**Immutability is convention, not enforcement.** No update or delete path exists
anywhere and none should be added; a test asserts POST and DELETE on `/audit`
are 404. Making it real means revoking `UPDATE`/`DELETE` on the table from the
application's DB role, which needs a separate migration role — still noted, still
not done.

Deviation worth naming: the read endpoint landed here rather than in S3, so S2 is
verifiable over HTTP instead of only from tests. It uses the existing
`validateQuery` middleware — a bare `schema.parse()` would have surfaced a
`ZodError` as an opaque 500 rather than a 422.

<details>
<summary>Original plan for this chunk</summary>

## S2 — the audit log (half a day) — **before any write action, not after**

**Migration — `platform_audit_log`**

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `actor_user_id` | uuid, FK `users` on delete set null — keep the row if the human is deleted |
| `action` | text, e.g. `organization.suspend` |
| `target_type` / `target_id` | what was acted on |
| `organization_id` | uuid null, indexed — "show me everything ever done to this studio" |
| `reason` | text null, required by the routes that take one |
| `metadata` | jsonb — before/after |
| `ip`, `user_agent` | text null |
| `created_at` | timestamptz, indexed with `organization_id` and with `actor_user_id` |

**The one correctness point: write the audit row inside the same transaction as
the action it records.** Outside it, the two can diverge in both directions — an
action that rolled back leaves a log entry claiming it happened, or a successful
action leaves no trace because the log insert failed. Both are worse than no
log, because both are *confidently wrong*. A `recordPlatformAction(tx, {...})`
helper that takes the transaction client makes the right thing the easy thing.

Append-only by convention now: no update or delete path is ever written. Revoke
`UPDATE`/`DELETE` on the table from the application's DB role when there is a
separate migration role to do it with — noted, not done here.

**Why before S4 and not after:** retrofitting audit onto existing write paths
produces partial coverage and no way to know which paths are missing. There are
about five write actions at this stage, so wrapping them from the start is
nearly free. In six months it is not.

**Tests:** a suspend writes exactly one row with the right actor, org and
reason; a write that throws leaves **no** audit row.

</details>

---

## S3 — platform reads: studios and metrics — **DONE 2026-08-17**

`GET /api/platform/organizations` (search, filter, sort, paginate),
`/organizations/:id`, and `/metrics`. 17 tests in
`tests/platform/studios.test.ts`.

**The price map already existed, so nothing was duplicated.**
`billing/plan.ts` is the single definition of what a plan costs — the marketing
site and Stripe checkout both read it — so MRR reads from there. The earlier note
about "a price map to keep in one place" was solving a problem this codebase had
already solved. What remains true: the figure is only as current as `PLANS`, and
nothing records what a given studio actually agreed to pay, so a price change
would silently restate history. Fine while pricing has never changed; it is one
of the pressures behind S12 rather than a bug here.

**MRR counts `ACTIVE` only.** A trial pays nothing and `PAST_DUE` is money we have
not been paid — including either reports hoped-for revenue as real. Tested with a
PRO studio in PAST_DUE contributing zero.

**The two money numbers were verified apart, not assumed apart.** `payments` is
written only by `payments/payment.service.ts` and `PaymentKind` is
`DEPOSIT | BALANCE | FULL` — all studio-side. Our subscription charges are never
in that table; they live in Stripe, which is *why* MRR has to be computed rather
than summed. Noted in `metrics.service.ts`: if a `SUBSCRIPTION` kind is ever added
to that table, the volume aggregate silently starts including our revenue in
theirs and the distinction collapses.

**The N+1 risk is pinned by a test, not a comment.** Counts are gathered as one
grouped query per relation, and a test asserts the query count does not grow with
the number of studios — the N+1 version passes every other test in the file and
only shows up as an unusable screen later. Still not free forever: `groupBy` over
`bookings` grows with total bookings rather than page size, so at a few hundred
studios move counts to the detail view or precompute a rollup.

**Two things resolved by not pretending.** `lastBookingAt` is not a column, so it
cannot be an `ORDER BY`; asking for that sort falls back to newest-first and the
response carries `sortFellBack: true` rather than quietly returning a different
order than requested. And a non-uuid studio id is rejected before it reaches
Prisma, where it would surface as an opaque 500 instead of a 404.

Onboarding is read two ways on purpose: the list uses the `onboardingDoneAt`
column (one field, no extra queries), the detail view calls the real
`getOnboardingState` for the full step breakdown — five queries, worth it for one
studio, because "signed up and never finished" is only actionable if you can see
which step they stopped at. The two cannot disagree: that function's `complete` is
exactly that column being set.

<details>
<summary>Original plan for this chunk</summary>

## S3 — platform reads: studios and metrics (1 day)

The highest-value screen in the set. It answers, in one look, questions that are
each a five-table join in `psql`: how many studios exist, who is trialing, who
lapses this week, who signed up and never finished onboarding, who has never
taken a booking.

**`GET /api/platform/organizations`** — search on name, slug and owner email;
filter by `subscriptionStatus` and `plan`; sort by signup date, trial end, last
activity; paginated.

**`GET /api/platform/organizations/:id`** — the org row, owner contact, plan and
subscription state, trial/grace dates, Stripe Connect status, signup attribution
(`signupSource` / `signupReferrer` / `signupLanding` are already captured at
registration), plus counts: staff, services, customers, bookings, and the date
of the most recent booking.

**Reuse the existing onboarding derivation.** Completeness is derived from data
rather than a clicked flag (W1.8) — call that code, do not reimplement the
notion of "set up" in a second place, or the two will disagree.

**Perf tripwire, stated now rather than discovered later:** per-row counts across
`bookings` and `customers` for every studio in a list is the classic aggregate
that is free at ten studios and painful at a thousand. Do it as one grouped
query, not N+1, and when studio count passes a few hundred, move counts to the
detail view only or precompute a rollup. Not a problem to solve today; a
problem to have named.

**`GET /api/platform/metrics`** — the numbers the overview screen renders.
Grouped in one response because they are read together and separately they are
each one cheap query:

- studios by `subscriptionStatus` and by `plan`
- trials expiring in the next 7 days, and trials that expired without converting
- signups per week, with the `signupSource` breakdown that registration already
  captures
- trial-to-paid conversion rate
- studios that signed up and never completed onboarding
- studios with no booking in the last 30 days — the churn leading indicator
- platform-wide booking volume

**Define the money carefully — there are two unrelated numbers here.** What
studios pay *us* (our subscription revenue) and what flows *through* studios
(their customers' payments) are not the same thing and must never be added
together or shown adjacent without labels. Connect charges are direct, with the
studio as merchant of record, so that second number is not our revenue and is
not on our books. Report subscription revenue as the headline; if booking volume
is shown at all, label it as studio volume.

**MRR is computed, not stored.** Plan prices are hardcoded (Solo $39 / Studio $89
/ Pro $189), so any MRR figure is derived from the `Plan` enum plus a price map
in code. That is fine at three plans, but it means the number silently goes
stale the day pricing changes and nobody updates the map. Put the price map in
one place, next to the plan definitions, so there is a single thing to change —
and note that this is one of the pressures that eventually argues for S12.

**Tests:** filters and search return the right sets; a non-admin cannot reach
any of the three routes; counts and metrics match fixtures; a trial expiring
today lands in the 7-day bucket exactly once.

</details>

---

## S4 — trial, plan and suspension controls — **DONE 2026-08-17**

Four write routes (`/trial`, `/plan`, `/suspend`, `/unsuspend`) plus `/plans`.
25 tests in `tests/platform/studio-admin.test.ts`.

### The comp decision — settled 2026-08-17

**Comping does NOT cancel the Stripe subscription.** Chosen deliberately against
the recommendation above; the plan's argument for cancelling still stands and is
left intact rather than rewritten.

So the local row and Stripe diverge by design: a comped studio reads ACTIVE on a
plan it is not paying for while its card keeps being charged. The mitigation
available inside that choice is to make the divergence impossible to miss rather
than to prevent it:

- `comped_at` is stored, so "comped" is a recorded fact rather than something
  inferred later from a plan that does not match a subscription;
- the audit row records `stripeSubscriptionStillActive` **at the moment of the
  decision**, so the log answers "did we know they were still being billed?"
  without anyone reconstructing Stripe's state months later;
- the studio detail response carries a `COMPED_BUT_STILL_BILLING` warning;
- the API logs a warning when it happens.

### Suspension outranks billing

`suspended_by_platform_at` plus `suspended_reason`, and the guard applied at
**three** places, not the one the plan named — `onPaymentSucceeded`,
`onSubscriptionChanged`, and the no-Stripe-key local activation branch of
`createSubscriptionCheckout`. That third one matters: it is reachable on any
deployment without Stripe keys, **which includes staging today**, so leaving it
unguarded would have made suspension bypassable in one click exactly where it was
most likely to be tried.

Stripe-side facts (subscription id, period end, plan) are still recorded when a
suspension holds. Only the *status* is withheld, because that is the field an
operator suspension owns.

`/unsuspend` deliberately does not decide the studio's status on its own terms —
it restores TRIALING if the trial is still running, ACTIVE if there is a live
subscription or a comp, and otherwise leaves the studio SUSPENDED for the billing
reason that was true before the operator intervened, recording
`stillSuspendedForBillingReasons` so the log explains a studio that stayed dark.
Guessing ACTIVE would hand a free account to any lapsed studio that happened to
get suspended twice.

### Two holes the tests caught in my own code

`extendTrial` and `setPlan` both flipped `SUSPENDED` to something live based on
**the status alone**. Since billing and operators write the same `SUSPENDED`, both
routes were a way to lift an abuse suspension — the exact bypass this column
exists to prevent, reintroduced one route later, in the same commit that
introduced the guard.

Worse in `setPlan`: the comment already claimed it would not undo an operator
suspension while the code did not check. A comment asserting a guarantee the code
does not implement is worse than no comment, because it stops the next reader
looking. Both now check `suspendedByPlatformAt`, and both have a named test.

### Reasons are mandatory and enforced

Minimum 8 characters, rejected at 422 with no audit row written. Not bureaucracy:
an operator who can satisfy the field with `x` will, and then the log records that
somebody typed a character. "Who" and "what" are usually recoverable from other
evidence; "why" never is.

<details>
<summary>Original plan for this chunk</summary>

## S4 — trial, plan and suspension controls (1 day)

The first writes. Every one takes a **required `reason`** and writes an audit
row in its transaction.

- `POST /api/platform/organizations/:id/trial` — extend to a date
- `POST /api/platform/organizations/:id/plan` — set plan, or comp
- `POST /api/platform/organizations/:id/suspend` / `unsuspend`

**Migration:** add `suspended_by_platform_at` (timestamptz null) and
`suspended_reason` (text null) to `organizations`. Nullable, no default, no
rewrite — clean against the redeploy rule.

**Trap 1 — manual suspension will be silently undone.** `SUSPENDED` is currently
set and cleared by Stripe webhooks and `sweepExpiredSubscriptions`
(`billing.service.ts:344`). Suspend a studio by hand for abuse, and their next
successful invoice quietly reinstates them. The new column is what keeps the two
reasons from clobbering each other: billing-driven transitions must refuse to
clear `SUSPENDED` while `suspended_by_platform_at` is set.

This is a change to *existing, tested* billing code. The regression test is
specific and worth writing first: platform-suspend a studio, simulate a
successful invoice, assert it is still suspended.

**Trap 2 — comping a plan does nothing to Stripe.** Setting `plan` and
`subscriptionStatus` in our database does not stop Stripe billing the studio's
card. Tell a studio their account is free and Stripe keeps charging it monthly.
**Decision required before this ships** (see open questions): the recommended
behaviour is that comp cancels the Stripe subscription and marks the org
`ACTIVE` locally with a comp marker, so there is exactly one source of truth for
"is this studio paying".

**Tests:** each action writes audit; suspend blocks new public bookings but
leaves reads open (assert against the existing suspended-studio behaviour rather
than re-deriving it); trial extension moves the date and nothing else.

</details>

---

## S5 — platform health — **DONE 2026-08-17**

`worker_heartbeats`, `recordWorkerRun`, and `GET /api/platform/health`.
11 tests in `tests/platform/health.test.ts`.

**Health iterates an EXPECTED-worker list, not the rows that exist.** This is the
whole C2.1 lesson made structural. A worker that was never started leaves no
heartbeat row, so anything driven by "what is in the table" reports nothing wrong
— which is precisely how three uncalled sweeps stayed invisible for two days with
every check green. `EXPECTED_WORKERS` in `lib/heartbeat.ts` names the three and
their intervals, so **absence is itself a reportable state** (`never-run`).

**Four states, and `failing` outranks `late`.** A worker whose every tick throws
is still ticking, so a liveness check calls it healthy — running perfectly and
achieving nothing, the same shape of problem C2.1 was. The last error is retained
after a later success, so a fault that has since cleared is still visible rather
than erased by the next quiet tick.

**Outcome checks, not just liveness.** `unswept.waitlistOffersOverdue` and
`expiredHoldsStillOpen` climb whatever the worker rows claim — an offer past its
expiry that is still OFFERED is literally what C2.1 left in the database. This is
the number that would have caught it even if a heartbeat had been lying.

**Heartbeat failures are swallowed and logged, never thrown — the exact opposite
of the audit log's contract.** Deliberate, and the contrast is documented at both
ends. An audit row that cannot be written must abort the action it describes,
because the record is part of the point. A heartbeat is only ever a report ABOUT
the work, so letting a failed report kill a notification send would mean
observability causing the outage it was installed to reveal.

`recordWorkerRun` is a WRAPPER rather than two calls a worker makes itself, so a
tick cannot stamp its start and then forget its finish — which would read,
permanently, as a worker stuck mid-run. It is applied inside each worker's
existing try/catch, so failed-tick logging and loop survival are unchanged.

Kept separate from `/api/health`, which answers "can this container serve traffic"
for the load balancer, is public, and must stay cheap. A test asserts worker state
does not leak into it.

**Two mistakes worth recording, both caught before they mattered:**

Three required fields were missing from my own fixtures (`Session.timezone`,
`Session.localStartTime`, `ServiceType.slug`), found by reading the schema rather
than by waiting for a run.

And the sweep-worker test polled for the heartbeat ROW rather than for
`lastFinishedAt`. Since `recordWorkerRun` stamps the start first, the row exists a
moment before the tick completes, so the poll won the race and asserted on a
half-written row — failing while the worker behaved perfectly. The same class of
error as the fixed-sleep flake in `tests/gate/sweeps.test.ts`: **poll for the
condition you actually mean.**

<details>
<summary>Original plan for this chunk</summary>

## S5 — platform health (half a day)

Normally optional. It is in the minimum because of C2.1: three sweep functions
were written, tested, described in their own docstrings as running on a
schedule, and **called by nothing outside the test suite** — waitlist offers
held their seats permanently and no trial ever ended. Separately, a deploy that
shipped nothing looked identical from outside: health green, every route 200, a
genuinely fresh uptime.

A queue that silently does nothing is indistinguishable from a quiet queue. This
is the screen that tells them apart.

**Migration — `worker_heartbeats`:** `name` (pk), `last_started_at`,
`last_finished_at`, `last_error`, `last_run_count`. Each worker and each sweep
stamps it. Tiny table, one row per worker.

**`GET /api/platform/health`** — per worker: last run, age of that run, last
error. Plus outbox pending and failed counts, oldest unclaimed job age, and
waitlist offers currently held.

**Surface staleness, not just presence.** "Last run: 4 hours ago" for a sweep
that should run every ten minutes is the signal; a row simply existing is not.

**Touches:** `workers/sweep.worker.ts`, the notification and calendar workers,
`modules/health/`.

</details>

---

## S6 — the `/admin` dashboard client — **DONE 2026-08-17**

Five screens in `client/src/admin/` — Overview, Studios, Studio detail, Health,
Audit — as a separate route tree with its own shell inside the existing Vite
bundle. Verified in a browser by signing in and driving the whole surface,
including a real suspend and unsuspend.

**Branched in `App.tsx` ABOVE everything studio-related, and the reason matters
more than expected.** Below that line, zero memberships renders the "No studio
yet" dead end — and an Artweel operator legitimately belongs to no studio, which
is the normal case for a staff account. Branching after the membership check
would have made `/admin` unreachable for exactly the accounts that need it.

Discovery is `GET /api/platform/me`; a non-admin sees only what a wrong URL would
say. No flag was added to `/api/auth/me`, so a studio owner's browser never
receives the fact that the surface exists.

Reuses the dashboard's existing `card`, `stat`, `alert` and `tag` patterns rather
than inventing a second visual language for one user. The Overview's tiles are
buttons that link into a filtered Studios list — a count you cannot click through
to is a count you cannot act on. Filters live in the URL, so a tile can deep-link
and an operator can bookmark what they were looking at.

Destructive actions open an inline panel with a **required typed reason**,
disabled below 8 characters with a visible hint, and surface the server's refusal
verbatim rather than paraphrasing rules it knows better.

### Four bugs, three of which only a browser would have found

**1. `expiredHoldsStillOpen` counted released holds.** No `releasedAt: null`
filter, so it counted every hold that had EVER expired — a number that only
grows, so the page would have reported "degraded" permanently after the first
abandoned checkout. The tests passed because no fixture had a released hold. This
is the exact failure the S5 comments warn about: a check that cries wolf trains
the one person who reads it to stop. Now has a regression test both ways.

**2. "Oldest pending notification" was misleading.** It displayed a *future*
date — 32 reminders scheduled for next week, which is a healthy queue, not a
backlog. Split into `overdue` (the signal) and `waiting` (labelled "scheduled
ahead — not a backlog"), and `degraded` now counts overdue rather than pending.

**3. The Health page's error state was sticky.** It polls every 10s, and one
failure during a dev-server restart left "Could not load health" on screen for
good while the polls behind it succeeded. Now cleared on every success, and a
failed refresh keeps the last known figures with a staleness banner — on a
monitoring page the previous reading is still the most useful thing available.

**4. Nested `Routes` used relative paths.** `AdminApp` is rendered directly rather
than under `<Route path="/admin/*">`, so there is no parent route to establish a
base and the patterns matched the whole pathname. `path="/"` never matched
`/admin`: the shell rendered, the gate returned 200, and the main panel was blank
with no error anywhere to point at it. Absolute paths now, with the reason
written at the routes.

### Noticed while verifying, not fixed

The seeded `Clay & Co` is `TRIALING` with a null `trialEndsAt`, and
`sweepExpiredSubscriptions` only suspends trials whose `trialEndsAt` has passed —
so that studio trials forever. Looks like a seed artifact rather than a code bug,
but it is now visible on the platform screens and worth a look.

<details>
<summary>Original plan for this chunk</summary>

## S6 — the `/admin` dashboard client (2 days)

**Not a second Vite app.** A separate top-level route tree at `/admin/*` in the
existing `client/`, rendering **its own shell** — not the studio sidebar with
extra links. Same build pipeline, but no conditional inside the studio shell
that could ever leak platform UI to a normal user. `App.tsx` currently renders
the studio shell unconditionally for any signed-in user with a membership; the
admin tree branches above that, not inside it.

Split it into its own bundle when there is a second platform user, or when you
want to IP-restrict it.

**Discovery:** `GET /api/platform/me` — 404 for everyone else. The admin shell
probes it. This keeps `/api/auth/me` untouched, so the studio client never
learns the platform surface exists.

**Screens**

1. **Overview** — the landing screen, rendering `GET /api/platform/metrics`:
   studios by status and plan, trials expiring this week, signups per week with
   source breakdown, trial-to-paid conversion, studios stalled in onboarding,
   studios with no booking in 30 days, and a worker-health indicator that links
   into Health when something is stale. Subscription revenue as the headline
   number; studio booking volume, if shown, explicitly labelled as theirs.
   Every tile is a link into a filtered Studios list — a count you cannot click
   through to the underlying rows is a number you cannot act on.
2. **Studios** — list, search, filters, sort.
3. **Studio detail** — everything from `GET /api/platform/organizations/:id`,
   plus all S4 actions, each with a required reason field.
4. **Health** — per-worker last-run and staleness, queue depths, stuck jobs.
5. **Audit** — filterable by studio and by actor.

Follow the existing dashboard's conventions rather than inventing a second
visual language — `client/src/styles.css` already carries the card, table, alert
and empty-state patterns the Phase 2 screens use.

**Every destructive action confirms with a typed reason, not an "Are you sure?"**
The reason is going into the audit log and is the thing that makes the log worth
having. A dialog that can be dismissed with one click trains you to dismiss it.

**Why last in Stage 1:** the API is testable without it, and building screens
against finished endpoints is faster than building both at once.

</details>

---

# STAGE 2 — the next tier

## S7 — read-only support sessions into a studio (2 days)

The only stage that touches the tenant choke point. Out of Stage 1 only because
you have database access and you are the sole operator. **Tripwire for pulling
it forward: the first support ticket you cannot answer from the studios list** —
typically "the screen shows something odd", which the database cannot tell you.

`POST /api/platform/organizations/:id/support-sessions` with `{ reason,
readOnly }` returns a **short-lived, non-refreshable** access token:

- ~30 minutes, no refresh token issued — expiry is a hard wall, not a
  negotiation, and a session cannot be silently extended
- scoped to exactly **one** organization
- carries both identities: the studio context and the real human driving it.
  This is the RFC 8693 actor-claim shape, and the reason it matters is that the
  audit row must never lose who was actually at the keyboard
- `readOnly` is the default

Downstream, **nothing changes**. `authenticate` recognises the support scope and
sets the marker; `withOrganization` accepts the grant in place of a membership,
for that org id only; a read-only grant rejects any non-`GET`/`HEAD` at the same
choke point. No module is edited, which is the whole argument for doing it this
way rather than a bypass flag: the exception lives at the one place that already
owns this decision.

**Why not a bypass.** `if (isPlatformAdmin) allow` in `withOrganization` is four
lines and instantly makes all 144 route definitions live — including refunds,
cancellations and member removal — with no gradient between "look at their
calendar" and "delete their owner", and nothing in the logs distinguishing a
support session from ordinary traffic.

**Audit volume:** one row for the session (reason, org, actor, expiry), one row
per write. Do **not** write a row per read — it buries the writes. Record a read
count and the endpoints touched on the session row instead.

**Dashboard banner** whenever a support session is active: which studio, whose
session, read-only or not, and the expiry time.

## S8 — global users list and disable (half a day)

`User` has **no active/disabled column** — that is the whole migration. Disabling
must also revoke every refresh token, or the account keeps working until each
one expires (`revokeAllUserTokens` already exists and does exactly this for
password resets).

Cross-tenant PII, so it is behind audit from day one. **Tripwire:** your first
"I can't log in" email.

## S9 — invites and cross-tenant role assignment (1 day)

**This unblocks three of the four roles.** Signup only ever mints an `OWNER`, and
`inviteMemberSchema` — carrying exactly `ADMIN | INSTRUCTOR | FRONT_DESK` — sits
at `auth.schema.ts:90` **imported by nothing**. The validation was written and
the route never was, so `ADMIN`, `INSTRUCTOR` and `FRONT_DESK` are currently
unreachable in a running system and the role model is theoretical.

Build the studio-side invite flow first (it belongs to W1.1 regardless), then
expose cross-tenant role assignment to the platform on top of it. Reuse
`changeMemberRole`, and **do not let the platform bypass the LAST_OWNER guard** —
a studio with zero owners is not a state worth being able to create.

## S10 — integrations status (half a day)

Read-only per studio: Stripe Connect account state, which instructors have
connected Google Calendar, Twilio/messaging state. Plus a disconnect action for
support ("their calendar sync is wedged, disconnect and let them re-auth").

---

# STAGE 3 — deferred, each its own decision

## S11 — company archive and purge

"Delete company" as written contradicts a rule this codebase applies
everywhere: nothing with booking history is hard-deleted, it 409s and tells you
to deactivate. An organization row is attached to payments, Stripe charges and
customer PII, and financial records carry retention obligations you do not get
to opt out of — a cascade delete would take them with it.

What you actually want is two features that share a word: **archive** (hidden
everywhere, data intact, reversible) and **purge** (a separate, explicit,
heavily-audited erasure for a GDPR/CCPA-style request, with the financial
records retained under their own rule). Design them as two things or the safe
one will not exist.

## S12 — plans and pricing as data

A billing-model change wearing a superadmin costume. Plans are currently code: a
`Plan` enum, limits enforced in code on CREATE, prices pinned to Stripe Price
objects — which are **immutable by design**, so "change the price" really means
"create a new price and migrate existing subscribers".

You have three plans and you change them approximately never. Editing an enum
and deploying is currently cheaper *and* safer than building the machine that
edits them at runtime. Revisit when a pricing experiment is actually planned.

## S13 — permissions as data

Only worth doing after the roles mean something. `requireAdmin` is
`OWNER + ADMIN` and `requireMember` is all four, so **`INSTRUCTOR` and
`FRONT_DESK` are currently identical** — an instructor can issue refunds, edit
pricing and change cancellation policies. A permissions UI today would edit a
distinction the backend does not make.

The valuable half is splitting those two roles properly. Turning 144 hardcoded
guards into a data-driven matrix is the expensive half, with a real chance of
introducing an authorization hole, and it buys little while you are the only one
configuring it.

## S14 — global settings, maintenance mode, log access

**Settings** are all env vars in `src/config` today; making them runtime-editable
means a table plus cache invalidation across processes. Needs a concrete list of
*which* settings before it is a plan rather than a wish.

**Logs: buy, do not build.** Application logs (pino → stdout → Docker) and the
audit trail are different things. The audit trail belongs in the product and is
S2. A log *viewer* in the dashboard is a data-exfiltration surface that never
scales and that hosted services already do better. Ship logs to one of those.

---

## Not code — decide

1. ~~**Comp semantics.**~~ **Settled 2026-08-17: comping leaves Stripe billing.**
   The divergence is surfaced rather than prevented — see S4. The consequence to
   keep in view: cancelling the Stripe subscription is a manual step in the Stripe
   dashboard that a human has to remember, and the only thing reminding them is
   the warning on the studio detail screen.
2. **Transparency.** Silent, notify-after, or owner-approval when Artweel looks
   inside a studio? Notify-after — a line in the studio's own activity view,
   "Artweel support viewed your bookings, reason: ticket #42" — costs almost
   nothing and turns the feature into something you can advertise rather than
   something you would rather not be asked about.
3. **Is it only ever you?** If yes, S1 stays one flag and one account. If a VA or
   contractor will ever do support, platform *levels* (support vs. full) are far
   cheaper to design into S1 than to retrofit into a shipped surface.
4. **MFA on platform accounts.** There is no MFA anywhere in the product. One
   password currently stands between a phished account and every tenant's data.
   Not required to build any of this; worth deciding whether it gates turning it
   on in production.

---

## Order of work

```
S0 rate limit ─► S1 gate ─► S2 audit ─► S3 studios read ─► S4 writes
   (done)         (done)      (done)       (done)             (done)
                                                              │
                                             S5 health (done) ─┤
                                                              ▼
                                                  S6 /admin client (done)
                                                   ── STAGE 1 COMPLETE ──
                                                              │
                        ┌─────────────────────────────────────┤
                        ▼                                     ▼
                 S7 support sessions            S8 users ─► S9 invites+roles
                                                              │
                                                              ▼
                                                     S10 integrations

Stage 3 (S11–S14) — not scheduled. Each revisited on its own trigger.
```

Stage 1 is roughly a week. The critical path runs S1 → S2 → S4, because audit
must exist before the first write path is written, not after.
