# Client feedback tracker

One row per finding. Each is investigated before anything is changed; the
verdict says whether it is genuine, and the Solution / Reason column says what
was done about it — or why nothing was.

**Source:** client walkthrough (merchant dashboard + customer experience, with
screenshots), received 2026-11-10.
**Investigated against:** branch `feat/edit-class-event` (`6913770`), by reading
the code. Live may run an older build — re-check each item there before
replying "already fixed".

## Legend

- **Class** (the client asked for this): `Fix` · `Configuration` ·
  `Plan restriction` · `Future feature` · `Already supported` · `Decision`
  (needs Suren's call before anything is built).
- **Verdict:** `Genuine` · `Partly genuine` · `Not a bug` · `Needs repro`.
- **Status:** `Open` → `In progress` → `Fixed (local)` → `Deployed` → `Closed`
  (retested by client) · `Won't fix`.

---

## Priority 1 — Booking reliability and calendar

| ID | Finding | Class | Verdict | Findings (cause) | Solution / Reason not fixed | Status |
|---|---|---|---|---|---|---|
| FB-01 | Manual booking cannot finish when the chosen date has no session | Fix | Genuine | `CounterBookingForm.tsx`: the time list is filtered to existing sessions on that date; with none it shows "Nothing scheduled that day." and submit is blocked by the required select. No way to create a session from the form, and the date picker does not show which days have sessions. | Planned: "Choose an existing session" / "Create a new session" inside the form (time, capacity, instructor, location, clash check), keep guest details, say why submit is blocked. **Reproduced locally 2026-11-10** (Clay & Co, Valentine Date Night, event, one session on 12 Nov 6 PM): on 10 Nov the time list held only "Choose a time…" and "Nothing scheduled that day."; Create booking was blocked by the browser's own "Please select an item in the list" bubble — no message in the form, no hint of the next date that has a session, the date picker greys out nothing. Control: on 12 Nov the 6 PM session appeared and was auto-selected. See also FB-30. **Reproduced on live 2026-11-10** (app.bookaihub.com, Galaxy Empire, read only — nothing submitted): "Pottery Wheel Throwing Party" on 10 Nov → label "Departure", only "Choose a time…", "Nothing scheduled that day." Its sessions run only Sat/Sun at 11:00, 14:00 and 17:00, so every weekday dead-ends the same way, and nothing in the form says the next date is Sat 14 Nov. **Fixed (local) 2026-11-10**, `CounterBookingForm.tsx`, uncommitted: (1) "Session time" offers *Choose an existing session* / *Create a new session* (the second for owners/admins only — the server keeps scheduling to them). (2) A day with nothing on it shows the next dates with places as one-click chips, plus a link to create a session that day. (3) A new session takes start time, places (defaults to the activity's max), location (when there is more than one) and the Instructor field; clashes are checked live with the same preview Create activity uses, and block submit. (4) On submit the session is created, then booked into; if the booking fails the session is cancelled again so no empty class is left behind. (5) The browser bubble is replaced by a "Before this booking can be created:" list naming every missing thing, including too many guests for the places left. Guest details are kept throughout (same form state). Verified in the browser, local Clay & Co: blockers list; chip Tue→Thu 12 Nov kept name/email and auto-picked 6 PM; new session at 6 PM on 12 Nov flagged "Rowan Pike is teaching Valentine Date Night 6–8pm"; new session 10 Nov 6 PM at Gowanus Studio → booking 6529D4DA created, session row 8 places / 1 taken / Rowan Pike / Gowanus Studio. Not exercised: the instructor-role view and the roll-back when a booking fails after its session is made. Client typecheck clean. **Client detail 2026-11-10** (Art Wheel Studio, "Paint you own pottery", 19 Nov, owner account): asks for existing/new session, guest details kept, *time, capacity, instructor and location validated*, then *return to the form with the new session selected*. Retest: create a valid session and complete the booking without re-entering customer details. Checked against the local fix — gaps: (a) the fix creates session + booking in one submit instead of returning with the session selected; (b) instructor is only clash-checked, not defaulted or required; (c) a start time already past is not refused. **Gaps closed 2026-11-10:** (a) *Create session* is now its own button; it creates the session and returns to "Choose an existing session" with the new one selected and a note "Session created … now create the booking" — the earlier one-step create-and-book (and its roll-back) is gone; (b) the new-session panel has its own required Instructor field, filled in automatically when the studio has one instructor (the lower Instructor box is hidden meanwhile); (c) a date/time already past in the studio's zone is refused. Session problems are listed under the button ("Before the session can be created:"). Retested locally exactly as the client describes: guest entered once → past time + no instructor + no location all listed → Thu 19 Nov 18:00, Sam Ortega, Gowanus Studio, "No clashes" → Create session → returned with "6:00 PM — 8 of 8 places left · Sam Ortega" selected, name/email still filled → Create booking → booking 7A25E36A, session 8 places / 1 taken. Not exercised: the one-instructor auto-fill (local studio has two) and the instructor-role view. Client typecheck clean. | Fixed (local) |
| FB-30 | *(found while testing FB-01)* Activity list in manual booking can be empty with no explanation, and Classes (multi-session courses) cannot be booked at the desk at all | Fix | Genuine | The form leaves out hidden activities and every `COURSE_SERIES` (`CounterBookingForm.tsx:158`, on purpose: a course is sold as a whole-series enrolment, not one session). Locally the only active activity is a course, so the dropdown shows just "Choose a class…". If the client's intro class is set up as a Class, they hit this rather than FB-01. Also seen on live (Galaxy Empire): the course "Family Wheel Saturdays" has sessions but is missing from the desk's Activity list. | Say why the list is empty and what to do; decide whether the desk can enrol a customer in a whole course (a separate flow, not a session booking). | Open |
| FB-02 | Label says "Departure" | Fix | Genuine | `CounterBookingForm.tsx:410` and helper text "N departures that day". | Renamed to "Session time"; helper says "N sessions that day". Done with FB-01. | Fixed (local) |
| FB-03 | Guest counts produce "12" / "01"; defaults wrong | Fix | Genuine | Adults handler is `Math.max(1, Number(v) \|\| 1)`: clearing the box snaps it back to 1, so typing 2 gives "12". Children snap to 0 → "01". Adults default 1, children 0; capacity is only enforced by the browser `max`. | Defaults 0/0, select-on-focus, allow empty while typing, require ≥1 guest, clamp to places left with a message, show count + total live. | Open |
| FB-04 | Arrows and typed quantities give different totals | Fix | Genuine (display) | Public booking page (`booking-page.client.ts:1149`) re-quotes on `change`, which arrows fire at once but typing fires only on blur — so "2 places / $50" shows until the box loses focus. Clicking Confirm while that re-quote is in flight sends the free-booking path, which the server refuses with PAYMENT_REQUIRED. **The charge itself is computed server-side and is correct.** | Re-quote on `input`; disable Confirm until the quote for the current party has returned. Same fix in the course form (line 307). | Open |
| FB-05 | Week view empty for a week that has sessions in Month view | Fix | Genuine | Week loads **bookings** (`/bookings?…status=PENDING,CONFIRMED,ATTENDED`), Month loads **sessions**. A class with no bookings yet shows in Month and not in Week. Also hours outside the week grid's START/END_HOUR are not drawn. | Week (and Day) to read sessions, with bookings inside them; same data source for every view. | Open |
| FB-06 | Month labels truncated | Fix | Genuine | `.cal-ev` is one 11px line, time + name, with no tooltip; on phones the cell is ~50px wide. | Wrap to two lines / short name + time, title tooltip, phone layout as a day list. | Open |
| FB-07 | Add Day view; order Day → Week → Month, Today separate | Fix | Genuine | Day view was declined in D3 (see header of `Calendar.tsx`). Month and Week also keep separate anchors, so switching views can jump to a different date. | Add Day view, one shared anchor date across views, reorder the toggle. | Open |
| FB-08 | Today control | — | Not a bug | Client confirmed Today returned December → November. | No change. Keep working when views share one anchor (FB-07). | Closed |

## Priority 2 — Usability and presentation

| ID | Finding | Class | Verdict | Findings (cause) | Solution / Reason not fixed | Status |
|---|---|---|---|---|---|---|
| FB-09 | Remove the What / Category / When bar from public Home and Activities | Fix | Genuine | `storefront.ts` `searchPanel()` rendered in the Home hero (line 389) and on Activities (line 458). | Remove from both (or a per-studio on/off setting, default off). Cards first; date chosen after the activity. | Open |
| FB-10 | Mobile layout: one card per row, readable duration + price per person, "Choose a date" button | Fix | Partly genuine | `.sf-grid` is `minmax(290px,1fr)`, so phones already get one card per row. Price shows without "per person"; button says "Book now". | Add "per person", rename button to "Choose a date", check at 375px. | Open |
| FB-11 | Activity photos and staff portraits with upload, crop, replace/remove, alt text, mobile preview | Future feature | Genuine | Activities have no image field at all (gradient + emoji). Staff have `photoUrl` (a URL field, no upload). No file storage exists. | Needs storage (S3/R2 or disk), an upload endpoint, a crop UI, alt text. Sizeable on its own. | Open |
| FB-12 | Rename "Type" to "Booking format" and explain the options | Fix | Genuine | Activities table column "Type" shows Class / Event (`Classes.tsx:1373`). | Rename, and explain "Multi-session course — book the whole series" vs "Single-session experience — book one date", including what the price covers, both on the list and in Create activity. | Open |
| FB-13 | Category only offers "Uncategorised" | Fix | Genuine | The server has category create/delete (`/services/categories`); no screen calls them. | Add a small category manager, or hide the field while there are none. | Open |
| FB-14 | Draft vs Publish vs Published unclear | Fix | Genuine | There are three states with different names: an unfinished **draft** (answers only, listed above Activities), a saved activity that is **Hidden**, and one that is **Active**. The client's Valentine event is one of the first two. | One status vocabulary everywhere (Draft / Hidden / Published), a status pill on every row, specific error on a failed publish. Find the Valentine event on live to confirm which it was. | Open |
| FB-15 | Required phone vs checkout's "Mobile (optional)" | Fix | Genuine | The server refuses a booking without a phone when `requirePhoneAtCheckout` is on (`public.service.ts:556`), but the booking page always labels the field "Mobile (optional)" and never receives the setting. | Pass the setting to the page; label "Mobile" + required when it is on. | Open |
| FB-16 | "48h" cancellation wording | Fix | Genuine | Home stats tile reads "48h · free cancellation" (`storefront.ts:336`). | Spell it out ("Free cancellation up to 48 hours before"), and match the policy text on checkout. | Open |
| FB-17 | Phone formatting and currency display inconsistent | Fix | Needs repro | Several renderers format money and phone separately. Need the client's screenshots to name the screens. | Find each screen from the screenshots, then use one formatter. | Open |
| FB-18 | BookAIHub vs Artweel branding | Decision | Genuine | The domain and marketing say BookAIHub; the dashboard, login and guides say Artweel (e.g. "Nothing in Artweel adds tax…"). | Suren to choose the customer-facing name; then one pass over the strings. | Open |
| FB-19 | Developer test offers visible in the public catalogue | Configuration | Needs repro | Data, not code: test activities are Active on the client's studio. | Set them Hidden (or delete) on live once identified. | Open |

## Priority 3 — Pricing and promotions

| ID | Finding | Class | Verdict | Findings (cause) | Solution / Reason not fixed | Status |
|---|---|---|---|---|---|---|
| FB-20 | Automatic 20% off Mon–Thu sessions (by session date) | Future feature | Genuine | No discount or pricing-rule concept exists; `priceBooking` knows adult and child rates only. | Pricing rules on an activity (weekday set → % or fixed), applied by session date in `priceBooking` so quote, checkout and manual booking agree. | Open |
| FB-21 | Promo codes (%/fixed, activity limits, expiry, redemption limits, reporting), best discount wins, no stacking | Future feature | Genuine | Nothing exists. | Builds on FB-20: codes table, redemption ledger, checkout field, report. | Open |

## Testing support and remaining checks

| ID | Finding | Class | Verdict | Findings (cause) | Solution / Reason not fixed | Status |
|---|---|---|---|---|---|---|
| FB-22 | Is Stripe in test or live mode? First-purchase procedure | Configuration | Not a bug | Live runs Stripe **test mode** (live-mode setup A9 is postponed). No real money can move; test card `4242 4242 4242 4242` completes a purchase. | Tell the client; anyone can make the first purchase with the test card. | Open |
| FB-23 | Verify charge, confirmation, merchant record, seat reduction, messages, cancel, reschedule, refund | Already supported | — | All built and tested; a paid booking and a refund were verified on live in test mode (Oct). | Client to retest after P1 fixes deploy. | Open |
| FB-24 | Customize notifications: edit/save, preview, restore default, merge fields, test send | Fix | Partly genuine | Edit/save, preview, merge-field chips and "Send a test" exist. **No restore-to-default** — there is no route to delete an override. | Add "Restore default". The rest is a retest. | Open |
| FB-25 | Test more instructors without paying for an upgrade | Plan restriction | Not a bug | Solo allows one instructor (`plan.ts`). The platform admin can set a studio's plan with `comp` (`POST /platform/organizations/:id/plan`). | Comp the client's test studio to Studio/Pro from the admin panel. Controlled destinations: use their own email/phone as staff and customers. | Open |
| FB-26 | Tax handling | Future feature | Genuine | Settings says it plainly: tax is not calculated. | Stripe Tax or a per-studio flat rate — needs a decision on scope. | Open |

## Later improvements (client-flagged, not for now)

| ID | Finding | Class | Status |
|---|---|---|---|
| FB-27 | Return-visit offers, referral rewards | Future feature | Open |
| FB-28 | Stronger data exports | Future feature | Open |
| FB-29 | Layouts for different catalogue sizes; second design opinion | Future feature | Open |

## Confirmed working by the client

About text and bio saved · phone display formatted · USD selected · Today
control (FB-08).
