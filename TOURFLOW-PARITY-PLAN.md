# TourFlow parity — implementation plan

---

## RESUMING HERE — state as of 2026-09-01

**Done:** D0, D1, D2, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13. **D3 is PARTIAL**
(month + week shipped; day view, side panel, block-a-date and add-slot
deliberately not built — see its section). **The thirteen are done.** What is
left of this phase is D3's remainder, which is feature work needing a design
pass rather than a parity item.

**Everything is now walked in a browser.** D12 and D13 carried that debt for a
while; it is paid. The deposit round-trip was exercised — set a percentage,
save, reopen, value came back — as were all four schedule write paths, the
"cannot be booked" empty state, and both new topbar menus.

**Since the thirteen, on 2026-09-01:**

- **The whole `/schedules` surface**, which had endpoints since W1 and no
  caller. Working hours and per-date exceptions on Staff, and `/my-schedule`
  for an instructor's own — the "or self" half of a `requireAdminOrSelf` rule
  that had reached nobody. Anyone hired after signup had been permanently
  unbookable, silently.
- **Light + indigo by default**, the topbar matched to the prototype (labelled
  booking link, help, account menu, filled avatar, 60px bar, 380px search), and
  the sidebar pinned so its foot is reachable.
- **Theme packs** — `THEME_PACK` / `VITE_THEME_PACK`, product-wide shape and
  density. Deliberately NOT per studio: the four-token studio boundary that
  `brand.test.ts` calls load-bearing is untouched, and a pack can reach no
  colour at all, so no contrast guarantee can regress by choosing one.

**Staging is behind again.** It sits at `e8824d4`; everything above is only in
git. No migrations are owed — `git diff --name-only e8824d4..HEAD --
server/prisma/migrations/` is empty — so it is a code-only deploy. If you set
`THEME_PACK`, rebuild rather than restart: Vite bakes the client's half in at
build time, and the compose file now passes it as a build arg.

**Suite: 922 tests, 59 files, green**, plus the timing gate at p95 174ms. Run
it with `npm test` from `server/`; it takes about 40 minutes, so start it
before doing anything else. **Two sessions must not share a test database** —
point the second at `booking_test_b` via `TEST_DATABASE_URL`, or both runs
truncate each other's fixtures and produce failures that look like real ones.

**Fixed dates in fixtures are a live hazard.** Five expired or were about to;
see the audit note under D12's section and commits `142e3bf`, `7798ea9`,
`4127a6f`. The rule: a past date is inert, a future date only matters if the
product compares it against real `now`, and the list of things that do is
short.

**Deployed and verified on staging** (`artweel.fillforge.cloud`): all migrations
through `default_brand_indigo`, plus the `.dockerignore` fix that keeps
`prisma/demo.ts` out of the production image. Staging carries D7–D11 and the
harness fix, at `7798ea9`. **Nothing since adds a migration**, so only code is
ever owed. Check the deployed commit after a pull — it was one behind once
today, and only the fact that the missing commit was test-only made that free.

**The demo data cannot exercise everything.** `npm run db:demo` sells classes
and nothing else — no packs, no courses, no refunds — so the payments
breakdown draws one bar and no row is ever refunded. D7 was verified by adding
a pack sale and a partial refund to Kiln House by hand; those rows are still in
the dev database and a re-seed removes them. Worth knowing before concluding a
screen is thin when it is the fixture that is.

### The working method, which is the useful part

Every item followed the same four steps, and the third is where the value was:

1. Read the demo screen (`server/demos/tourflow/js/<name>.js` + its CSS).
2. Read ours — the React page AND what the API already returns.
3. **Sort the differences into three piles** before writing code: *layout*,
   *behaviour we lack*, and **behaviour the demo fakes**. The third pile is
   large. The prototype has no backend, so it can afford instant filtering, no
   empty states, no permissions, no failure modes and no tenant scoping.
   Matching those is regression, not parity.
4. Close what is worth closing, then verify BOTH: `npm test` green and the
   screen walked in a browser.

### What that method actually caught

Four items were not styling gaps at all, and none of them would have been found
by tests:

- **D4 — a studio could not create an activity.** The client only ever READ
  `/services` while onboarding carried a required "Add a class" step. The worst
  instance of a pattern this codebase keeps hitting.
- **D7 — the payments search hid rows.** It followed `booking.customer` only,
  so a customer who had bought a class pack and taken no class came back as
  "no payments" while their purchase sat in the table.
- **D8 — the default reports chart did not lay out.** Thirty bars in a grid
  hard-coded to seven columns wrapped into five rows, in the range the screen
  opens on.
- **D9 — the manifest never said where to go.** `Staff.phone`,
  `location.address` and `booking.serviceAddress` were all stored, and two of
  the three were already on the wire with no reader.
- **D11 — a studio could not connect a calendar.** The whole OAuth flow from
  W1.6, five endpoints, and no button anywhere in the client. The largest
  single omission the phase has turned up.
- **The sidebar was not role-aware** (found during S13), because until
  invitations shipped every account was an OWNER.
- **Three support-session client bugs** (found during S8's browser pass).
- **Demo studios landed on the setup wizard**, because `complete` is derived
  from `onboardingDoneAt` and the script never set it.

### Traps worth not rediscovering

- **Do not edit `src/` or run `psql` while the suite is running.** Doing so
  once produced 16 failures that never reproduced.
- **Two dark blocks exist** in `styles.css` — `@media (prefers-color-scheme)`
  AND `:root[data-theme="dark"]`. Change both or the theme toggle disagrees
  with the OS setting.
- **`styles.css` is mirrored** from `server/src/lib/design-tokens.ts` and
  `tests/design/tokens.test.ts` fails if they disagree. Dashboard-only values
  go in `DASHBOARD_COLOR_TOKENS`.
- **Stale Vite HMR** after editing CSS reports wrong computed styles. Hard
  reload before believing a measurement.
- **`localhost` in `DATABASE_URL` is a trap on this machine.** Docker's IPv6
  proxy can accept on `::1:15432` and forward nothing, and a half-working
  proxy shows up as a FAILED ASSERTION in the concurrency gate rather than as
  a connection error. Use `127.0.0.1`; `.env.example` explains why.
- **The sidebar clips popovers, and that is `overflow` doing its job.** It is
  `position: sticky` with `overflow-y: auto` so its foot — help, who is signed
  in, the theme control — stays reachable without scrolling to the bottom of a
  2,600px page. The cost is that any absolutely-positioned child is clipped to
  its box: a `bell-panel` opened from a sidebar button appears as a sliver and
  looks like a CSS mistake. Nothing in there needs one today — every row is a
  link, and `ThemeToggle` cycles rather than opening. If something ever does,
  the answer is a fixed-position portal, not removing the scroll. Cost half an
  hour on 2026-09-01, which ended with sidebar help becoming `/help` instead —
  a better answer for its own reasons, arrived at from this one.
- **Do not leave the dev API server running during a full suite.** It polls
  Postgres continuously, and the browser-verification clicking adds more, on
  the same container the tests use. Both failures seen in this phase were in
  `tests/gate/` — the only tests that fire twenty simultaneous requests and
  assert an exact outcome — and both passed alone afterwards. D11's read as a
  raw `PrismaClientKnownRequestError` where the gate expects the app's own
  `COURSE_FULL`, which is what a transaction aborted under contention looks
  like from outside. Stop the preview servers, then judge the gate.
- **Extract, do not duplicate.** `Kpi`, `PaymentPill` and `paymentState` moved
  to `components/layout.tsx` when a second screen wanted them. A near-miss with
  `.card-head` vs the existing `.panel-head` is recorded under D0/D1.

### Local demo data

`npm run db:demo` — five studios, four timezones, two currencies, ~380
bookings spanning two weeks back and three forward. Owners are
`owner@clayandco.test`, `owner@kilnhouse.test`, `owner@wildflower.test`,
`owner@throwingroom.test`, `owner@terrastudio.test`; password
`kiln-shelf-glaze-42`. It refuses to run against anything but `booking_dev` or
`booking_test`.

---

Making the operator dashboard look and behave like `server/demos/tourflow`,
one sidebar item at a time.

Written 2026-08-24, after Phase B and superadmin Stage 2 shipped.

---

## What this is, and what it is not

Phase B rebuilt every screen against TourFlow's **layout** and stopped there,
by explicit decision: *"layout only, not TourFlow's palette"* (2026-08-19). This
phase reverses that decision and goes the rest of the way — the palette, the
component finish, and a screen-by-screen reconciliation against the demo.

**It is mostly a fidelity pass, not construction.** Twelve of the thirteen
screens already exist against real data with real tenant scoping. The work per
item is: open the demo screen, open ours, list what differs, close the gap.
Some items will be nearly nothing. A few are real.

---

## Decisions taken 2026-08-24

- **The four ceramics screens stay, hidden.** Courses, Packs, Studio floor and
  Plan are removed from the sidebar so the nav matches the demo's thirteen —
  but the routes, screens and server modules remain. TourFlow has no equivalent
  because TourFlow sells tours and tours have no kilns; that is a fact about
  the demo, not a verdict on the features. Reversible in one line.
- **Pixel-match, not approximate.** Port the demo's spacing, shadows, radii and
  component shapes, not only its brand colour.
- **The studio colour stays changeable.** The demo's indigo becomes the
  DEFAULT; Settings → Appearance keeps working. See constraint 2.

---

## The three constraints everything hangs off

### 1 — The demo has no dark mode. This product does.

`css/style.css` has no `prefers-color-scheme`, no `[data-theme]`, no dark
palette anywhere. It is a light-only design.

Artweel has a full dark theme, six AA-checked brand presets, and
`tests/design/tokens.test.ts` asserting contrast ratios. Pixel-matching a
light-only design means choosing:

**SETTLED 2026-08-24: dark mode stays.**

An earlier draft of this section called that "real work" and weighed it against
dropping dark mode entirely. That was wrong, and the correction is worth
recording because it inverted the decision.

Light and dark are **separate blocks** in `styles.css`: `:root` carries the
light palette, and `@media (prefers-color-scheme: dark)` overrides only the
tokens that must change. Porting TourFlow's palette therefore rewrites the
`:root` block and leaves the dark block alone. Dark mode survives at close to
zero cost.

There is also nothing to match it against — the demo never implemented one — so
"pixel-match" makes no claim on it either way.

The one real adjustment: the dark palette is warm-tinted (`#15181c`, `#1c2026`)
to sit with the warm light theme. If light moves to cool slate, dark should
move cool too or the two schemes will read as different products. About six
values.

### 2 — Per-studio branding must survive the port.

A1 shipped six brand presets that move `--clay`, `--clay-dk`, `--clay-lt` and
`--clay-text` and nothing else — deliberately, so no studio can make its own
dashboard unreadable. The demo hardcodes `--brand-600` in about forty places.

A literal port would freeze every studio on indigo and silently break the
Appearance screen, the six presets, the custom-accent derivation and
`lib/brand.ts` on both ends. So the port maps TourFlow's brand ramp ONTO the
existing accent tokens rather than replacing them:

```
--brand-600  →  --clay        (the accent itself)
--brand-700  →  --clay-dk     (hover/pressed)
--brand-50   →  --clay-lt     (tinted panels)
--brand-700  →  --clay-text   (accent text on light)
```

Which works because the `indigo` preset already carries those exact four
values — `#4f46e5`, `#3730a3`, `#eef2ff`, `#4338ca`. Whoever built that preset
derived it from this demo. Changing the default preset from `clay` to `indigo`
is therefore the entire brand change.

TourFlow's ramp has eight steps and the accent system has four. The four
unmapped steps (`--brand-100/200/300/400/500`) are used for borders, focus
rings and gradients; each needs deciding individually at D0 — derived from the
accent, or dropped.

### 3 — The public surfaces share these tokens.

`styles.css` is the dashboard. The **booking page** and the **marketing site**
render from their own TS modules on the server, and the booking page reads the
studio's accent through `resolveBrand`. Changing structural tokens repaints
what customers see, not only what operators see.

**SETTLED 2026-08-24: the dashboard moves, the other two do not.**

The **booking page** keeps its warm palette. TourFlow's cool slate is a B2B
dashboard aesthetic and a booking page is a pottery studio's storefront;
dressing a storefront as an admin panel serves nobody. Its accent already
follows whatever the studio picked, so it turns indigo by default anyway —
which is the part that was actually asked for.

The **marketing site** keeps its own identity. It has its own landing renderer,
and it is the surface that sells the product; matching it to an internal
prototype has no upside.

---

## Stage map

| | | Ships | Status |
|---|---|---|---|
| **D0** | Design system port | every screen changes | **DONE** — 854 tests, 1 migration |
| **D1** | Dashboard | | **DONE** — no server change |
| **D2** | Bookings | status counts | **DONE** — 4 tests, no migration |
| **D3** | Calendar | month view | **PARTIAL** — see below |
| **D4** | Activities | **the catalogue editor** | **DONE** — closed a blocking gap |
| **D5** | Customers | spend, last visit, sort | **DONE** — 3 tests |
| **D6** | Staff & Guides | rota summary | **DONE** — 3 tests |
| **D7** | Payments | detail, tabs, breakdown | **DONE** — 19 tests, no migration |
| **D8** | Reports | 5 aggregates, charts extracted | **DONE** — 15 tests, no migration |
| **D9** | Daily Manifest | phone, address, doorstep | **DONE** — 7 tests, no migration |
| **D10** | Notifications | figures, tabs, tokens, test send | **DONE** — 14 tests, no migration |
| **D11** | Integrations | the calendar buttons | **DONE** — 4 tests, no migration |
| **D12** | Website & Widget | the link, and `data-height` | **DONE** — not yet walked in a browser |
| **D13** | Settings | **four writer-less columns** | **DONE** — not yet walked in a browser |

D0 first and alone, because every item after it is judged against the finished
token set. Doing a screen before the tokens land means doing it twice.

The thirteen after that are in the demo's own sidebar order, which is also
roughly how often an operator opens them.

---

## D0 — the design system port

The only item that is not a screen, and the one the other thirteen depend on.

**What moves:** the token block (`:root`, ~50 custom properties), elevation,
radii, spacing scale, and the shared component shapes — buttons, cards, inputs,
badges, chips, tables, the sidebar, the topbar.

**What does not move:** anything that would break constraint 2. The accent stays
a variable.

**How it is verified:** `tests/design/tokens.test.ts` and
`tests/design/brand.test.ts` already assert contrast on every preset in both
schemes. They must stay green — which is the real gate on this item, because a
palette port is exactly the change that quietly fails AA somewhere.

**Deliverable:** a screenshot of one screen before and after, and a green
`npm test`.

---

## D1–D13 — the per-screen shape

Each item is the same four steps, and each ends the same way:

1. **Read the demo screen.** `js/<name>.js` plus its slice of `style.css`.
2. **Read ours.** The React page, and what the API already returns for it.
3. **Write down the differences** — in the plan, under that item, before
   writing code. Three categories: *layout*, *behaviour we lack*, and
   *behaviour the demo fakes* (it has no backend; several screens do things no
   real system can, and those are not gaps).
4. **Close the ones worth closing**, then verify: `npm test` green AND the
   screen walked in a browser.

That third category is the one that will save the most time. The demo derives
every number from a JavaScript object in the tab — so it can afford instant
filtering, no empty states, no permissions, no failure modes, and no tenant
scoping. Matching those is not parity, it is regression.

### D0 and D1 — as shipped, 2026-08-24

**D0 was reported complete once before it was.** The tokens and the sidebar
landed first and were called done; the shared component shapes — cards,
buttons, KPI tiles — are also D0 and had not been touched. They belong there
rather than in D1 because they serve all thirteen screens, and doing them per
screen would have meant porting the same rules thirteen times.

**The token file needed a per-surface layer.** `design-tokens.ts` feeds all
four surfaces and a test enforces the mirror, so moving the dashboard's greys
would have repainted the booking page and the marketing site — contradicting
constraint 3. `DASHBOARD_COLOR_TOKENS` now carries the nine that diverge, and a
new test asserts the public surfaces stayed warm, so the divergence cannot be
quietly undone by someone consolidating them later.

**The radius scale was half a step out.** `--radius-sm` was 8px against the
prototype's 6px and there was no `--radius-md` at all. Nobody names a
difference that size; what they feel is cards reading boxier and controls
rounder than the design they were copied from.

**Two things deliberately NOT copied.** The prototype colours a falling trend
red — this product keeps it muted, because a quiet Tuesday is a fact and not
an alarm, and there was already a comment here making that case. And the
prototype's schedule rows have a hover state and a pointer cursor because they
open a drawer; ours do not open anything yet, so they got the spacing and not
the affordance. Styling something as interactive when it is not is a worse lie
than a plain row.

**A near miss worth recording.** The demo's `.card-head` / `.card-body` was
ported before noticing this codebase already has `.panel-head` / `.panel-body`
doing exactly that job. Two names for one component would have left the next
person working out which screens use which. The names were dropped and the
prototype's VALUES ported onto the existing rules instead — which is the
general rule for the rest of this phase.

### D2 — as shipped, 2026-08-24

The prototype's largest screen, and the gap was smaller than predicted: the
list API already returned every field its table shows.

**Status tabs replaced a status dropdown.** The counts are the whole point —
"Pending 3" tells an owner there is something to do before they have clicked
anything, and a `<select>` cannot say that. One new server field, a `groupBy`
on the existing filters.

**The counts ignore the status filter and nothing else.** Counting under the
status filter would make the row read "Pending 1, Confirmed 0" while showing
the one pending booking — every other number collapsing the moment you click.
Counting without the OTHER filters would describe a different list from the one
on screen. Both directions are tested.

**A blank is not a zero.** First cut rendered a pill only where the server
returned a count, so statuses with no rows had no pill at all — which reads as
"unknown" rather than "none". Caught in the browser, not by a test.

**Three things deliberately not ported:**

- **Numbered pagination.** The prototype knows its total because it holds every
  booking in an array; this list is cursor-paginated so a studio scrolling a
  busy month does not see rows repeat. A cursor cannot know which page it is
  on, so the footer states a count instead of faking page buttons.
- **Export CSV.** The demo's button raises a toast reading "in production this
  streams a CSV". Reports already has real CSV export; adding it here is a
  feature, not a styling gap.
- **Reseller sources** (Viator, Tripadvisor). Those integrations do not exist
  and a filter for them would list two options that can never match anything.

**`PaymentPill` moved to `components/layout`.** It lived in `Dashboard.tsx`
until Bookings needed the same column; two copies of "is this paid" is how two
screens end up disagreeing about one booking.

### D3 — PARTIAL, 2026-08-24

The largest genuine gap so far, and the first item not finished in one pass.
What shipped is the half that matters most; what did not is listed so it is a
decision rather than an oversight.

**Shipped:** a month grid, and the view switcher the prototype opens on. The
navigation moved into the card head with the grid it acts on — putting period
controls up beside the page title leaves the two looking unrelated, which is
right here for reasons that have nothing to do with matching a demo. Prev/next
step by month or by week depending on the current view, and clicking a day in
the month jumps to the week containing it, which is where anything can actually
be changed.

**Month reads SESSIONS, not bookings.** The question a month grid answers is
"what is running and how full is it", and only a session knows its capacity. A
month of bookings could say how many people are coming and never how many seats
there were. It also loads the whole visible GRID rather than the calendar
month — the grid spills into both neighbours, and loading only the month leaves
those cells wrongly empty.

**NOT shipped, deliberately:**

- **Day view.** It is the week grid with one column. Real, but the least-used
  of the three and no new information.
- **The selected-day side panel.** The Daily Manifest already does this
  properly — appointments, balances owed, first-visit flags — and a thinner
  copy of it inside the calendar would be a second answer to one question.
- **Block a date** and **Add time slot** from the calendar. Both are features,
  not styling: the schedule module has the endpoints, but a creation flow needs
  its own design pass rather than being wedged into a parity item.

**Week view keeps drag-to-reschedule**, which the prototype does not have. Ours
is ahead here and was not flattened to match.

**The segmented control was restyled product-wide.** It was a row of
accent-filled buttons; it is now a raised pill on a sunken track. That also
changes the Light/Dark/System control on Settings → Appearance, which is the
same component and should look the same.

### D4 — the one that was not a styling gap, 2026-08-24

**A studio could not create an activity.** The client only ever READ
`/services`. Eleven service endpoints existed — create, update, delete,
categories, staff assignment — and no screen called any of the writes.

Onboarding carries a REQUIRED step, "Add a class", that completes when
`services > 0`. A studio signing up met a mandatory setup step with nowhere to
do it, and the step could never be ticked. The seeded studio only has
activities because the seed script writes them directly, which is exactly why
nobody noticed.

Same shape as the writer-less policy columns, the ungrantable roles and the
unreachable Staff page — and the worst of them: a booking product where you
cannot say what you sell.

**The form asks SIX questions of a schema with twenty.** Name, description,
type, length, places, price; the server defaults the rest. Padding, notice
windows, deposit terms and staff preference are all real and all editable
later, and none of them belongs between a new studio and its first bookable
class. Capacity disappears entirely for one-to-one, because `capacityMax === 1`
is a rule the server enforces rather than a convention.

### D5 — as shipped, 2026-08-24

Spend, last visit and four sorts on the customer list, plus the figure row.

**Spend goes through `paidCentsOf`.** Aggregating it in SQL would have been a
second definition of "what they paid" that drifts from the dashboard the first
time refund handling changes. The cost is bounded — the list caps at 200 and a
studio's payments are hundreds of rows — and if that stops being true the fix
is a rollup, not a cleverer query.

**A future booking is not a last visit.** Letting one win would sort somebody
who booked ahead above somebody who was actually here yesterday, under a column
headed "last visit". Tested.

**The figure tiles describe the LIST, not the studio.** They are computed from
the rows on screen, so narrowing the search narrows them with it. A separate
endpoint would report the whole studio and sit contradicting the table beneath
it.

**Sorting happens in JS, not SQL** — two of the four keys are derived after the
query, and splitting them would make `limit` mean something different depending
on which sort was chosen.

**A fourth copy of the money rule, removed.** `toListItem` in
`booking.admin.service` still had its own hand-rolled successful-minus-refunded
filter. It now calls `paidCentsOf` like everything else.

**Not ported: Add Customer.** The prototype has one; here customers are created
by taking a booking, and a customer with no booking is an empty record. The
server has no create endpoint either, so this would be a new feature rather
than a wiring gap — unlike D4, where the endpoint was sitting there unused.

### D7 — the differences, 2026-08-25

Written before the code, per step 3. The demo's `payments.js` is 236 lines
against our 237, which is the first item where the two screens are the same
size — and the overlap is smaller than that suggests, because half of what the
prototype shows is money movement this product does not have.

**Layout — close it.**

- A range segmented control (7 / 30 / 90 / All time) in the page head. Ours
  opens with two raw date pickers, which is a more capable control answering a
  question nobody asks first: the opening question is "this month", not "the
  3rd to the 19th". The dates stay, behind a `Custom` segment.
- The figure row goes through `Kpi` — icons, tones, a footnote under each —
  like Dashboard, Customers and Staff already do. `Stat` here was the last
  screen not carrying the D0 tile.
- The filters move INSIDE the card with a count in its head and a footer line
  under the rows, which is D2's arrangement and for D2's reason.
- Table finish: a transaction reference in mono, refunded amounts in the bad
  colour, initials avatar beside the customer.
- An aside beside the table. The prototype puts two cards there; see below for
  what goes in ours.

**Behaviour we lack — close it.**

- **Status tabs with counts.** The same argument as D2, unchanged: a
  `<select>` cannot say "Failed 2", and a failed payment is the one row on this
  screen somebody has to act on.
- **A transaction detail.** `failureReason`, the Stripe payment-intent
  reference and the `Refund` rows are all recorded and none of them can be
  seen anywhere in the product. "Why did this card decline" and "what is this
  charge in my Stripe dashboard" are the two reasons anybody opens a
  transaction, and today the answer to both is a database query.
- **The "For" column is wrong on anything that is not a booking.** It falls
  back to `kind`, which is `FULL` for essentially every row, so a class pack
  purchase reads "full". The real subject is which of the four foreign keys is
  set — booking, enrolment, pack purchase, or a hold that never became one.
- **Export.** A reconciliation CSV is the one export request that comes from
  outside the studio — an accountant asks for it — which is why it is here and
  was declined on Bookings.

**What the demo fakes — do not port.**

- **Payment methods.** PayPal, Cash, Bank Transfer, and a "by method"
  breakdown over them. Every payment here is a Stripe card charge, so that
  chart is one bar at 100% forever. The aside gets a breakdown by SUBJECT
  instead — classes, courses, packs — which is real, varies, and answers the
  question an owner actually has about where the money comes from.
- **The payout schedule.** `gross * 0.31` for the next payout, `gross * 0.029`
  for fees. The prototype prints its own disclaimer under it. Real payout data
  means a Stripe balance/payout call this product does not make, and Connect
  status already has a home on Integrations — so this is a feature with an
  owner, not a styling gap.
- **Refunds as separate negative rows.** Ours are a `refundedCents` column plus
  a `Refund` ledger hanging off the payment, which is what lets one charge be
  partly refunded twice. The demo's KPI counts negative rows; ours counts
  refunded money.
- **A refund button with a free amount field.** Deferred in B3 with a written
  reason, and nothing here reopens it: the existing endpoint applies the
  studio's cancellation policy, and a screen that says "Refund" must not
  sometimes issue a credit instead. The detail links to the booking, where
  cancelling lives.
- **Instant filtering.** It holds every payment in a tab; ours filters on the
  server, debounced, and is cursor-paginated.

### D7 — as shipped, 2026-08-25

Four of the five layout items landed as written. What changed under the plan is
that three of the "close it" items turned out to be defects rather than finish,
which is now the pattern rather than the exception — D4 was the same shape.

**The search was hiding rows.** It followed `booking.customer` and nothing
else, so a customer who had bought a class pack and taken no class came back
as "no payments" while their purchase sat in the table underneath. Packs and
course enrolments both pay without a booking, and both carry a customer of
their own. An empty result reads as an answer, which is what makes a search
that hides rows worse than no search at all.

**A route ordering bug, introduced and caught in the same hour.** The new
`GET /payments/:paymentId` went in directly under `GET /payments`, which put it
ABOVE `/payments/status` — and `/:paymentId` matches `status` happily. The
Connect status endpoint that Integrations and Settings both read became a
lookup for a payment named "status", and because the id guard answers 404 the
symptom was an integrations card quietly reporting nothing rather than a crash.
There is now a test asserting the route is not shadowed, because nothing else
in a green suite would ever have noticed.

**A fifth copy of the money rule.** The dashboard summary's `outstandingCents`
had not only hand-rolled `paid = successful − refunded`, it had inlined the
status list rather than calling `paidCentsOf` — so a change to what counts as
received would have moved every figure in the product except that one. It is
now `analytics.outstandingCentsOf`, alongside a query-level `outstandingTotal`
that both the dashboard and this screen use with different WINDOWS on the same
rule. That is the point of the pair: the dashboard asks about bookings still to
come, and Payments asks with no window at all, because a class somebody
attended in March and never paid for is exactly what a figure headed "owed" is
for.

**Owed does not obey the date range, and says so on the tile.** It is returned
outside `totals` rather than beside figures that do move with the filter —
nesting it there would state something untrue about it by position alone. The
tile's footnote reads "across unpaid bookings, any date" while its three
neighbours read "in this range".

**The "For" column now names the thing.** It fell back to `kind`, which is
`FULL` on nearly every row in the product, so a class pack read "full". The
subject comes from which of the four foreign keys is set — class, course, pack,
or a checkout still in progress — and the same derivation feeds the breakdown
in the aside, from columns already on the row rather than three joins across
every payment in the range.

**The aside is one card, not two.** The breakdown replaced the prototype's "by
method" chart, for the reason given above — every payment here is a Stripe card
charge. The payout schedule was dropped rather than substituted: every figure
in the prototype's version is a multiple of gross takings under its own
disclaimer, real payout data means asking Stripe, and Stripe's own dashboard is
where a studio reconciles a payout anyway.

**The product's first modal.** `.modal` and `.modal-backdrop` have been sitting
in `styles.css` with no consumer since before Phase B; the transaction detail
is the first thing that genuinely wants one, because it is a digression from a
list somebody is scanning and they expect their filters and scroll position
back. `Modal` in `components/layout.tsx` carries Escape, the focus return to
whatever opened it, and a backdrop that only closes on a click that both starts
and ends outside the panel. It is deliberately NOT focus-trapped: a real trap
means intercepting Tab and maintaining the tabbable set as content changes, and
a half-built one either leaks focus anyway or strands it.

**Export is real, and exports what is on screen.** A reconciliation CSV is the
one export request that comes from outside the studio — an accountant asks for
it — which is why it is here and was declined on Bookings. It is built in the
browser from rows already fetched, like Reports', and the footer under the
table already states when there are more.

**Left alone, and worth knowing about.** A goodwill refund on a booking that
was NOT cancelled reads as "Still owed" in the detail's balance card, because
outstanding is `total − paid` and paid is net of refunds. That rule is the
product's, not this screen's — `getBooking` and the payment pill on Bookings
have always said the same thing — so re-deciding it on one panel would have
made two answers instead of fixing one. The studio-wide Owed tile does not
show it, because that figure only counts PENDING and CONFIRMED bookings.

**Not built, and not defended:** the refund button, unchanged from B3's
reasoning. The detail links to the customer instead, where cancelling lives.
`bookingId` is carried on the subject and currently unused by the screen: a
"View booking" button has nowhere to go, because bookings have no page of their
own, only a row in a filtered list.

### D8 — the differences, 2026-08-25

The demo's `reports.js` is 520 lines against our 560, and for once the tab
structure is identical — six tabs, same names, same order, both fetching one
window and switching client-side. The gap is entirely inside the tabs.

**Layout — close it.**

- **The daily series wants a line, not ninety bars.** The prototype draws an
  area+line in inline SVG for the revenue trend and keeps bars for its
  categorical charts, which is the right split. Our route comment already says
  a 90-bar chart "stops being readable and starts being a texture" — it was
  right, and this is the item that fixes it.
- **Figure tiles go through `Kpi`.** Reports is the last screen still on
  `Stat`. The prototype's report tiles are the same KPI shell with no icon
  chip, so `Kpi.icon` becomes optional rather than Reports keeping a second
  tile component.
- **Card heads carry a figure on the right** — "$4,733 total", "typical lead
  time 6 days". A panel head with a number in it says what the panel is about
  before the reader parses the chart.
- Avatars beside customers and instructors, and a share-of-best bar in the
  instructor revenue column.

**Behaviour we lack — close it.**

- **Overview is missing its two most useful blocks.** The prototype puts a
  status mix and a busiest-days table there; ours puts a New/Returning pair,
  which repeats what the Customers tab says. **Busiest weekday** is the one an
  owner acts on — it decides which evening gets another class.
- **Bookings per day.** The bookings tab charts nothing; it has counts by
  status and a source list. `revenueByDay` has no counterpart for bookings.
- **Occupancy per class.** Seats sold against seats OFFERED, from sessions.
  This is the number that decides whether a class stays on the timetable, it
  is ceramics-specific in a way the tours demo cannot be (a wheel is a real
  constrained seat), and nothing in the product reports it today.
- **Lead time.** How far ahead people book, which is what decides when
  enrolment should open.
- **Customer totals** — how many there are, how many came back, what the
  average one is worth — and **last booking** on the top-customers table.

**What the demo fakes — do not port.**

- **Conversion rate** in Activities. It is `40 + ((rating * 7) % 25)` — a
  number derived from a made-up rating. Measuring it for real needs
  page-view-to-booking tracking per service, which this product deliberately
  does not have (W1.9 shipped daily aggregate page views and no per-visitor
  analytics). A column of invented percentages next to real revenue is worse
  than no column.
- **Instructor ratings.** No such thing exists. Nobody is rated here.
- **"Where guests come from"** by country. `Customer` has no country and
  collecting one to draw a chart would be personal data gathered for
  decoration.
- **The Custom date range button.** Its Apply closes the modal and does
  nothing. Ours takes `days ∈ {1,7,30,90}`, validated server-side, and every
  aggregate is written against that; arbitrary from/to is a real change to
  six function signatures, not a styling gap. It gets its own decision later.
- **Weekly and monthly revenue bars.** The weekly chart is the daily data
  rebucketed, which the trend already shows; the monthly one silently ignores
  the range control and draws six months regardless — the same incoherence D7
  rejected in the payout card. Instead the daily series buckets into WEEKS at
  90 days, which fixes the readability problem the demo was working around
  without letting a chart and the control above it disagree.
- **"Export as CSV/PDF"**, which raises a toast. Ours already exports real CSV
  for the visible tab; it gains the new columns.

### D8 — as shipped, 2026-08-25

Five new aggregates, one extracted chart file, and a tab layout that finally
uses the whole of what analytics can answer. No migration.

**The 30-day chart was broken and nobody had said so.** `.chart-bars` is
`grid-template-columns: repeat(7, 1fr)` — written for the dashboard's week —
with a `dense` override for 90 days. Anything between wrapped into five rows of
seven, which is not a chart, and the default range is thirty days. The column
count now comes from the DATA in `BarSeries`, so no caller has to know the rule.

**One series, not three.** The prototype answers "this window is too long to
draw daily" by adding a weekly chart beside the daily one and a six-month chart
under it — and the six-month one ignores the range control entirely. Ours
buckets the same series into weeks past 31 days and says "Week by week" in the
panel head. A chart that silently disagrees with the buttons above it is the
payout-card mistake from D7 in a different costume.

**`charts.tsx`, extracted.** The dashboard's `WeekChart` and the reports tab
had grown two identical copies of the same CSS bars, differing only in tooltip
text. `BarSeries` and `TrendChart` now live in one file. The trend chart's
gradient id comes from `useId`: a literal one works until a screen renders two
charts, and then both reference whichever rendered first.

**Occupancy is the ceramics-shaped number this screen was missing.** Seats sold
against seats OFFERED, read from sessions, because only a session knows what
was on sale — four seats sold is thriving or emptying depending on whether
there were six or twenty. A class with no sessions in the window reports `null`
and renders "—", not 0%: a private lesson never had seats to fail to fill.
Cancelled sessions are excluded, so a snow day does not read as a class nobody
wanted. Colouring follows the product's existing quiet/busy/full scale rather
than the prototype's green/amber/red, for the reason already written into
`styles.css` — red on a sold-out Saturday reads as a warning about success.

**Lead time reports the median, with the average beside it.** Lead times are
long-tailed: one person booking a six-week course in January for April drags a
mean past anything a studio would recognise. The median is the booking in the
middle, which is the one they can plan around. Both are returned and the test
pins the difference rather than letting them agree by accident.

**Two figures deliberately do not follow the range control, and say so on
screen.** The customer count, repeat rate and average customer describe the
whole business — a repeat rate computed inside "Today" would read 0% for a
studio with a healthy base. They carry their own footnote and a line under the
table, because a tile that quietly means something different from its
neighbours is how a screen stops being trusted.

**The average customer divides by everyone, including people who never paid.**
Excluding them would measure "what a paying customer is worth" under a label
saying "average customer".

**Three more copies of the money rule, removed.** `popularServices`,
`customerStats` and `staffPerformance` each had their own
successful-minus-refunded filter inline — inside the module that owns the rule,
which is the last place it should be re-typed. All three call `paidCentsOf`
now.

**Not ported, on purpose:** the conversion column (literally
`40 + ((rating * 7) % 25)` in the prototype — an invented percentage beside
real revenue is worse than no column), instructor ratings (nobody is rated
here), "where guests come from" by country (`Customer` has no country, and
collecting one to draw a chart is personal data gathered for decoration), and
the Custom date range button, whose Apply closes the modal and does nothing.
Arbitrary from/to means changing six aggregate signatures and gets its own
decision.

**What the demo data cannot show.** Every booking in `db:demo` is created at
seed time, so lead time reads 0 days and every customer is "new". The figures
are right; the fixture has no history. Same caveat as D7's one-bar breakdown.
### D9 — the differences, 2026-08-25

The smallest gap of the thirteen on paper, and the plan predicted it: B9 built
this screen against real operations and it is ahead of the prototype in three
ways that matter — appointments, balances and first-visit flags, none of which
TourFlow has. What it turns out to be missing is not layout at all. It is three
fields that are already computed, already sent, and never rendered.

**Layout — close it.**

- **Numbered rows.** The prototype numbers the roll 1..n. On a sheet somebody
  is holding, that is how you say "number seven hasn't turned up" out loud, and
  it is how you check twelve ticks against twelve names without counting twice.
- **A totals row.** Heads against capacity and the money owed, at the foot of
  each roll, so the printed sheet reconciles without adding a column up by
  hand.
- **A jump row for a busy day.** The prototype shows ONE departure at a time
  with a chip per slot. Ours shows the whole day, which is right — it is a
  sheet, and a sheet you have to click through is not a sheet. But eight
  classes is a long scroll, so the chips become anchors rather than a filter:
  same navigation, nothing hidden, and print is unaffected.

**Behaviour we lack — close it, and it is all reachability.**

- **The instructor's phone number.** The sheet names who is teaching and gives
  no way to reach them. `Staff.phone` exists; the manifest simply never asked
  for it. "Who do I call" is the second question anybody asks of this page.
- **The address.** `location.address` is already on the wire — computed
  carefully, including a rule that withholds it for mobile locations — and the
  client renders only `location.name`. A studio with two rooms is fine; a
  printed sheet that says "Portland Studio" and not where that is, is not.
- **Where a MOBILE booking actually happens.** This is the sharper half of the
  same gap and the product's own differentiator: for a travelling class the
  address is not the studio's, it is the customer's, stored on
  `booking.serviceAddress` at booking time. The manifest never selects it, so
  the one sheet whose entire job is telling somebody where to go is silent for
  exactly the bookings that need it.

**What the demo fakes — do not port.**

- **Waivers**, and the "waivers missing" tile. They do not exist here; that was
  settled in B1 and nothing since has reopened it.
- **Download PDF**, which raises a toast saying a server would render one.
  Print is a real deliverable here with a real `@media print` block; a PDF
  pipeline is a feature with an owner.
- **Send to guide**, which raises a toast. Ours writes to the outbox and a
  worker delivers it, with a dedupe key carrying the minute so a corrected
  sheet after an 11am cancellation is not silently refused.
- **The check-in toggle.** A single switch means checked-in or not, so the
  prototype cannot tell "did not turn up" from "not marked yet". Ours has
  Here / Absent / unmarked and posts one batch per class. Flattening that to
  match would lose the distinction the register was built around.
- **Special instructions.** The prototype has an `instructions` string per
  activity. The nearest thing here is `ServiceType.description`, which is
  public marketing copy shown on the booking page — putting that on an
  operational sheet would be the wrong text in the wrong place. A real internal
  note field is a small feature, not a styling gap.

### D9 — as shipped, 2026-08-25

Three fields the sheet already knew and never said, plus the finish. No
migration, and no server work beyond two selects and a formatter.

**Everything closed here was reachability, not layout.** `Staff.phone` existed
and was never selected. `location.address` was selected, computed carefully —
including the rule that withholds it for a mobile location — and rendered
nowhere. `booking.serviceAddress` was written at booking time by the public
flow and read by nothing. This is the fourth item in the phase where the gap
turned out to be a reader that was never built (D4's activity editor, D7's
search and "For" column, and now this), which is starting to look less like
coincidence and more like what happens when a screen and its endpoint are
written weeks apart.

**The travelling class is the one that mattered.** Artweel's stated wedge is
mobile delivery, and the sheet whose entire job is telling somebody where to go
was silent for exactly those bookings. It now carries the customer's address
per ROLL ENTRY rather than per class, because two mobile bookings on one
service are two different doorsteps.

**Coordinates are deliberately dropped from it.** `lat`/`lng` are how the
scheduler computes travel time; they are not how a person finds a door, and
this sheet gets printed and left on a passenger seat. `notes` — "side gate,
code 4417" — is kept, because that is the half a driver actually uses. Both
pinned by tests.

**Formatted on the server, not the client**, because the same sheet is sent to
an instructor by email and SMS, and those have no client. Two formatters
eventually disagree about one booking, and on this screen that means an
instructor at the wrong house.

**A positional CSS rule quietly became a different rule.** The narrow-screen
stylesheet hid `.roll th:nth-child(2)` — the contact column — and D9 added a
row number in front of it, which turned that into "hide every NAME on a
phone", on the one screen that exists to show names. Now `.contact-col`.
Verified at 375px, because a media query is invisible to every test in the
suite.

**The jump row is anchors, not a filter.** The prototype shows one departure at
a time behind a chip per slot. Ours keeps the whole day — it is a sheet, and a
sheet you have to click through is not one — but eight classes is a long scroll
on a phone in a doorway, so the chips scroll to a class rather than hiding the
others. They appear above three classes and never print.

**Not ported:** waivers and the waivers-missing tile (they do not exist here),
Download PDF (a toast in the prototype; print is the real deliverable and has a
real stylesheet), Send to guide (also a toast; ours writes to the outbox), the
single check-in toggle (it cannot tell "did not turn up" from "not marked yet",
which is the distinction the register was built around), and per-activity
special instructions — the nearest field here is `ServiceType.description`,
which is public marketing copy, and putting that on an operational sheet would
be the wrong text in the wrong place.

**Verification note.** The demo data has at most one class a day and no mobile
bookings, so the jump row and the doorstep line were checked by adding four
throwaway sessions and one address in the dev database. The sessions were
deleted afterwards — four empty classes would have distorted "classes this
week" for whoever opened the dashboard next; the address was left, and a
re-seed clears it.

### D10 — the differences, 2026-08-25

Two screens with the same name and a different subject. The prototype's
Notifications is an **automation builder**: create a rule, pick a trigger from
a list of nine, pick a channel, write a template, toggle it on. Ours is a
**delivery record with an editor attached**: the messages this product sends
are the messages it sends, and the studio changes their wording.

That difference is not a gap to close. A trigger list where six of the nine
have no code behind them is a settings screen that lies. What IS worth taking
is everything the prototype puts around its table.

**Layout — close it.**

- **A figure row.** The prototype opens with four tiles; ours opens with a
  bare status dropdown. Messages sent, how many actually arrived, how many
  failed, how many are waiting — the four numbers somebody opens this page
  worried about.
- **Status tabs with counts**, replacing the `<select>`, which is the
  arrangement Bookings and Payments already settled on and for the same
  reason: "Failed 3" is the whole point, and a dropdown cannot say it.
- **Token chips in the editor.** The prototype lists its tokens as buttons
  that insert at the cursor. Ours describes tokens in a sentence — and the
  preview endpoint has been returning `availableTokens` since B5 with nothing
  reading it. Third field in this phase that was already on the wire.

**Behaviour we lack — close it.**

- **Real delivery rates.** The prototype hard-codes "99.2%" and "97.8%". We
  have every send, every failure and every skip in one table, so the rate can
  be true instead of decorative. Skips are excluded from it deliberately: a
  message not sent because somebody replied STOP is a rule working, not a
  delivery that failed, and folding the two together would make TCPA
  compliance look like an outage.
- **Send a test.** The one action on the prototype's screen with real value
  that we lack. After changing the wording of a confirmation, the question is
  "will that actually arrive", and preview cannot answer it — only a real
  provider can. It goes to the CALLER'S OWN address and nowhere else: an
  endpoint that sends studio-authored text to an arbitrary destination is a
  spam relay with a login page.
- **Say why a message would be held.** Quiet hours and opt-out are enforced in
  the outbox and explained nowhere in the product, so a SKIPPED row is a
  mystery unless you already know the rules. They are PLATFORM rules
  (`SMS_QUIET_START_HOUR`), not studio settings, and the panel says so rather
  than implying a knob that does not exist.

**What the demo fakes — do not port.**

- **The automation builder.** Nine triggers, three channels, create-your-own.
  Six of those triggers have nothing behind them here, and a studio that
  builds a rule which never fires has been lied to by a form. Our template
  list IS the set of messages that exist; that is a narrower promise and a
  true one.
- **The on/off switch per rule.** Tempting, because `NotificationTemplate` has
  an `isActive` column — and it does not mean that. `resolveTemplate` filters
  on `isActive: true` when looking for an OVERRIDE, so setting it false does
  not stop the message, it reverts the wording to the built-in default. A
  switch wired to that column would read "off" and keep sending. Turning a
  message type off entirely is a real feature and needs its own column.
- **"Send now" to every upcoming booking.** A broadcast to a customer list,
  from a screen with no consent check in front of it. In a US product with
  A2P 10DLC and TCPA obligations that is not a styling gap, it is a compliance
  decision with a lawyer attached.
- **Hard-coded provider names and delivery percentages** in the channels card.
  Ours reads what is actually configured.
- **"Recent sends"** as a second, shorter copy of the log that is already on
  the same screen.


### D10 — as shipped, 2026-08-25

The figures, the tabs, the token chips and a test send. No migration. The
automation builder stayed unported for the reason given above, and nothing
here pretends otherwise.

**The screen described its own rule backwards.** The first draft of the
delivery panel read "reminders wait until 9pm when they fall inside quiet
hours (8am to 9pm, in the customer's own day)". Every clause of that is wrong:
8-21 is the window in which a text MAY be sent, it is evaluated in the CLASS's
zone rather than the customer's, and it defers reminders only — a confirmation
goes the moment it is created, at any hour. Reading `applyQuietHours` is what
settled it, and the payload key is now `sendingWindow: { fromHour, toHour }`
rather than `quietHours`, because the config's own names are what invited the
mistake and the API should not pass it on.

**Delivery rates are counted, not quoted.** The prototype hard-codes 99.2% and
97.8%. Ours is sent over sent-plus-failed from the table underneath, per
channel, and **skips are excluded** — a message held because somebody replied
STOP is a rule working, and folding it into the failure rate would make TCPA
compliance look like an outage and push a studio to "fix" it. The tile names
the skipped count beside the rate rather than hiding it.

**Send me a test, and only to me.** Preview renders the words; only a provider
can tell you the credentials are wrong or the domain fails SPF. The request
has NO recipient field, deliberately — an endpoint behind a studio login that
sends studio-authored text to an arbitrary address is a spam relay, and the
first person to notice would be the provider suspending the number every
studio shares. Email goes to the caller's account address; SMS goes to their
own staff phone, and a studio without one is told which field to fill rather
than handed a silent failure.

**A test is marked as a test in the log.** It goes through the real outbox, so
it appears in the delivery log like everything else — which is right, and also
means a row that says "Booking confirmed · sent" could be mistaken for a
message a customer received. The marker is stored ON the row rather than
sniffed from the "[test]" subject prefix, which would break the day somebody's
own template opens with a bracket.

**The log stopped shipping the rendered message.** Listing rows selected
`payload` and sent it to the browser: a customer's name, their class, and
since D9 sometimes their home address, in a response that only draws a table.
Now only the test flag comes out of it.

**Token chips came from a field nobody was reading.** `availableTokens` has
been in the preview response since B5. The editor described tokens in a
sentence instead, so the list a studio could see was prose written once, and
the list the renderer accepted was code — the two would part company the first
time a token was added. The chips are now generated from the renderer's own
answer and insert at the cursor.

**Not the automation builder, and not the on/off switch.** `NotificationTemplate`
has an `isActive` column and it does not mean "send this message":
`resolveTemplate` filters on it when looking for an OVERRIDE, so setting it
false reverts the wording to the built-in default and keeps sending. A switch
wired to that column would read "off" while messages went out. Turning a
message type off is a real feature and needs its own column.

### The environment, not the code

The full suite failed once during this item with a concurrency-gate assertion —
6 of 20 requests fulfilled where the gate demands exactly 8 — which reads like
an overselling bug and was not one. Docker Desktop's IPv6 port proxy had got
into a state where it ACCEPTS a connection on `::1:15432` and forwards
nothing. `localhost` resolves to ::1 first on Windows, so Prisma reported
"Can't reach database server" against a container that was healthy, listening,
and answering perfectly over IPv4 — and while it was half-working it dropped
requests rather than failing outright, which is what produced the phantom
concurrency failure.

Restarting the container did not fix it. Naming `127.0.0.1` in the connection
strings did, and `.env.example` now carries the reasoning so the next machine
skips the whole class of problem. This is the same family as the port-number
history already recorded there, and it is worth knowing that the symptom can
be a wrong ASSERTION rather than a connection error.

### D11 — the differences, 2026-08-25

The prototype's Integrations is a **marketplace**: twelve cards in a grid,
filtered by category, each with a Connect button and an API-key modal behind
it. Ours is a **status board** for the four things a studio actually depends
on. The marketplace is not a gap — none of those twelve exist here, and a grid
of Connect buttons that open a form and store nothing is the automation-builder
mistake from D10 wearing a different hat.

What the demo has that we should take is the part underneath: its calendar
panel can be acted on, and ours cannot.

**Behaviour we lack — and it is the largest single omission found in this
phase.**

- **A studio cannot connect a calendar.** Five endpoints exist —
  `GET /calendar/:staffId`, `POST /:staffId/connect`, `DELETE /:staffId`,
  `POST /:staffId/sync`, plus the OAuth callback — and **nothing in the client
  calls any of them**. W1.6 built per-instructor OAuth, AES-256-GCM token
  storage and the loop guard that stops a published class blocking its own
  slot, and there has never been a button. The Integrations page displays each
  instructor's calendar status and offers no way to change it, which is the
  worst version of this: it tells you something is off and gives you nowhere to
  go.
- **Sync now.** The prototype's button is a `setTimeout` that writes "just
  now"; `POST /:staffId/sync` is a real incremental pull. This is the one place
  the demo's affordance and our implementation line up exactly.
- **When it last synced, and why it stopped.** `lastSyncedAt` and `lastError`
  are stored per connection and neither is returned. `channelExpiresAt` IS
  selected by the status service and then dropped on the floor — Google expires
  a push channel after about a week, and that is the difference between "syncing"
  and "quietly stopped".
- **A figure row**, which every other screen in this phase now has.

**Layout — close it.**

- Tiles for the four numbers: what is connected, how many calendars sync, how
  many need attention, how many customers have opted out of texts.
- Per-instructor rows gain actions and a last-synced line, rather than being a
  read-only list of names and pills.

**One thing to fix that is not the demo's doing.**

`integration.service.ts` returns `sms.quietHours: { startHour, endHour }` — the
same misleading shape D10 just corrected in the notifications payload, from the
same config names. Here the screen happens to render it correctly (it inverts
the pair to show "9pm – 8am"), which is exactly why it is worth renaming: the
next reader has to work out that the field means the opposite of its name, and
one of them already got it wrong.

**What the demo fakes — do not port.**

- **The marketplace.** Viator, Tripadvisor, Mailchimp, Zapier and the rest.
  None exist; D2 already refused reseller sources as a booking filter for the
  same reason, and a Connect button that stores an API key nothing reads is
  worse than an absent one.
- **The API-key modal**, which prints its own disclaimer saying no credentials
  are sent anywhere.
- **"Channel bookings (30 days)"**, counted from sources that cannot occur.
- **Per-channel sync settings** — real-time push, price override, auto-import —
  which are checkboxes over nothing.
- **A single account-level calendar connection.** The prototype has one Google
  account for the whole business. Ours is deliberately per instructor: their
  own calendar, their own consent, and a studio cannot connect one on their
  behalf without them signing in.

### D11 — as shipped, 2026-08-25

The marketplace stayed unported. What shipped is the four buttons this page
should have had since W1.6, and three fields that were already stored.

**A studio can now connect a calendar.** Five endpoints had existed since
W1.6 — authorize, disconnect, manual sync, status, callback — with per-
instructor OAuth, AES-256-GCM refresh tokens and the loop guard behind them,
and **nothing in the client called any of them**. The Integrations page
displayed each instructor's calendar status and offered no way to change it,
which is the worst version of the pattern this phase keeps finding: it told you
something was broken and gave you nowhere to go. Connect, Reconnect, Sync now
and Disconnect are wired to the endpoints that were already there.

**Disconnect asks first, and says what actually happens.** Nothing breaks
visibly when a calendar is disconnected — the instructor's outside commitments
simply stop blocking their availability, and the studio starts taking bookings
over them. That is a consequence worth spelling out in the confirm, because it
does not announce itself for another week.

**No "Sync now" on a connection whose grant has expired.** It can only fail,
and a button certain to fail is the same lie D0 rejected for hover states on
non-interactive rows. Reconnect is the only thing that helps, so it is the only
thing offered.

**Three stored fields reached a reader.** `lastSyncedAt` (when it last actually
pulled, as against `updatedAt`, which moves on any write including a token
refresh — the two only diverge when something is wrong, which is when this page
gets read), `lastError` (why it stopped), and `channelExpiresAt`, which the
status service was already SELECTING and then dropping before it reached
anybody. Google expires a push channel after about a week and inbound sync then
stops without failing: availability keeps being offered from stale data.

**`sms.quietHours` became `sms.sendingWindow`.** The same misleading shape D10
corrected in the notifications payload, from the same config names. This screen
happened to render it correctly by inverting the pair — which is precisely the
argument for the rename: the next reader has to work out that the field means
the opposite of its name, and one of the two readers already got it wrong.

**Found by breaking it on purpose: a failed action blanked the page.** The
component opened with `if (error) return <div className="err">…`, so a sync
that failed on one instructor replaced the ENTIRE screen — Stripe's status,
every other calendar, the SMS panel — with one line about one calendar. Now
only the first load can replace the page; an action that fails says so where it
happened, keeps everything still true on screen, and can be dismissed. This is
the same family as the polling page whose error state never cleared, recorded
in the verification lessons.

**Not ported:** the twelve-card marketplace and its category filter (none of
those integrations exist, and D2 already refused reseller sources for the same
reason), the API-key modal that prints its own disclaimer saying nothing is
stored, the "channel bookings" tile counted from sources that cannot occur, the
per-channel sync checkboxes over nothing, and the prototype's single
account-level calendar — ours is per instructor by design: their calendar,
their consent, and a studio cannot connect one on their behalf without them
signing in.

**Verification note.** Google is not configured in dev, so the connect endpoint
was checked directly (it returns a real consent URL against the fake provider's
host) and the row states were driven by seeding two connections by hand. Their
ciphertext was junk, so Sync failed with a 500 — which is what surfaced the
page-blanking bug, and is the second time in this phase that a deliberately
broken fixture has been more useful than a working one. Both rows were deleted
afterwards: a permanently broken calendar left in the dev database would be a
puzzle for whoever opened the page next.

### D12 — the smallest item in the phase, 2026-09-01

**Almost all of this screen's difference is pile three.** The prototype's
Website is a site BUILDER — seven sections against our four — and five of the
seven describe a product we do not have.

**Not ported, and none of it close:**

- **Pages.** A table of pages with paths, view counts and publish toggles.
  TourFlow edits a multi-page site; a studio here has one booking page. There
  is nothing to list.
- **Navigation.** Nav items and a header call to action, for the nav that
  multi-page site would need.
- **The Overview KPIs** — page views, bookings from site, conversion. The
  prototype has no backend, so these are invented. We have `MarketingEvent`
  rows but nothing aggregates them into page views, so porting the tiles means
  inventing our own numbers, which is worse than not showing them.
- **The checklist.** Six items, four of which do not exist here: custom
  domain, SSL certificate, gift cards page, Google Analytics. We DO have a real
  one — `getOnboardingState` derives every step from the data rather than from
  a flag — but it already has a home in the onboarding wizard, and a second
  copy on this screen is the D3 side-panel argument again: one question, two
  answers, drifting.
- **The widget's accent colour.** Ours points at Settings → Appearance on
  purpose, because two pickers writing one column drift. The demo has both.
- **Ratings.** No such thing in this product.

**Where ours is ahead and was not flattened.** The demo previews the site with
a hand-built gradient mock of a browser window; ours renders the real booking
page in an iframe. The demo's embed is a fixed-height iframe; ours posts its
height to the host and grows with the content, which is the difference between
an embed and an embed that looks bought.

**What was actually worth closing, both small:**

**The booking page link was in the fourth tab.** "Where is my page?" is the
first question this screen gets asked, and the only route to an answer was
Widget — past two forms, on the section a studio opens least. It is in the page
head now, so it is there from every section. This is the same shape as D9's
finding: not a missing feature, a missing reader.

**`data-height` was undocumented.** The loader has read it since W2.7 and
nothing a studio can see has ever mentioned it. The frame resizes itself, so it
only governs the height the widget opens at — but on a slow connection that is
the height the visitor sees first, and a studio embedding into a fixed layout
has no other way to ask.

**Not verified in a browser, and that is owed.** This session's working
directory is a different project, so `preview_start` resolves the wrong
`launch.json` and the dashboard cannot be walked from here. Client typecheck is
clean and the change is a link move plus a paragraph, but the screen has not
been looked at. Whoever picks up D13 is already in the right folder and should
eyeball it.

### D13 — the last item, and not a styling one, 2026-09-01

Ten sections against our five, and the mapping is mostly architecture rather
than gap: the demo keeps Email and SMS here, we keep them on Notifications;
it keeps Payments here, we keep it on Integrations. Ours has Appearance, which
the prototype cannot have because it has no dark mode.

**The find. Four columns the API accepts, validates and acts on, that no
screen ever wrote.**

`minNoticeMinutes` and `maxHorizonDays` bound every availability query —
`getAvailability` computes its window from them on every request.
`depositType` and `depositValue` decide whether checkout takes part of the
price or all of it; `money.ts` reads them and `payment.service.ts` acts on the
result. The service schema validates all four, down to refusing a percentage
above 100 and a deposit of zero.

Nothing in the client sent any of them. Every studio therefore ran on the
defaults — no notice, a 120-day horizon, no deposits — with no way to say
otherwise. A studio could not ask for a day's notice, could not stop somebody
booking eleven months out, and could not take a deposit on a £400 private
party the schema has a comment about.

**The cause is worth more than the fix.** `ServiceForm`'s own docstring
explains that creating a service asks six questions and lets the server default
the rest, because questions between a studio and its first class are what make
studios abandon setup. That reasoning is right. The sentence after it —
"all editable later" — was not true. There was no later, and the comment had
been standing in for the screen nobody built.

So they appear when EDITING and not when creating. The six questions survive;
the later now exists.

**A bug caught on the way in.** `Classes` builds the edit draft field by field
rather than spreading the row, so the four new fields would have arrived
undefined, rendered as defaults, and been written back over real values on the
next save — a screen that silently reset a studio's deposit terms every time
somebody renamed a class. Both the type and the call now carry them, with a
note saying why a field this type forgets is a field the next save destroys.

**Not ported, and none of it close:** tax and service fees (there is no tax
anywhere in this product — that is a feature decision, not a styling one),
date and time format (rendered per locale), the payment provider picker (Stripe
by design), pay-on-arrival and cash at the meeting point, waivers, child
tickets, the overbooking buffer — which is the product thesis inverted — the
per-studio SMS provider and sender ID, the email from-address (per-studio
sending needs DNS verification per domain, which is its own project), and the
danger zone, whose only control resets the demo.

**Quiet hours stay platform-wide.** The demo makes them a per-studio setting.
Ours are `SMS_QUIET_START_HOUR` / `SMS_QUIET_END_HOUR` in config, applied in
the studio's local time, and they exist because TCPA says so. That is a legal
floor, not a preference, and a per-studio override is a setting whose only use
is breaking the law.

**Where ours was already ahead:** the demo's Users & Permissions is a checkbox
matrix over invented roles. Ours has real ones behind it from S9 and S13 —
invitations, cross-tenant assignment, and an instructor who genuinely cannot
sell a class pack. Not flattened.

**Not verified in a browser**, same as D12 and for the same reason. Client
typecheck and production build are clean, no server code changed, so the 922
stands. The edit form needs walking: open an activity, set a percentage
deposit, save, reopen and confirm it came back — that last step is the one that
would catch the draft bug if it ever returns.

### Known per-item notes

- **D1 Dashboard** — B1 built this against the demo already; expect the
  smallest gap of the thirteen.
- **D2 Bookings** — the demo's `bookings.js` is its largest screen (662 lines).
  Expect the largest gap.
- **D3 Calendar** — 522 lines, and the demo has no availability engine behind
  it. Separate carefully.
- **D6 Staff & Guides** — ours now has real roles behind it (S9/S13); the demo
  has none. Ours is ahead here and should not be flattened to match.
- **D9 Daily Manifest** — B9 shipped appointments, balances and first-visit
  flags, none of which the demo has. Ahead; do not flatten.
- **D13 Settings** — ours has sections the demo does not (cancellation, credits,
  team). The demo's Settings is 329 lines and mostly cosmetic.

---

## Order of work — and the checkpoint that matters

**Do D0 and D2 only, then stop and reassess.** Not the full thirteen.

D0's cost is the one genuinely unknown quantity here: roughly 790 lines of
someone else's CSS meeting a token system with contrast tests over it. Nothing
about the remaining twelve items can be estimated honestly until it has been
done once.

Then **D2 Bookings, out of order and before D1**, because:

- it is the demo's largest screen at 662 lines, against Dashboard's 292
- D1 was already built against this demo in B1, so it would flatter the process
  and teach nothing about the real cost
- if parity is reachable on the hardest screen, the other eleven are downhill —
  and if it is painful, that is far better learned on the second item than the
  eleventh

After D2 there are real numbers, and the remaining eleven can be judged as a
batch, individually, or dropped. Committing to all thirteen before D0 has been
attempted once would be estimating from nothing.

---

## What this plan deliberately does not do

- **It does not delete anything.** The four hidden screens keep working at
  their routes. Anything found to be genuinely dead gets its own decision, in
  writing, not a quiet removal during a styling pass.
- **It does not port the demo's data model.** TourFlow is a tours product.
  Departures, guides and waivers are not being imported; that was settled in
  Phase B and nothing here reopens it.
- **It does not chase the demo where ours is better.** Several screens are
  ahead of the prototype because they are backed by a real system. Parity means
  matching the finish, not surrendering the substance.
