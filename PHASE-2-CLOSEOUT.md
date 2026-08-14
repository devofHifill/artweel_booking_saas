# Phase 2 closeout plan

Everything in Phase 2 is built. Nothing in Phase 2 is *usable*. This plan closes
that gap and nothing more — no new features, no Phase 3 work. Scope is fixed the
same way Phase 2's was: adjacent requests go to Phase 3.

Ordered so that each step de-risks the next, and so a failure tells you which
thing broke.

---

## Decision — settled 2026-08-14

**The product keeps the name "Studio Bookings".** "Artweel" was only ever the
repo name and the staging hostnames; the application has said Studio Bookings
throughout. So the application copy stands and the *infrastructure* moves to
match it, which is C3.

One piece of luck in the timing: staging is served with `X-Robots-Tag: noindex,
nofollow`, so nothing is indexed under the old hostname and changing it costs no
SEO at all. Doing this after that middleware comes off would be a different
conversation.

---

## C1 — correct the stale handoff status (10 minutes)

`HANDOFF.md:25` says Phase 2 is "code-complete except class packs". W2.6b is
marked DONE at line 512 and packs shipped in `61ce328`. The header is simply out
of date.

Fix the header, and while in there restate the deploy drift accurately: staging
is current through W2.2c only.

**Touches:** `HANDOFF.md`

**Why first:** it costs nothing and the document is the thing every later step
reads to orient itself. A status doc that lies about the current phase is worse
than no status doc.

---

## C2 — deploy the five undeployed workstreams (half a day)

Staging is current through W2.2c. Not on it: make-up credits, piece tracking,
kiln firings, waitlists, class packs, widget + WordPress plugin.

Carries three migrations — `20260812190000_credits_pieces_firings`,
`20260812210000_waitlists` and `20260812230000_class_packs` — and one new config
value, `WAITLIST_OFFER_TTL_MINUTES`, which has a default and so needs no
`.env.production` edit.

**Steps**

1. Back up the staging database before touching it. Three migrations at once on
   a live box is exactly when you want a restore point.
2. Deploy per `DEPLOY.md`, with `docker compose -f docker-compose.prod.yml` —
   never bare `docker compose`.
3. Verify `/api/health` reports `database`, `postgis` and `btreeGist` ok.
4. Smoke-test one path per workstream through the API: create a credit, log a
   piece, open a firing, join a waitlist, load the embed script.

**Why before the dashboard work:** the code is already written and tested, so
this deploy proves the *migrations*, in isolation. Bundle it with six new pages
and a failure becomes ambiguous. It also means the dashboard is built against a
staging box that actually has the tables.

**Risk to watch:** the waitlist offer worker runs on a lease claim like
notifications. Confirm it drains on staging rather than assuming — a queue that
silently does nothing looks identical to a quiet queue.

### Migration audit (done 2026-08-14, before deploying)

All three read line by line against the redeploy rule in `DEPLOY.md` — that a
migration must be safe against the *old* code still serving requests, because
`migrate deploy` runs before `up -d`.

`..._credits_pieces_firings` — **clean.** Every table is new, so its indexes and
constraints build on empty relations. The only change to an existing table is
`organizations` gaining six `NOT NULL DEFAULT` columns, which does not rewrite
the table on PG 11+ and would be trivial regardless at that row count.

`..._waitlists` — **clean.** One new table, nothing else touched.

`..._class_packs` — **two things worth knowing.**

**1. It renames a table, and its own comment overstates why that is safe.** The
comment says the rename "is also what makes the rollout safe against the old
code still running during a deploy". That conflates two different properties.
The rename does preserve data — no credit a studio owes is destroyed, which was
the real point and is correct. But old code asking for `make_up_credits` after
the rename gets `relation does not exist`. Data safety is not rollout safety.

It is genuinely safe *here* only because both migrations land in the same
`migrate deploy` run: one creates `make_up_credits`, the next renames it, and
staging has never seen either. Had the earlier plan of deploying "two
migrations" now and packs later been followed, the rename would have broken the
running API for the seconds between migrating and the new containers starting.
Deploy all three together, and do not split them.

**2. It builds a plain index on `payments`, which is the exact case `DEPLOY.md`
warns about.** Line 115: `CREATE INDEX "payments_pack_purchase_id_idx" ON
"payments"("pack_purchase_id")`. The runbook says any index on `bookings`,
`sessions` or `payments` wants `CREATE INDEX CONCURRENTLY` in its own migration,
because a plain build locks writes for its duration. Free on staging, where
`payments` is nearly empty. A stalled checkout path against real volume.

**Do not edit the migration to fix this.** Two reasons: Prisma records a
checksum per migration and rewriting an applied one puts the local database into
drift, and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, which is
how Prisma wraps every migration — it would fail outright.

The fix is a later, separate migration that drops and rebuilds that index
concurrently, needed before production volume, not before staging. Logged here
rather than done now because it is a production-readiness item and this phase is
about closing Phase 2.

---

## C2.1 — schedule the three sweeps (1 day) — **do this first**

Found while verifying the C2 deploy on 2026-08-14. Grepping the API logs for
waitlist/outbox/queue activity returned nothing, which turned out not to be a
quiet queue.

`server.ts` starts exactly two workers — `startNotificationWorker()` and
`startCalendarWorker()`. Three sweep functions exist, are tested, and are
described in their own docstrings as running on a schedule. **Nothing calls
them outside the test suite.**

| Sweep | Defined | Only caller |
|---|---|---|
| `sweepExpiredOffers` | `waitlists/waitlist.service.ts:356` | `tests/gate/waitlist.test.ts` |
| `sweepExpiredSubscriptions` | `billing/billing.service.ts:344` | `tests/billing/billing.test.ts` |
| `sweepExpiredHolds` | `scheduling/hold.service.ts:272` | `tests/gate/holds.test.ts` |

`sweepExpiredHolds` even carries the comment "Runs on a queue in Phase 1". It
does not.

**In severity order:**

**1. Waitlist offers leak seats permanently.** `createHold` increments
`sessions.seats_taken` immediately (`hold.service.ts:84`), so an offered seat is
a really-held seat. Trace every path that releases one: the claim path
(`waitlist.service.ts:306`) *rejects* an expired offer and throws rather than
releasing, and withdrawal only releases if the customer withdraws. A customer
who is offered a place and simply ignores the email holds that seat forever, and
the queue never advances past them. This is precisely the failure the
`..._waitlists` migration comment describes — "an OFFERED row without an expiry
would hold a seat forever, which is worse than never offering it" — and the
`CHECK` constraint added there enforces that the expiry *timestamp exists*, not
that anything ever acts on it. W2.6a went live today, so this is live now.

**2. Trials never end.** Without `sweepExpiredSubscriptions`, no trial ever
reaches SUSPENDED and no grace period ever lapses. The entire W1.8 lapse policy
is unreachable in production. Every trial studio stays on trial indefinitely.

**3. Abandoned checkouts lose their backstop.** Less severe than it first looks:
`checkout.session.expired` is a subscribed Stripe event and `onCheckoutExpired`
does release the hold (`payment.service.ts:642`), so the normal path works. The
sweep is the safety net for a webhook that never arrives. Degraded resilience
rather than an active leak — but it is the only thing standing behind a missed
delivery.

**The fix** is small: one interval worker in the same shape as
`notifications/worker.ts`, started from `server.ts` and stopped in `shutdown`.
All three sweeps are already idempotent by design — `released_at IS NULL`,
`status = 'OFFERED'`, and `updateMany ... where status = 'PENDING'` respectively
— so concurrent or repeated runs are safe, and no locking work is needed.

**DONE 2026-08-14** — `src/workers/sweep.worker.ts`, wired into `server.ts`,
covered by `tests/gate/sweeps.test.ts`. 495 tests green, typecheck clean,
deployed to staging and confirmed by `Sweep worker started` in the API log.

Two notes on how it was built. Offers are swept before holds: a waitlist offer
holds its seat through a booking hold created with the *offer's* TTL, so both
fall due at the same instant, and going offers-first lets the coordinated path
mark EXPIRED, release the seat and pass it to the next person before the blunt
hold sweep can touch it. And the tests drive the worker rather than the sweeps —
every sweep already had a passing test that called it directly, which is exactly
how three uncalled functions went unnoticed.

---

## C3 — retire the "artweel" name (half a day to a day)

The decision keeps the application copy as it is, so none of the marketing
titles, JSON-LD or notification templates change. What changes is everything
around them. "artweel" survives in nine files, and they are not all docs.

### The part that is a real code change

**`server/src/modules/public/embed.ts` — this is a wire protocol, not a label.**
The embed script and the iframe talk to each other using the postMessage type
`artweel:height`, the DOM property `__artweelFrame`, and the `artweelMounted`
guard flag. Both halves must agree, and the WordPress plugin is the other half.

Rename it now and it costs nothing, because the plugin has never been installed
anywhere (C6) and no page on the internet embeds this. Rename it after a studio
has the old script cached and the iframe silently stops resizing. This is the
cheapest it will ever be.

`server/tests/public/embed.test.ts` asserts on `artweel:height` and moves with
it.

**`wordpress-plugin/` — a full prefix rename.** The plugin has no namespace;
the `artweel_` prefix *is* the namespacing. It touches the filename, `Plugin
Name`, `Plugin URI`, text domain, the `ARTWEEL_*` constants, every
`artweel_*` function, the `artweel_origin` / `artweel_slug` option keys, the
`artweel-booking` CSS class and the `artweel` shortcode.

Two of those are not just a find-and-replace. The **shortcode name** is what a
site owner types into a page, and the **option keys** are where their settings
live — changing either strands an existing install. Nobody has one yet, so this
is free today and a migration path later. Do it before C6, not after.

### The part that is infrastructure

- **DNS** — two new A records; pick the hostname first.
- **`docker-compose.prod.yml`** — container names (`artweel-api`,
  `artweel-client`, `artweel-postgres`) and the Traefik router labels and rules.
- **`deploy/env.production.example`** and the live `server/.env.production` —
  `PUBLIC_URL` and `APP_URL`.
- **Traefik certificates** — new hostnames mean new ACME issuance. Watch for the
  pre-existing `fdgsms.filldesigngroup.cloud` ACME failures on the same shared
  account; accumulated Let's Encrypt failures can rate-limit a legitimate new
  issuance.
- **Both Stripe event destinations** point at
  `https://artweel.fillforge.cloud/webhooks/stripe` and must be re-pointed.
  Editing a destination's URL does not roll its signing secret, so
  `STRIPE_WEBHOOK_SECRET` stays as it is.
- **The repo name** on GitHub — Suren's step.

### Docs

`DEPLOY.md`, `HANDOFF.md` and this file all reference the old hostnames
throughout.

**Order:** hostname decided → code and plugin rename → DNS → deploy → re-point
Stripe → verify certificates issued and webhooks return 200.

---

## C4 — the dashboard, in four chunks (the bulk of the work, ~2 weeks)

This is the real gap. `client/src/pages/` has 11 screens; six Phase 2 modules
have none. A studio cannot run courses, credits, pieces, firings, waitlists or
packs without curl.

**Do not build "six new pages."** The API shapes say otherwise. Waitlists mount
at `/sessions/:sessionId/waitlist` — they are a session sub-resource, not a
destination. Credits and packs are both "what this customer has already bought",
which is a customer question. Building six sidebar entries would produce a
navigation menu that doesn't match how anyone works.

Follow the existing conventions: `client/src/lib/api.ts` for calls,
`useOrgBase()` for the org-scoped prefix, a `pages/` component per screen, a
`NavLink` + `Route` pair in `App.tsx`.

### C4.1 — Waitlists into the existing Classes screen (2 days)

Not a new page. `Classes.tsx` already lists sessions; a full session grows a
waitlist panel showing the queue in order, with "offer next" and "remove entry".

Endpoints already there: `GET/POST/DELETE
/sessions/:sessionId/waitlist[/offer|/:entryId]`.

Smallest chunk, touches a file that already exists, and proves the API/UI
pattern before the larger screens. Start here.

### C4.2 — Courses (4 days, largest)

New `Courses.tsx` plus a `CourseDetail.tsx`. List series, create one, generate
its sessions, view the roster, enrol someone, cancel an enrolment.

Endpoints: `GET/POST /courses`, `GET/PATCH/DELETE /courses/:seriesId`,
`POST /courses/:seriesId/sessions`, `GET/POST /courses/:seriesId/enrollments`,
`DELETE /courses/:seriesId/enrollments/:enrollmentId`.

The all-or-nothing enrolment rule has to be visible in the UI, not just enforced
in the service — if a six-week enrolment fails because week four is full, the
screen must say which week.

### C4.3 — The studio floor: pieces + firings (4 days)

One new section, two views, because they are one workflow: a pot moves through
statuses, and a firing is a batch of pots moving together.

- Pieces: filter by status, the batch-log form (`POST /pieces/batch` — built for
  exactly this, a board of wet pots and no appetite for twelve forms), status
  transitions, and the uncollected shelf report (`GET /pieces/uncollected`).
- Firings: the queue (`GET /firings/queue`), open a firing, load and unload
  pieces, advance status.

Reaching `FINISHED` is what texts the customer, so the status control needs to
make that consequence obvious before it is clicked.

### C4.4 — Credits and packs onto the customer (3 days)

Mostly panels on `CustomerDetail.tsx`: credits held and their expiry, packs
bought and sessions remaining, redeem, and an owner-only pack catalogue screen
for defining what's for sale and at what price.

Endpoints: `GET/POST /credits`, `POST /credits/:creditId/redeem`,
`DELETE /credits/:creditId`, and the `/packs` router.

Note the permission split already in the API: defining packs is `requireAdmin`,
selling one is `requireMember`. The UI must respect that or it will show buttons
that 403.

**Commit at each of the four boundaries.**

---

## C5 — refunds for a cancelled course enrolment (2 days)

`refundForCancellation` in `payments/payment.service.ts:733` takes a
`bookingId`. Course money sits on the enrolment, so cancelling an enrolment
currently refunds nothing.

Not a UI gap — a real hole in the money path, and the one item here that loses
somebody actual cash. It needs its own tests, following the existing pattern of
the fake provider that signs real HMACs.

Do it after C4.2 so there is a screen to trigger it from.

---

## C6 — run the WordPress plugin for the first time (1 day)

`wordpress-plugin/artweel-booking.php` — 238 lines of PHP that have never been
executed, or even syntax-checked, because there is no PHP on this box.

Use the official `wordpress` Docker image; Docker is already here for Postgres.
Install the plugin, add the shortcode to a page, confirm the embed loads against
staging, then `php -l` everything for good measure.

Until this happens the plugin is an untested claim, and it is currently the only
Phase 2 deliverable with zero verification of any kind.

---

## C7 — rehearse the Phase 2 exit gate (2 days)

The gate: a studio runs a full six-week course (enrolment, attendance, one
absence, a redeemed make-up credit) *and* a full firing cycle (piece created →
both firings → collected, with the pickup notification delivered).

Both halves are covered by tests — `tests/admin/credits` and the "wet clay to
collected" case in `tests/admin/pieces-firings`. What has not happened is a
human doing it through the UI, which is what the gate actually asks.

After C4 that becomes possible. Do it on staging, through the browser, as a
studio owner would, and write down every place the UI fights back.

**Caveat:** the pickup notification will not arrive by SMS until 10DLC clears
(below). Verify it via the outbox row and email, and treat SMS as pending.

---

## Not code — track, don't build

- **Stripe Connect platform application** and **Twilio A2P 10DLC.** Both
  code-complete, both sitting in approval queues. Without 10DLC, US SMS is
  carrier-filtered: it looks sent and never arrives. Nothing here unblocks by
  writing code. Chase them now so they clear before they are on the critical
  path.
- **Talk to three US ceramics studios.** Still open, and `HANDOFF.md` already
  flags that pieces, kilns and credits were built ahead of it on inference about
  how a studio works. C4.3 and C4.4 put a UI on top of those inferences, which
  makes them harder to change later. Worth one conversation before C4.3 rather
  than after.

---

## Order of work

```
C1 docs ─► C2 deploy ─► C2.1 sweeps ─► C3 rename
   (done)     (done)                     │
                                              ▼
                          C4.1 waitlists ──► C4.2 courses ──► C5 refunds
                                              │
                                              ▼
                                     C4.3 floor ──► C4.4 credits/packs
                                              │
                                              ▼
                                    C6 WP plugin ──► C7 exit gate
```

Roughly three weeks of build. C1 and C2 are same-day. The critical path runs
through C4.

Phase 3 — public API + webhooks, Outlook/Apple calendar, reporting, gift cards,
memberships, second vertical — starts after C7 passes, not before.
