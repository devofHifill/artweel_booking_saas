# Phase B — implementation plan

Rebuilding the studio dashboard against the TourFlow prototype: its dashboard,
its sidebar, and an Artweel screen behind every one of its thirteen nav items.

Written 2026-08-20, after Phase A shipped. Ordered so each step de-risks the
next, and so a failure tells you which thing broke.

---

## Where this came from

`server/demos/tourflow/` is a complete front-end prototype of a FareHarbor-style
booking SaaS, built 2026-08-19. It has no backend — every number on screen is
derived from a JavaScript object in the tab. What it does have is a worked-out
answer to "what should an operator's dashboard show", and that answer is the
specification this phase implements.

Nothing is ported. TourFlow is 8,200 lines of vanilla JS building HTML with
string concatenation; this codebase is React and TypeScript. Every screen is
re-implemented, against real data, with real tenant scoping.

---

## The three constraints everything hangs off

**1 — Aggregates are built once, not twice.**

Six of the dashboard's nine blocks need the same aggregates Reports needs:
revenue by day, popular services, booking sources, capacity. Building the
dashboard first and Reports later would produce two implementations of "revenue
in a date range" that drift, and the drift would show up as two screens quoting
different numbers for the same week — the single fastest way to lose an owner's
trust in the product.

So B0 is an aggregate module with no UI at all, and both screens read from it.
The visible consequence is that Reports drops from the largest item in the
original plan to one of the smaller ones.

**2 — The domain stays ceramics; only the labels are TourFlow's.**

Three nav items carry TourFlow's wording by explicit decision (2026-08-20):
*Activities*, *Staff & Guides*, *Daily Manifest*. The routes underneath do not
change — `/classes`, `/staff`, `/register` — so links and bookmarks survive and
the code keeps calling things what the schema calls them.

Tour concepts themselves are NOT imported. No departures, no guides-as-a-role,
no waivers. Artweel's equivalents already exist under ceramics names, and
doubling them would blur the vertical the product deliberately picked. Where a
TourFlow dashboard block depends on a concept that does not exist here, it is
substituted rather than faked — see B1.

**3 — Every phase ends verified in a browser, not only in tests.**

Phase 2 closeout found two bugs the green suite structurally could not catch:
six policy columns with readers and no writers, and a credits panel that could
show a credit with no way to redeem it. Tests set up the state they need and
never ask whether a user could reach it. So each phase below ends with `npm
test` green AND a pass through the real UI, and each asks explicitly: can the
owner reach this?

---

## The sidebar

| Group | Items |
| --- | --- |
| **OPERATIONS** | Dashboard · Bookings · Calendar · Activities · Customers · Staff & Guides · Payments · Reports · Daily Manifest |
| **STUDIO** | Courses · Packs · Studio floor |
| **GROWTH & SETUP** | Notifications · Integrations · Website & Widget · Settings · Plan |

TourFlow's thirteen items in TourFlow's order and grouping, plus four screens it
has no equivalent for. Those four are real Artweel features — multi-week
courses, class packs, pieces through the firing cycle, and billing — and they
get their own group rather than being scattered through the other two.

`Today` is gone. See B1.

---

## Phase map

Status as of 2026-08-20.

| | | Ships | Status |
| --- | --- | --- | --- |
| **B0** | Analytics core | nothing visible | **DONE** — 22 tests |
| **B1** | Dashboard + sidebar | the whole landing page | **DONE** — 11 tests, `Today.tsx` deleted |
| **B2** | Staff & Guides | UI over existing CRUD | **DONE** — 7 tests, delete guard fixed |
| **B3** | Payments | list and totals | **DONE** — 10 tests |
| **B4** | Settings | the rest of the sections | **DONE** — no new server code |
| **B5** | Notifications | templates, log, retry | **DONE** — 6 tests, retry added |
| **B6** | Integrations | one status surface | **DONE** — 12 tests |
| **B7** | Reports | six tabs over B0 | **DONE** — 11 tests, 3 aggregates added |
| **B8** | Website & Widget | storefront + embed | **DONE** — 9 tests, 1 migration |
| **B9** | Daily Manifest | the sheet an instructor carries | **DONE** — 20 tests, no migration |

**Suite: 54 files, 772 tests, all passing** as of B9 — B8 adds
`tests/admin/website.test.ts` (10) plus three cases to the embed suite, B9 adds
`tests/admin/manifest.test.ts` (20).

Both phases were verified in a browser on 2026-08-24, per constraint 3:
`20260824120000_storefront_copy` applied clean to an empty database; copy saved
on Website & Widget reached `/public/clay-and-co` (tagline, both about
paragraphs, `mailto:` contact) while the untouched SEO title correctly kept its
fallback; the widget snippet and its `?embed=1` preview frame render; check-in
on the manifest saved and moved the day's figure from 0/3 to 3/3;
send-to-instructor queued a row that the worker then delivered to the staff
address with the FIRST VISIT flag and the paid-in-full line intact.

### Two things that changed under the plan as it was written

**B3 ships no refund button.** The existing refund endpoint applies the studio's
CANCELLATION POLICY, so for a late cancellation it may refund nothing and grant a
credit instead. That is correct inside the cancellation flow and misleading on a
screen where "Refund" reads as "give this money back". A refund of an arbitrary
amount is a separate feature needing its own amount field and provider call;
it moves to Phase C.

**B4 ships cancellation read-only.** The refund ladder needs reordering,
validation and a preview of what a given notice period pays out. Half-building
that against the one setting that decides who gets their money back is worse than
not building it. The screen makes the current rules visible — which they have
never been outside the database — and says editing is not built yet.

### Found and fixed along the way

**A latent delete bug (B2).** `deleteStaff` counted only `booking.staffId`, which
is set for appointments. A group class hangs off a session, and
`Session.staff` is `onDelete: SetNull` — so an instructor who had only ever
taught group classes could be hard-deleted, and every class they ever taught
silently lost its instructor, past ones included. Nothing in the product could
reach the delete path until the Staff page shipped a Remove button.

**A third copy of the money rule (B9).** `paidCents` in `dashboard.service` was
a hand-copied duplicate of `net` + `MONEY_IN_STATUSES` in `analytics.service`,
and `outstandingCents` in `booking.admin.service` a third. Identical on the day
they were written, and exactly the drift constraint 1 exists to prevent — the
manifest needed a fourth, so the rule was extracted as
`analytics.paidCentsOf` and the dashboard now aliases it. Nothing behavioural
changed; the point is that the next change to what counts as money received
happens once.

**A test-isolation bug (B2/B3).** `tests/auth/rate-limit.test.ts` lowers the auth
budgets deliberately, and `src/config` validates the environment once at import
time — so the low limits froze into config for every file that ran afterwards.
Invisible until file order changed; adding Phase B test files moved
`staff-delete` behind it and it failed with 429s while passing alone. Fixed in
`tests/helpers/api.ts` so no future file has to know.

---

Roughly fourteen sessions. Ordered cheapest-server-work-first after B0 and B1,
which are the two that unblock everything else.

---

## B0 — Analytics core

*Server only. Nothing ships to a screen.*

A new `analytics` module holding every aggregate the dashboard and Reports both
need:

- revenue by day over a range — successful payments, minus refunds
- day figures for a date — bookings, revenue, seats booked, seats left
- popular services over N days — bookings, guests, revenue, ranked
- booking sources over N days
- capacity for a date
- sessions with no instructor assigned, in a range

Three things these must get right, all of which have bitten this codebase
before:

**The studio's day, not UTC's.** `getToday` already resolves the day boundary
through the organization's timezone with Luxon. Every aggregate here does the
same. A revenue figure that rolls over at midnight UTC is wrong for every studio
in America.

**Refunds subtracted, not ignored.** `outstandingCents` in
`booking.admin.service` already filters on `SUCCEEDED | PARTIALLY_REFUNDED` and
subtracts `refundedCents`. Anything counting money here uses the same rule, or
the dashboard and the payments screen will disagree.

**Tenant scoping on every query, asserted.** These are the first queries in the
product that aggregate across a whole table rather than reading one row, which
makes a missing `organizationId` a cross-tenant leak rather than a 404. Each
gets a test that plants a row in another studio and proves it does not appear.

### Logged debt — an index this phase does not add

Revenue is attributed by `payments.succeeded_at`, because that is when the money
landed; `created_at` is when the checkout session opened and can be the previous
day. The only index on the table is `(organization_id, created_at)`, so the
revenue queries filter on an unindexed column.

Free at staging volume and for a long time after — a studio's payments are
hundreds of rows, not millions — so this is deliberately not fixed here. When it
does matter, the fix is `(organization_id, succeeded_at)` built
`CREATE INDEX CONCURRENTLY` in its own migration, for the reason DEPLOY.md
already gives: a plain `CREATE INDEX` on `payments` locks out writes while it
builds, and Prisma will not generate the concurrent form.

---

## B1 — Dashboard, and the sidebar

**`client/src/pages/Today.tsx` is deleted.** TourFlow has no separate Today —
the dashboard *is* the landing page. Its work is not thrown away: the session
grouping and next-up indicator become the "Today's schedule" panel, and its
three alert banners become the "Needs attention" card. Onboarding still
intercepts `/` for a studio that has not published.

Server: one `GET /dashboard` composing B0's aggregates with today's schedule,
recent bookings and the attention list. One request, because nine blocks
fetching separately is nine chances to render a half-built page.

Client: the nine blocks. KPI tiles with trend against yesterday, today's
schedule with capacity bars, a seven-day revenue chart, recent bookings, top
five activities, needs attention, instructors on duty, and a source donut.
Charts are hand-drawn CSS and inline SVG — the same choice TourFlow made, for
the same reason: a charting library is 90KB to draw nine bars.

**One block cannot be built as specified.** TourFlow's attention list includes
"guests have not signed a waiver". Waivers do not exist in Artweel. Substituted,
by decision 2026-08-20, with two conditions that do: **sessions with no
instructor assigned** and **pieces past their pickup hold**. Both are real, both
are actionable, and both are already in the schema.

**One block ships thin.** The source donut reads `booking.source`, which is a
real column with real values — but the embed widget posts through the same
public route as the booking page, so both write `web`. Until B8 gives the widget
its own source, the donut has two slices. Stated on the screen rather than
quietly rendered as though it were the whole picture.

---

## B2 — Staff & Guides

The server module is complete: create, update, deactivate, list. There is no
page. This is the smallest gap in the product — a whole workstream that ships
and is unreachable — and it is first after the dashboard for that reason.

Client only: list, create and edit, roles, working hours, and who is teaching
today.

---

## B3 — Payments

The payments module handles Stripe Connect, checkout and webhooks. What it has
no read surface for is "show me the money": a studio can take payments and
cannot list them.

Server: list and detail endpoints, filtered by date, status and customer.
Client: the table, a refund action, and the balance owed per booking.

---

## B4 — Settings

The Appearance section shipped in A3. This adds the section navigation around
it and the rest of the panels: studio profile, cancellation policies, piece hold
days, make-up credit rules.

Worth stating because the earlier plan had it wrong: **the policy column writers
already exist.** `organizationRouter.patch('/:organizationId')` accepts
`makeUpCreditsEnabled` and its five siblings today. What is missing is the UI
that reaches them. This phase is that UI, not the fix.

---

## B5 — Notifications

Server: template CRUD, quiet hours, the opt-out list. The module currently
exposes one route.

Client: a template editor with token help, the delivery log, and a retry for
failures — which is what turns the dashboard's "3 customers were not sent a
confirmation" alert from a statement into something an owner can act on.

TCPA rules are already enforced in the outbox and are not re-litigated here:
opt-out beats consent, quiet hours apply to reminders and never to
confirmations.

---

## B6 — Integrations

One status endpoint across Stripe Connect, Google Calendar, Twilio and the
worker heartbeats, and a page of connect/disconnect cards over it.

Cheap because every integration already reports its own state — `stripeChargesEnabled`,
`CalendarConnection.status`, `worker_heartbeats`. Nothing new is stored; this
puts four existing truths on one screen.

---

## B7 — Reports

Six tabs — Overview, Revenue, Bookings, Activities, Customers, Staff — plus CSV
export.

Small, because B0 did the work. In the original plan this was the largest item
in the phase and estimated at three sessions; moving the aggregates to the front
turned it into presentation.

---

## B8 — Website & Widget

Branding, page copy, SEO fields, and the widget builder with its embed snippet.
Branding reuses the `brand_preset` / `brand_accent` columns from A1 rather than
inventing a second theming mechanism.

Also gives the embed widget its own booking source, which is what fills out the
dashboard donut. That is why this sits after the dashboard rather than before
it: the dashboard states the limitation, and this removes it.

### As shipped

Six nullable columns in one migration — `tagline`, `about`, `contact_email`,
`contact_phone`, `seo_title`, `seo_description` — behind `GET/PATCH /page`,
with CHECK bounds mirroring the zod ones. Every field has a fallback in
`renderBookingPage`, so an untouched studio still gets exactly the page it had
before.

**Branding is a link, not a second picker.** The screen sends the owner to
Settings → Appearance rather than rendering its own swatches. Two colour
pickers writing one column is the shape of thing that drifts, and the accent
belongs next to the Light/Dark toggle it is constantly confused with.

**The donut caveat is gone.** `sourcesCaveat` is now `null` rather than
deleted, so a stale client renders nothing instead of crashing on a missing
key. The widget posts `source: 'embed'`, whitelisted at the route — free-form
would let any caller invent a channel and appear as a slice nobody recognises.

---

## B9 — Daily Manifest

Upgrades the Register screen into the sheet an instructor actually carries: a
printable roll, balances owed, send-to-instructor, and check-in.

Last because it is the only phase whose value depends on a studio running real
classes, which is also the Phase 2 gate that is still open.

### As shipped

`GET /manifest?date=` composes the whole day in one request, and three things
go on the sheet that the register could not show:

**Appointments.** They hang off a staff member rather than a session, so a
studio whose Tuesday is four private lessons opened the register to an empty
page. The dashboard already learned this in B1; repeating the omission on the
sheet somebody carries would have been worse.

**Balances.** The question a front desk is actually asked at the door. The rule
comes from `analytics.paidCentsOf`, extracted in this phase from the copy that
had grown inside `dashboard.service` — constraint 1 applied to money already
loaded in memory, so the sheet cannot disagree with Payments about a booking.

**First visits.** One grouped query for the day, not a count per booking. The
flag is per-DAY rather than per-session on purpose: somebody booked into a 10am
and a 2pm is new at both.

**The batch stayed the class.** Marks are still held locally and posted once
per class, which is the register's hard-won rule — a whole-day Save would be
wrong, because you check the 10am in at 10am.

**Send-to-instructor writes to the outbox**, like everything else that leaves
the building, and renders its own plain-text body rather than going through the
studio's notification templates: those are customer messages in a studio's
voice, and an owner editing them must not be able to break the operational
sheet their staff work from. The dedupe key carries the MINUTE of the request —
a fixed key on the date would silently refuse the corrected sheet after an
11am cancellation, which is the worse of the two failures.

**Print is a real deliverable.** The one screen in the product whose output is
paper, so it has a real `@media print` block: the shell is stripped, the dark
theme is forced back to black on white, classes are `break-inside: avoid`, and
each row gets a tick box — because the studio wifi does not reach the kiln
room.

---

## Phase C — deferred, each needing its own decision

**Deposits and partial payment.** Artweel charges in full. TourFlow does not,
and two dashboard blocks are thinner for it: the "Pending Payments" KPI and the
"balance owing" attention row both collapse toward "unpaid or paid". This is the
one in this list worth arguing for.

**Waivers.** Would restore the attention row B1 substitutes.

**Per-session staff assignment.** Sessions carry a `staffId` today; assigning
per-occurrence rather than per-series is a scheduling change, not a UI one.

---

## Decisions already taken

- **2026-08-20 — the dashboard replaces Today completely.** Not alongside it.
  `Today.tsx` is deleted and there is no Today nav row.
- **2026-08-20 — TourFlow's labels win** for Activities, Staff & Guides and
  Daily Manifest. Routes unchanged.
- **2026-08-20 — the four ceramics-only screens are kept**, grouped under
  STUDIO.
- **2026-08-19 — layout only, not TourFlow's palette.** Phase A shipped a
  per-studio accent instead, over the shared design tokens; `Indigo` is one of
  the six presets, so TourFlow's exact colour is one click away without forking
  the token system.

## Assumptions carried, unless contradicted

- The dashboard's "New booking" action points at the existing manual-booking
  flow rather than a new one.
- Trend figures compare against the previous day, matching TourFlow.
- The attention list substitutions in B1 stand.

---

## What Phase A left behind

Complete as of 2026-08-20 and verified in a browser: per-studio theming
(`lib/brand.ts`, six AA-checked presets, derived custom accents, applied to
dashboard, booking page and widget), the Settings → Appearance screen, the app
chrome (`/shell/summary` and `/shell/search`, global search with `/`, alert
bell, badge counts, mobile bottom nav), and layout primitives
(`components/layout.tsx`) rolled across all twelve pages.

Two things Phase A deliberately left unfinished, both landing here:
`Tabs` in `components/layout.tsx` has no consumer until B7, and `CourseDetail`
is typechecked but never rendered in a browser because the seeded studio is on
the Solo plan and courses are plan-gated.
