# How Class scheduling works

How a **Class** gets its dates and times: what the studio fills in, how the dates are worked out, what is stored, how editing behaves, and what customers see. Written 2026-11-16, describing `main` at `5be8dd7` (REPEAT-PLAN.md parts 1–4, all live). The decisions and their history are in [`REPEAT-PLAN.md`](../REPEAT-PLAN.md); this file is the reference for how the result works.

---

## 1. The words

| Word | Meaning | Where it lives |
|---|---|---|
| **Class** | An activity sold as a whole course: one price covers every session, customers book once and come to all of them. | `service_types` row, `kind = CLASS`, `booking_mode = COURSE_SERIES` |
| **Session** | One meeting on one date at one time (e.g. Mon 23 Nov, 6:00–7:00pm). Has its own seats and register. | `sessions` row |
| **Run** | One full set of sessions on one set of dates (e.g. Mon & Tue for 3 weeks from 23 Nov). A date range makes several runs back to back. | the dates shared by its groups |
| **Time** | A start time the Class runs at that day (6:00pm, 8:00pm). Every time has the first one's length. | `course_series.cohort_label`, `sessions.local_start_time` |
| **Group** | One run at one time — what a customer actually books. A Class with 3 runs × 2 times has 6 groups. | `course_series` row (a "cohort") |
| **Enrolment** | A customer's booking of one group: one enrolment, one booking per session of that group. | `enrollments` + `bookings` |

A Class always counts as **one Class** toward the plan limit, however many runs and times it has (`class-limit.ts` counts activities, not groups).

An **Event** is the other kind: one date, seats sold per seat. It does not repeat and is not covered here except where it shares code.

---

## 2. What the studio fills in (Schedule step)

```
Starts on [23 Nov 2026]        Until (optional) [31 Jan 2027]
Days      [Mon][Tue][Wed][Thu][Fri][Sat][Sun]
Starts at [18:00]  Ends at [20:00]      Duration: 2 hours
More times   20:00  to 10:00pm  Remove
             + Add another time
Repeat   ☑ Repeat weekly   How many weeks [3]
         ☐ Repeat monthly  How many months [ ]  → Each month (•) the fourth Monday …
```

| Field | Rule |
|---|---|
| **Starts on** | The first possible date. The first session is the first matching day on or after it. |
| **Days** | Mon–Sun chips; at least one. All seven is what used to be "Daily". |
| **Starts at / Ends at** | One length for every time. Must end after it starts. |
| **More times** | Start time only; each ends after the same length. Must all differ, and none may run past midnight. Up to 12 times a day. |
| **Repeat weekly** | How many weeks (1–52). Sessions per run = days × weeks. |
| **Repeat monthly** | How many months (1–24), then **Each month**: *the 23rd* (only with one day ticked), *the fourth Monday [and Wednesday]*, or *the last Monday [and Wednesday]* when the start date is in its month's last week. Sessions per run = days × months (× 1 for "the 23rd"). |
| **Neither ticked** | One week: sessions per run = number of days ticked. |
| **Until (optional)** | Empty: one run. With a date: runs back to back until then (section 4). |
| **Date list** | Every date, run by run, each with a tick box. Untick a holiday to skip it (section 3). |

Ticking one repeat box unticks the other. There is no "Sessions" field: the count follows from the answers. (Older Classes that were saved with a count that isn't days × weeks keep their exact count when reopened — see section 7.)

---

## 3. How one run's dates are worked out

`planClassDates` — `server/src/modules/activities/class-dates.ts`, with an identical copy in `client/src/lib/class-dates.ts` so the date list on screen is exactly what gets created. **Change one, change both.**

1. Walk day by day from **Starts on**, for at most two years (731 days).
2. Keep a day if it **matches** the pattern:
   - **Weekly / one week:** its weekday is ticked.
   - **Monthly, the 23rd:** its day of the month equals the anchor's (months without that day, e.g. the 31st, are passed over).
   - **Monthly, the Nth weekday:** its weekday is ticked *and* it is in the same week of the month as the anchor (`ceil(day / 7)`), e.g. the 4th Monday and 4th Wednesday.
   - **Monthly, the last weekday:** its weekday is ticked *and* it is in the last 7 days of its month.
   - The **anchor** is Starts on (for later runs of a range, still the first run's Starts on — so every run counts "the fourth Monday" the same way).
3. If a kept day is **unticked** (in `skipDates`), it is recorded as skipped and **not counted**.
4. Stop once the run has its full **session count**. A skipped date therefore lengthens the run instead of shortening it: the price covers that many sessions.
5. If two years pass first, the answers are refused ("Those sessions do not fit within two years").

Dates are plain calendar dates (`YYYY-MM-DD`), never instants, so no clock change can move a date.

---

## 4. Runs over a date range

`planClassRuns` in the same files.

- **No Until:** one run (section 3).
- **With Until:**
  1. Run 1 starts at Starts on. If it cannot finish by Until, the answers are refused ("One run needs until …").
  2. Each next run starts **the day after the previous run's last session** and is planned the same way (same pattern, same anchor, same skipped dates).
  3. A run is kept only if it **finishes by Until**. The first one that doesn't is dropped, and the matching dates left before Until are reported as **left over** ("Mon 25 Jan, Tue 26 Jan are not enough for another full run, so they are left out").
- Runs never share a date, so the same time on two runs can never clash. Every run has the same session count, so one price fits all of them.
- An unticked date pushes its run's end out and every later run along with it.

Example — Mon & Tue, Repeat weekly 3 weeks, 23 Nov 2026 until 31 Jan 2027:

| Run | Dates | Sessions |
|---|---|---|
| 1 | Mon 23 Nov – Tue 8 Dec | 6 |
| 2 | Mon 14 Dec – Tue 29 Dec | 6 |
| 3 | Mon 4 Jan – Tue 19 Jan | 6 |
| — | 25, 26 Jan: left over | — |

With a second time at 8:00pm, that is 6 groups: each run at 6:00pm and at 8:00pm.

---

## 5. From dates to sessions (times and clocks)

`classGroups` in `server/src/modules/activities/activity.service.ts`.

1. `groupTimes` turns the first time plus the extra start times into a sorted list of times, each the first one's length (`class-dates.ts`). Older requests that send `groups` + `bufferMinutes` instead are still accepted.
2. For every **run × time**, each date is turned into a real instant with `resolveLocal(date, minuteOfDay, studioTimezone)` (`scheduling/time/zoned.ts`). This is done **per date**, so 6:00pm stays 6:00pm across a daylight-saving change — the UTC instants differ by an hour either side of it, deliberately.
3. Each group gets a **label** used across the product (Manifest, desk form, booking page):

   | Runs | Times | Label |
   |---|---|---|
   | 1 | 1 | none |
   | 1 | several | `6:00pm` |
   | several | 1 | `23 Nov` |
   | several | several | `23 Nov · 6:00pm` |

---

## 6. Publishing

`createClass` in `activity.service.ts`. One database transaction: everything is created, or nothing is.

1. **Plan limit:** a Published Class must fit the plan's running-Class limit (Solo: 1). A Class saved **Hidden** takes no place until it is switched on.
2. **Dates:** work out every group (sections 3–5). The first session must be in the future.
3. **Size limits:** see section 10.
4. **Clash check** (`clashes.ts`), on every session of every group, before anything is written:
   - the **instructor** is already teaching or booked then (their time blocks), or
   - the **location** is marked *one thing at a time* and something else is on then.

   One clash anywhere and nothing is created; the message names the date. The database also refuses overlapping instructor time blocks (an exclusion constraint), so a race between two publishes cannot slip through. Time blocks are half-open (`[start, end)`), so back-to-back groups (7:00 ending, 7:00 starting) never clash with each other.
5. **Write:** the activity (`service_types`); then for every group a cohort (`course_series`) with:
   - `name`, `cohort_label`, `session_count`, `capacity` (seats), `price_cents`, `child_price_cents`
   - `repeat_rule` — RRULE text, e.g. `FREQ=WEEKLY;BYDAY=MO,TU`, `FREQ=MONTHLY;BYDAY=4MO,4WE`, `FREQ=MONTHLY;BYMONTHDAY=23`, `FREQ=MONTHLY;BYDAY=-1FR`. Never `COUNT` or `UNTIL`: the session count governs. Null on Classes made before repeat existed, read as weekly on the days the sessions fall.
   - `allow_late_enrollment` — **off for weekly** (a course closes when it starts), **on for monthly** (a long run would otherwise empty after the first session).
   - `enrollment_closes_at` — *Minimum notice* before **that group's** first session, if set.
   - `status = PUBLISHED`

   and its sessions, each with an instructor time block if there is an instructor.
6. **Booking window:** the activity's `max_horizon_days` (booking opens that many days before a group's first session) defaults to far enough to reach the first session.
7. The **draft** the steps were saved in is deleted in the same transaction.

---

## 7. Editing

`getActivityAnswers` (reopening) and `editActivity` (saving), `activity.service.ts`.

### Reopening a Class
The answers are rebuilt from what is stored:
- **Days and repeat:** from the first group's `repeat_rule` (or, for an old Class with none, weekly on the days its sessions fall). A stored `FREQ=DAILY` opens as all seven days ticked.
- **Starts on:** the first session's date. **Until:** the last session of the last run, when there is more than one run.
- **Times:** each group's start, without repeats.
- **Skipped dates:** days the pattern passes through, up to Until, that have no session.
- **Session count:** the first group's, exactly. The form shows weeks (or months) worked out from it, but keeps the count unless the studio changes days, weeks or months — so saving an unchanged Class never moves its dates, even one whose count isn't days × weeks.

### Saving: runs are matched one by one
Instead of "all dates or nothing", every wanted group is matched to an existing cohort **by its exact session instants**:

| Outcome | When | What happens |
|---|---|---|
| **Kept** | a cohort has exactly this group's sessions | untouched dates; price, seats, instructor, place, label and booking deadline updated |
| **Added** | no cohort has this group's sessions | a no-longer-wanted, unbooked cohort is **reused** (its old sessions cancelled, new ones made, same id — so a one-run Class keeps its page link), or a new cohort is created |
| **Ended** | a cohort no group wants any more | its sessions are cancelled and the cohort is set `CANCELLED` |

**The lock is per run.** If a cohort that would be changed or ended has an active enrolment, a sold seat, or a session that has started, the save is refused: *"The run from 23 Nov has bookings, so its dates and times stay as they are. Add new runs after it instead."* Runs nobody has booked can still move or go.

New dates must be in the future. Seats can never go below what is already sold on any session still to come. Changing the instructor or place moves the time blocks of every session that stays, clash-checked.

### In the form
While anybody has booked, the Schedule step is greyed out **except Until**, with the note *"You can still add runs after the last one: choose a later Until date."* Moving Until later adds runs after the last one; the booked runs match as **kept** and are never touched.

Events keep their own one-date rule: their date can change only while nobody has booked and it hasn't started.

### Drafts
Every step after the first saves the answers as a draft (`activity_drafts`), never dates. A draft discarded elsewhere while the steps are open currently makes Publish fail with "Draft not found"; **PR #75** (open) makes Publish go ahead regardless and the autosave start a fresh draft.

---

## 8. What customers see

### Booking page (`/public/:slug/book` — `public/booking-page.ts` and `booking-page.client.ts`)
- **One card per Class.** A Class with one group keeps the plain card ("6 sessions · 23 Nov – 8 Dec · 8 places left"). A Class with several groups gets one card: *"6 sessions · 3 runs, from 23 Nov · 2 times: 6:00pm, 8:00pm · Choose a date"* (or *Choose a time* when there is one run).
- Clicking it opens a **calendar** (the same one drop-in classes use). Each group appears on its **join date**:
  - its first session, while it hasn't started;
  - for a group that has started and takes late joiners, its **next** session, shown as *"Joins in progress · N sessions left"*;
  - nowhere, once it can't be booked (full, closed, not yet open).
- Picking a time opens that group exactly as a one-group Class: details, seats, then free enrolment or Stripe checkout. **Back** returns to the calendar.
- A website link `…/book?service=<id>` goes straight to that picker.

### Website activity page (`public/storefront.ts`)
Shows the first group that can still be booked and its dates, plus *"3 runs to choose from"* and *"Runs at 6:00pm, 8:00pm. You pick your time when you book, and keep it for every session."*

### Booking a group
`enrollInSeries` / `createSeriesHold` / `convertSeriesHold` (`scheduling/series.service.ts`):
- **All sessions of the group are locked in order** (`ORDER BY series_index … FOR UPDATE`) so two buyers can't deadlock or oversell.
- The group is **full when its tightest session is full** — selling five of six weeks isn't something a studio can honour; the message names the week.
- One enrolment, one booking per session, a seat taken from every session at once. Paid checkout holds the seats for the whole group while the customer pays; the webhook converts the hold, and a repeated webhook finds the hold already spent.
- Cancelling an enrolment frees the seat on every session.

---

## 9. Dashboard

- **Activities:** one card per Class; Edit, Duplicate (copies everything but the dates) and Delete (removes every group and session; asks for the name).
- **Daily Manifest:** each session shows the Class name with a tag of its group's label and week, e.g. *Wheel Basics* `23 Nov · 6:00pm · week 2`.
- **Desk booking form:** Classes aren't booked there; it links each group's own page ("Wheel Basics · 23 Nov · 6:00pm" → `/courses/:id`), where a customer can be enrolled by hand.

---

## 10. Limits

| Limit | Value | Where |
|---|---|---|
| Weeks (Repeat weekly) | 1–52 | form |
| Months (Repeat monthly) | 1–24 | form |
| Sessions in one run | 52 | `MAX_SESSIONS`, schema |
| Times a day | 12 | `MAX_GROUPS` |
| Planner scan | 731 days (two years) | `MAX_DAYS_SCANNED` |
| Until | up to 366 days after Starts on | `MAX_RANGE_DAYS` |
| Runs | 52 | `MAX_RUNS` |
| Sessions in all (runs × times × sessions) | 600 | `MAX_CLASS_SESSIONS` |
| A time's end | before midnight (23:59) | `groupTimes` |
| Classes on the plan | Solo 1; Studio/Pro more | `billing/plan.ts` |

---

## 11. Where the code is

| What | File |
|---|---|
| Date planner, runs, times, RRULE text | `server/src/modules/activities/class-dates.ts` (+ client copy `client/src/lib/class-dates.ts`) |
| Request rules | `server/src/modules/activities/activity.schema.ts` |
| Publish, reopen, edit, preview, drafts | `server/src/modules/activities/activity.service.ts` |
| Clash check | `server/src/modules/activities/clashes.ts` |
| Plan limit | `server/src/modules/activities/class-limit.ts` |
| Wall clock → instant (DST) | `server/src/scheduling/time/zoned.ts` |
| Enrol, hold, checkout, cancel | `server/src/scheduling/series.service.ts` |
| Booking page card and picker | `server/src/modules/public/booking-page.ts`, `booking-page.client.ts` |
| Website pages | `server/src/modules/public/storefront.ts`, `storefront.service.ts` |
| The Schedule step | `client/src/components/CreateActivity.tsx` |
| Migration for the stored repeat | `server/prisma/migrations/20261116120000_class_repeat_rule` |
| Tests | `server/tests/admin/class-repeat.test.ts`, `class-groups.test.ts`, `class-runs.test.ts`, `activities.test.ts`, `activity-edit.test.ts` |
