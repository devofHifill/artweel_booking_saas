# Classes and events — one choice, two short flows

Written 2026-11-05, from a design discussion with Suren. Nothing here is built
yet. Decisions marked **Decided** were made in that discussion; **Later** marks
the ones deliberately left open.

---

## Status

| Stage | State |
|---|---|
| 0 — Existing data | **Done** in migration `20261105120000_activity_kind`. Live counts not yet checked. |
| 1 — Server | **Done**, branch `feat/class-event-server`. `POST /activities/events`, `POST /activities/classes`, `/activities/drafts`; `kind` and `lifecycle` on `GET /services`; Classes count in readiness (`STARTED` once the first session begins); the only building is used without asking. Tests: `tests/admin/activities.test.ts` (23). |
| 2 — Picker and Event flow | **Done** — `client/src/components/CreateActivity.tsx`. Drafts listed on Activities with Continue / Discard. Walked in a browser, phone width included. |
| 3 — Class flow | **Done** except the clash check, which is Stage 4. Live date list with skip-a-date (`client/src/lib/class-dates.ts`, a copy of the server's rule). |
| 4 — Clashes | **Done** for instructor and location. `POST /activities/preview` (`activities/clashes.ts`) names each clashing date and what is there; the steps show it beside the date and hold Next and Publish; publishing re-checks inside its transaction (`CLASH`, location row locked). `Location.oneAtATime` (Settings → Locations, buildings only, off by default). **Not done:** equipment (the steps never ask which equipment an activity uses), and the older "Add a session" form does not check one-at-a-time locations. |
| 5 — Past and Duplicate | **Done** in the dashboard: Live / Past tabs, Ended cards (Duplicate, no Edit), Duplicate opens at the dates step. |
| 6 — Booking page and naming | **Done.** Booking page: Classes, Events (date first, soonest first), then "More to book" for older activities, older cohorts still under Courses; ended Events and Classes leave the page and the website. Dashboard labels and "sessions" wording. Help guides rewritten for Class / Event (`client/src/guides/activities.md` Part C and examples; `setup`, `staff`, `running`). Tests: `tests/public/classes-events-on-page.test.ts`. **Not done:** the website's own pages (storefront home, Activities, footer) do not list Classes, which sell from the booking page only; booking an Event still opens a calendar with its one date rather than going straight to it. |

Checked 2026-11-05: full server suite 1,311 / 1,313. The two failures: a
database connection dropped under load (passes alone), and a real, older
daylight-saving bug in `resolveLocal`, fixed in its own commit.

**Open, needs Suren:** every Class is a course underneath, and courses are
gated to Studio and Pro (`requireFeature(…, 'courseSeries')`). A Solo studio
can therefore create Events only. Kept as-is; decide whether Classes should
be on every plan.

---

## What this is

Today **Create activity** is one long form with six sections, and its schedule
section is the hardest part of it. This plan replaces it with a single choice —
**Class** or **Event** — followed by a short step-by-step flow for each.

The aim is a product a studio owner can use without reading the help guides:
one way to create, one way to schedule, no combinations to work out.

**The headline: almost nothing here is new machinery.** Both kinds map onto
booking modes that already exist, are tested, and take payments today:

| Kind | Built on | Already exists at |
|---|---|---|
| Event | `BookingMode.EVENT` with exactly one `Session` | `schema.prisma` `BookingMode`, `sessions/session.admin.service.ts` |
| Class | `BookingMode.COURSE_SERIES` with one `CourseSeries` | `schema.prisma` `CourseSeries`, `courses/course.service.ts` |

The work is a `kind` field, the picker, two step flows, a schedule preview with
clash checks, a Past state, Duplicate, and hiding what the two kinds replace.

---

## The two kinds

**Event — one day.** **Decided.**
One date, one start and end time, a number of seats, a price. A customer books
a seat and pays. When the event ends it becomes Past.
Two time slots on the same day are two events (Duplicate makes the second).

**Class — a fixed run of sessions, booked once.** **Decided.**
A start date, one or two weekdays, one time, a number of sessions, a number of
seats, and one price for the whole run. A customer enrols once, pays once, and
is booked into every session. Booking closes when the first session starts.
When the last session ends the class becomes Past.
Drop-in (booking single dates) is **not** offered. **Decided.**

**Words used everywhere:** *Class*, *Event*, *Session* (one date of a class),
*Past*. "Activity" stays only as the umbrella name for the page.

---

## What is hidden — not deleted

Hidden from the create flow and from navigation. **Decided.**

- Private lessons (`BookingMode.APPOINTMENT`) and mobile parties
- Drop-in group classes with many dates
- Class packs and credits — not for events, not for classes
- The separate **Schedule a class** form on the Activities page
  (`client/src/pages/Classes.tsx:1200`)
- Per-activity deposits, categories, late enrolment, slot granularity and the
  other advanced fields in `ServiceForm.tsx` — revisit only if studios ask

The code, tables and routes stay. Existing data keeps working (Stage 0).

---

## Stage 0 — Existing data

**Decided:** keep existing data where practical; it may be cleaned if needed,
since the product is still in development.

Every existing `ServiceType` gets a `kind`:

| Today | Becomes |
|---|---|
| `COURSE_SERIES` | **Class** |
| `EVENT` with exactly one session (past or future) | **Event** |
| `EVENT` with several sessions (drop-in) | **Older** |
| `APPOINTMENT` | **Older** |

**Older** activities keep working exactly as they do now — their dates stay
bookable, their bookings stay valid — but they are not offered when creating,
and they move to Past after their last date. Unused packs and credits keep
redeeming until used or expired; only *selling* new ones stops.

**First step of the stage:** count what live (bookaihub.com) actually holds in
each row of the table, plus unredeemed packs and credits. If Older is empty on
live, it can be dropped from the UI entirely.

---

## Stage 1 — Server: kind, draft, past

1. **`ServiceType.kind`** — `CLASS | EVENT | OLDER`, migration fills it per the
   Stage 0 table.
   **Trap:** `BookingMode.EVENT` already means "seat-based on a dated session"
   and covers drop-in repeats. Do **not** reuse it as the kind. The new enum is
   separate, and code reads `kind` for anything the operator sees.
2. **Draft** — a separate `activity_drafts` table holding the step flow's
   answers as JSON, listed under **Drafts**. The step flow saves after each
   step so closing the tab loses nothing. Publishing deletes the draft in the
   same transaction.
   *Changed while building:* the first idea was an unpublished `ServiceType`
   (`publishedAt` null). Rejected because its sessions would hold the
   instructor's time in `staff_time_blocks` — an abandoned draft would block
   real bookings and show as a clash.
3. **Past is computed, not stored.** An activity is Past when its last
   session's `endsAt` is before now. Worked out in the query that lists
   activities and in the public booking page query — no scheduled job, so it
   can never show live by mistake. The worker only does side effects (close
   waitlists, stop reminders).
4. **Creating a Class** creates the `ServiceType`, its one `CourseSeries` and
   every `Session` in **one transaction**. A course with a hole in it is broken
   (`session.admin.service.ts:272` explains why drop-ins skip clashes and
   courses must not).
5. **Creating an Event** creates the `ServiceType` and its one `Session`.

---

## Stage 2 — The picker and the Event flow

**Create activity** opens two cards: *Class — runs over several weeks* and
*Event — one day*.

Event steps:

1. **What** — name, short description, photo (optional)
2. **When and where** — date, start time, end time, location
3. **Seats and price** — seats, price, instructor
4. **Review and publish** — the real booking-page card as customers will see it

Rules for every step flow:

- A few fields per step; if a step scrolls, it is two steps
- Progress bar with step names; finished steps are clickable
- Back never loses input
- Defaults filled in: the only location, the only instructor, a usual time
- Validation per step, error next to the field
- Works on a phone

**Editing is not the step flow.** A published class or event edits on one page
with the same sections. (What may change once people have booked — **Later**.)

---

## Stage 3 — The Class flow and its schedule step

Class steps:

1. **What** — name, short description, photo (optional)
2. **Schedule** — starts on, every (weekday chips), at (start–end), sessions
3. **Where and who** — location, instructor
4. **Seats and price** — seats, price for the whole class
5. **Review and publish**

**The schedule step shows real dates as they type:**

> 8 sessions · Tue 6:00–8:00pm
> ☑ Tue 3 Mar ☑ Tue 10 Mar ☐ Tue 17 Mar ☑ Tue 24 Mar …
> Ends Tue 28 Apr

- Unticking a date adds one at the end — the count stays, the end date moves
- The end date is calculated, never typed
- One time per class; a second time is a second class (Duplicate)
- Dates resolve in the studio's time zone, so 6pm stays 6pm across a
  daylight-saving change

**What this replaces, and why** (`client/src/components/ServiceForm.tsx:843`):
no start date (always "the next 4/8/12 weeks" from today); days × several
times multiply into dozens of classes shown only as a count; no list of actual
dates; a silent cap at 52 (`ServiceForm.tsx:912`); a second scheduler elsewhere
on the page; and the section is called "Availability", which reads as
instructor hours.

---

## Stage 4 — Clashes

**Decided:** the system handles clashes.

**Already enforced on save:** an instructor cannot be in two sessions at once
(`createSession`, reported as a skip at `session.admin.service.ts:275`), and
equipment cannot be double-booked (`resources/resource.service.ts:119`).

**New:** a dry-run endpoint — e.g. `POST /services/schedule-preview` — that
takes the schedule step's input and returns each date with any clash. The
schedule step (and the event's *When and where* step) calls it as the form
changes.

Checked:

- **Instructor** already teaching at that time
- **Location** already in use — **needs a setting**: whether a location runs one
  thing at a time (a room) or several (a whole studio). Not checked today as far
  as this pass found.
- **Equipment** — seats more than the wheels (or other resources) available

Behaviour:

- A clashing date is shown in the list with its reason, e.g. "Tue 17 Mar —
  Maya is teaching Wheel Basics 6–8pm"
- The fix is in place: untick the date, change the time, or change the
  instructor
- **Publish is blocked while any clash remains**
- The same check runs for Duplicate, and later for editing
- The server re-checks on publish; a clash that appeared in between is refused
  with a clear message, never double-booked

---

## Stage 5 — Past and Duplicate

**Past** — closed for booking, hidden from the main list and the booking page,
listed under a **Past** tab. Still fully viewable: bookings, payments, refunds,
pieces and firings (pickup can come weeks after an event). Cannot be edited or
rescheduled.

**Duplicate** — on any class or event, live or past. Copies everything and
opens the step flow at the dates step, then Review. This is how a studio runs
"Beginner Wheel" again each term — no separate concept of runs or cohorts in
the UI.

---

## Stage 6 — Booking page and naming

- Booking page shows **Classes** and **Events** as separate sections; events
  lead with the date
- A class card states it is booked once for every session, and that missed
  sessions are not made up (no credits)
- Fix the labels that call an activity a "class" (found 2026-11-05):

| Where | Says | Becomes |
|---|---|---|
| `client/src/components/GlobalSearch.tsx:61` | `Class` | kind of the activity |
| `client/src/pages/Dashboard.tsx:277` | `Class` column | `Activity` |
| `client/src/pages/CustomerDetail.tsx:562` | `Class` column | `Activity` |
| `client/src/components/CounterBookingForm.tsx:166` | "Could not load your classes." | "…your activities." |
| `client/src/pages/Classes.tsx:823` | "Across your live classes" | "…live activities" |

- "Schedule a class" / "Scheduled classes" become **Sessions** wording
- Help guides in `client/src/guides/` updated to the four words

---

## Later — deliberately left open

- **Editing after people have booked** — seats below booked, date changes,
  price changes, moving a start date that has passed
- **Minimum numbers** — whether a class can have a minimum and a "decide by"
  date (`ServiceType.capacityMin` already exists)
- **WordPress plugin** (`wordpress-plugin/`) — left as it is; will need the two
  kinds later
- Customer cancellation policy per kind (e.g. refund up to 7 days before)
- Reminders before every class session, and attendance per session
- Waitlist for both kinds (exists today; keep, confirm behaviour)
- Paying for a long class in instalments

---

## Not doing

- Drop-in classes, private lessons, mobile parties as new activities
- Packs and credits for events or classes
- Multi-day events
- Several start times on one class
- A cohort / run concept in the UI (Duplicate covers it)
