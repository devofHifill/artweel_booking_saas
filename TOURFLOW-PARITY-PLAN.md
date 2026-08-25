# TourFlow parity — implementation plan

---

## RESUMING HERE — state as of 2026-08-25

**Done:** D0, D1, D2, D4, D5, D6, D7. **D3 is PARTIAL** (month + week shipped;
day view, side panel, block-a-date and add-slot deliberately not built — see
its section). **D8–D13 not started:** Reports, Daily Manifest, Notifications,
Integrations, Website & Widget, Settings.

**Suite: 882 tests, 59 files, green.** Run it with `npm test` from `server/`;
it takes about 37 minutes, so start it before doing anything else.

**Deployed and verified on staging** (`artweel.fillforge.cloud`): all migrations
through `default_brand_indigo`, plus the `.dockerignore` fix that keeps
`prisma/demo.ts` out of the production image. **D7 adds no migration**, so
nothing new is owed to staging.

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
| **D8** | Reports | | not started |
| **D9** | Daily Manifest | | not started |
| **D10** | Notifications | | not started |
| **D11** | Integrations | | not started |
| **D12** | Website & Widget | | not started |
| **D13** | Settings | | not started |

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
