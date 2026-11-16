# Repeat plan — Daily, Weekly, Monthly and time groups for Classes

**Status:** agreed with Suren 2026-11-16. **Part 1 built (local, uncommitted) 2026-11-16**: Daily / Weekly / Monthly, stored rule, Schedule step, editor round-trip; 19 tests in `tests/admin/class-repeat.test.ts`, all 99 Class tests pass; clicked through in the browser. Committed `c6c7202`. **Part 2 built (local, uncommitted) 2026-11-16**: groups per day with buffer, one card per Class on the booking page with a calendar time picker, website pages name the times, desk form links each time; 15 tests in `tests/admin/class-groups.test.ts`; clicked through locally (edit to 3 groups, booking page, time picker, Back, website link, phone).
**Branch:** `feat/class-repeat`.

## Decisions

| Question | Decision |
|---|---|
| Which activities repeat? | **Classes only.** Events stay single-date. |
| How is a Class sold? | **Whole run**, as today: one purchase covers every session. |
| Repeat options | **Daily**, **Weekly** (day chips, as today), **Monthly**. |
| Monthly — by what? | The studio chooses: **same date** ("the 7th of each month") or **same weekday** ("the first Monday", "the last Friday"). Default: same weekday. |
| Several times a day | **Groups per day**, with a **buffer** between groups. Each group is its own run with its own customers. |
| Plan limit | A Class with several groups counts as **1 Class**. Already true: `countRunningClasses` counts activities (`class-limit.ts:16`). |
| Keep it simple | No new pricing rules. No per-date booking of a Class. |

## Studio side — Create Class, Schedule step

- **Repeat:** Daily · Weekly · Monthly.
  - Weekly keeps the day chips. Daily needs nothing more.
  - Monthly shows two radio buttons, labelled from the start date: "On the 7th of each month" / "On the first Monday of each month". "Last" is offered when the start date is in the month's last week.
  - When a monthly date does not exist in a month (the 31st, a fifth Monday), the page says those months are skipped.
- **Sessions:** how many times the class meets, as today. The price covers all of them. Limits: 1–52, **Monthly 1–24** (the date planner scans two years, `class-dates.ts:43`).
- **Skipped dates** work as today: an unticked holiday adds a date at the end, so the session count holds.
- **Groups per day** (default 1, which is today's behaviour):
  - First start time, end time, number of groups, buffer (0 / 5 / 10 / 15 / 30 min or custom).
  - Times fill in and stay editable. 6:00–7:00, 5 groups, 15 min → 6:00 · 7:15 · 8:30 · 9:45 · 11:00.
  - Every group follows the same repeat, session count, price and seats.
- **Late joining:** the existing "allow joining after it starts" switch defaults **on** for Daily and Monthly, **off** for Weekly (as today). Same price either way.
- **Clashes:** every date of every group goes through the existing live clash check (instructor, and one-at-a-time locations) before Publish.

## Customer side — booking page

Reference: a month calendar where only bookable days are active, with time buttons under each day.

- **One card per Class**, however many groups it has (today `listPublicCourses` lists one entry per run — must be grouped by activity).
- **Calendar:** each group's **start date** is active, with its time button (6:00 AM, 7:15 AM …).
- Later sessions of a run (e.g. Mon 30 Nov when the run started 23 Nov) show **nothing** — they are not bookable on their own.
  - Exception: late joining on and the run has started → the next upcoming session shows "Join in progress · N sessions left".
  - Exception: another run of the activity starts that day → that run's button shows.
- **After picking:** summary — "6:00–7:00 AM · 3 sessions · Mon 23 Nov · Mon 30 Nov · Mon 7 Dec · $90 per person" → seats → pay once.
- **On booking (unchanged behaviour):** one enrolment, one booking per session, a seat taken from every session at once, one confirmation listing all dates. If any session is full the run shows Full. Cancelling cancels every session.

### Worked example

Class "Wheel Basics", Weekly, Mon, 3 sessions, starts on 20 Nov 2026, 6:00–7:00.

- 20 Nov 2026 is a Friday, so the first session is the first Monday on or after it: **Mon 23 Nov**. Sessions: 23 Nov, 30 Nov, 7 Dec.
- The calendar shows 6:00 AM on 23 Nov only. 30 Nov and 7 Dec are empty.
- A customer picking 23 Nov 6:00 AM is enrolled on all three Mondays and pays once.
- Another activity created for Mon 30 Nov 6:00:
  - same instructor → blocked ("Rowan Pike is teaching Wheel Basics 6–7am");
  - same one-at-a-time location → blocked;
  - otherwise → allowed, and 30 Nov shows a 6:00 AM button for the **new** activity only.

## Under the hood

- **Store the repeat as RRULE text** on the run (`course_series.repeat_rule`), e.g. `FREQ=WEEKLY;BYDAY=MO`, `FREQ=DAILY`, `FREQ=MONTHLY;BYMONTHDAY=7`, `FREQ=MONTHLY;BYDAY=1MO`, `FREQ=MONTHLY;BYDAY=-1FR`. No COUNT/UNTIL — `sessionCount` governs, as in `expandLocalDates`.
  - Why: the editor today rebuilds the pattern from the session dates (`activity.service.ts:562`), which only works for Weekly. Monthly dates look like a weekly pattern with skipped weeks.
  - One migration (`20261116120000_class_repeat_rule`). No backfill: null means Weekly on the days its sessions fall, which is how every earlier Class was made, and the editor reads it that way.
- **Dates:** `planClassDates` takes the repeat and keeps working in calendar dates, re-resolving each time in the studio zone (DST-safe, as now). Shared by preview and publish.
- **Schema:** `createClassSchema` / `previewSchema` gain the repeat; weekday chips required for Weekly only. Old drafts without a repeat load as Weekly.
- **Groups:** one `course_series` per group under the same activity (the model already allows several). All created in one transaction; one clash and nothing is created.
- **Buffer vs padding (as built):** the buffer only spaces the group times; padding is unchanged. An instructor's own groups cannot clash: Class sessions carry no padding and instructor time blocks are half-open (`[)`), so 7:00 ending and 7:00 starting do not overlap — tested with a 0-minute buffer.
- **Group times (as built):** worked out from the first time, the group count and the buffer, shown as "Groups start at 6:00pm · 7:15pm · 8:30pm", not editable one by one (kept simple). Each run's `cohort_label` is its time ("7:15pm"), which the Manifest, the booking page and the desk form already show.
- **Screens that assume one run per Class and must handle several:** editing (`getActivityAnswers`, `editActivity`), Duplicate, Delete activity, the dashboard Class page (`/courses/:id`, desk "Add someone"), the Activities list's schedule line, Daily Manifest and reports (label as "Wheel Basics · 7:15").
- **Editing:** a group's dates lock once it has bookings (`DATES_LOCKED`, as today). Groups with no bookings can be moved or removed.

## Order of work

1. **Repeat — Daily, Weekly, Monthly** (~1 day). Migration, date planner, schema, Schedule step, Review wording, editor round-trip.
2. **Groups per day + calendar picker** (~1.5–2 days). Several runs per Class, buffer, grouped booking-page card with the calendar, the screens listed above.

Each part: server tests, then a click-through in the browser locally (no client tests exist), then its own PR.

## Tests to write

- Daily / Weekly / Monthly (same date, nth weekday, last weekday) date generation.
- Monthly on the 31st and on a fifth Monday — months skipped, count still met.
- Skipped dates extend the run.
- A run crossing the 1 Nov daylight-saving change keeps its wall-clock time.
- Monthly over 24 sessions refused.
- Groups: times from start + buffer; instructor not clashing with own groups; one clash rolls back all groups.
- Plan limit: 5 groups count as 1 Class.
- Editing with and without bookings; old drafts load as Weekly; back-fill of existing Classes.

## Part 3 — Schedule step redesign (agreed with Suren 2026-11-16)

Replaces the Daily / Weekly / Monthly tabs and "Groups per day + buffer" on the Schedule step. Nothing about how a Class is sold changes.

- **Days:** the Mon–Sun chips are always shown. All seven ticked is what Daily was.
- **Times:** first start and end, then **+ Add another time** asks for a start only; every time keeps the first one's length. Each time is its own run, as before. No buffer field.
- **Repeat:** two checkboxes. **Repeat weekly → How many weeks**, **Repeat monthly → How many months**, then the "Each month" radio choices. Ticking one unticks the other. **Neither ticked = one week** on the ticked days.
- **Monthly on several days:** the week of the month comes from the start date, applied to every ticked day ("the fourth Monday and Wednesday"; "the last Monday and Wednesday"). "On the 23rd" is offered only with one day ticked.
- **Sessions** is no longer asked: days × weeks, or days × months (× 1 for "the 23rd"). Up to 52 per time.

Under the hood: the request carries `startTimes` (all starts, the first included) instead of `groups`/`bufferMinutes` (still accepted); monthly rules carry each day (`FREQ=MONTHLY;BYDAY=4MO,4WE`). No migration. Classes made with the earlier form reopen in the new one: Daily as all seven days, groups as a list of times, and the session count is kept exactly, so saving an unchanged class never moves its dates.

## Not in scope

- Per-date booking of a Class (that is the Event / older drop-in model).
- Moving a customer from one group to another (cancel and rebook for now).
- Late-join pricing.
