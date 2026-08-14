# Phase 2 closeout plan

Everything in Phase 2 is built. Nothing in Phase 2 is *usable*. This plan closes
that gap and nothing more — no new features, no Phase 3 work. Scope is fixed the
same way Phase 2's was: adjacent requests go to Phase 3.

Ordered so that each step de-risks the next, and so a failure tells you which
thing broke.

---

## Decision gate — settle before C3

**The product name.** The repo is `artweel_booking_saas`; the code says "Studio
Bookings" in marketing titles, JSON-LD, notification sender names and package
names. This has to be decided before the dashboard pages are written, or six new
screens are born with the wrong name baked in and the rename gets bigger.

It also gets more expensive with every day staging is indexed, because
`PUBLIC_URL` is baked into the SEO output and re-indexing later is costly.

This is Suren's call. The mechanical work is C3 and takes under an hour once the
name exists.

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
kiln firings, waitlists, widget + WordPress plugin.

Carries two migrations — `..._credits_pieces_firings` and `..._waitlists` — and
one new config value, `WAITLIST_OFFER_TTL_MINUTES`, which has a default and so
needs no `.env.production` edit.

**Steps**

1. Back up the staging database before touching it. Two migrations at once on a
   live box is exactly when you want a restore point.
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

---

## C3 — the rename (1 hour, gated on the decision above)

Find-and-replace "Studio Bookings" across marketing titles, JSON-LD,
notification sender, package names. Check `PUBLIC_URL` and the sitemap. Re-run
the marketing copy test that enforces "no unshipped features" — it touches the
same files.

**Touches:** `server/src/modules/marketing/**`, notification templates,
`package.json` names, `client/index.html`

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
C1  docs             ──►  C2  deploy  ──►  C3  rename
                                              │
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
