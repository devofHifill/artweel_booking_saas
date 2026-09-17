# Example Activity Data

Sample data for creating activities, with every field, a realistic value, and the rules the app enforces.

Use it as:
- a **filled-in reference** when entering an activity in the dashboard (**Activities → Create activity**)
- **sample data** for documentation, demos and testing
- the **request body** if you create activities through the API

---

## Contents

1. [Example 1: Group class, Pottery Wheel Throwing Party](#example-1-group-class--pottery-wheel-throwing-party)
2. [Example 2: One to one, Private Wheel Lesson](#example-2-one-to-one--private-wheel-lesson)
3. [Field reference](#field-reference)
4. [API request bodies](#api-request-bodies)
5. [Blank template](#blank-template)

---

## Example 1: Group class, Pottery Wheel Throwing Party

A 2-hour party at the studio. One host books several guests in a single booking.

### Basics

| Form label | Example value | API field |
|---|---|---|
| Activity name | `Pottery Wheel Throwing Party` | `name` |
| Short description | `A private wheel-throwing party for your group — clay, tools and firing included.` | `shortDescription` |
| Full description | *(see below)* | `description` |
| Type | **Group class** | `bookingMode`: `"EVENT"` |
| Category | Uncategorised | `categoryId`: `null` |
| Status | **Active** | `isActive`: `true` |

**Full description:**

```text
Celebrate with clay! Your group gets the studio's wheels and an instructor for two hours.

• 15 min — Welcome and a live wheel demo
• 75 min — Everyone at the wheel, with hands-on help
• 30 min — Pick your glazes and wrap up

Minimum 6 guests. Pieces are fired and ready to collect in about 2 weeks.
Great for birthdays, hen parties and team events.
```

### Pricing & capacity

| Form label | Example value | API field | API value |
|---|---|---|---|
| Adult price | `65.00` | `priceCents` | `6500` |
| Child price | `45.00` | `childPriceCents` | `4500` |
| Currency | USD | *(studio setting)* | — |
| Duration (minutes) | `120` | `durationMinutes` | `120` |
| Maximum capacity | `10` | `capacityMax` | `10` |
| Minimum guests | `6` | `capacityMin` | `6` |

### Where

| Form label | Example value | API field |
|---|---|---|
| Location | **The studio** | `locationId`: `"<location-uuid>"` |
| Meeting point | `Front entrance, ring the bell — we'll bring you to the wheel room` | `meetingPoint` |

### Availability *(creates the sessions when you save)*

| Form label | Example value | Sent as |
|---|---|---|
| Available days | **Sat, Sun** | `repeat.rrule`: `"FREQ=WEEKLY;BYDAY=SA,SU"` |
| Start times | `11:00`, `14:00`, `17:00` | one session request per start time: `localStartTime` |
| Schedule for | **The next 12 weeks** | `repeat.count`: `24` (2 days × 12 weeks) |

**Result:** 3 start times × 24 dates = **72 party sessions**.

### Presentation

| Form label | Example value | API field |
|---|---|---|
| Icon | `🎉` | `emoji` |
| Colour | `#A6522C` | `color` |
| *(second gradient colour)* | `#E07F4A` | `colorAccent` |

### Policies

| Form label | Example value | API field | API value |
|---|---|---|---|
| Cancellation policy | **Standard** | `cancellationPolicyId` | `"<policy-uuid>"` |
| Minimum notice (minutes) | `2880` (48 hours) | `minNoticeMinutes` | `2880` |
| Bookable up to (days ahead) | `90` | `maxHorizonDays` | `90` |
| Deposit | **Percentage, 25** *(only collected with Stripe)* | `depositType` / `depositValue` | `"percent"` / `25` |
| What is included | *(see below)* | `highlights` | one item per line |
| Before you come | *(see below)* | `preparationNotes` | text |
| Booking instructions | *(see below)* | `bookingInstructions` | text |

**What is included** (one per line, max 12 lines):

```text
All the clay you need
Tools and aprons
Glazing in your choice of colours
Kiln firing
An instructor for the whole party
```

**Before you come:**

```text
Keep nails short and wear closed shoes.
Wear clothes you don't mind getting muddy — clay washes out, but slowly.
Remove rings and bracelets before you start.
```

**Booking instructions** (sent with the confirmation, not shown before booking):

```text
Please arrive 10 minutes early so we can start on time.
Parking is at the rear of the building.
If the front door is locked, ring the top bell.
```

### After saving

| Step | Where | Value |
|---|---|---|
| Assign the instructor | **Staff & Guides** → instructor → activity chip | **Pottery Wheel Throwing Party**: on |
| Working hours | **Staff & Guides** → instructor → **Hours** | **Sat, Sun**, `10:00` → `20:00` |
| Instructor on sessions | **Activities → Scheduled classes** | Instructor: *(name)* |

---

## Example 2: One to one, Private Wheel Lesson

A private lesson booked by one person, with one instructor, inside that instructor's working hours.

| Form label | Example value | API field | API value |
|---|---|---|---|
| Activity name | `Private Wheel Lesson` | `name` | `"Private Wheel Lesson"` |
| Short description | `One to one at the wheel, at your own pace.` | `shortDescription` | text |
| Full description | `A focused hour with an instructor. Complete beginners welcome, or bring a technique you're stuck on.` | `description` | text |
| Type | **One to one** | `bookingMode` | `"APPOINTMENT"` |
| Status | **Active** | `isActive` | `true` |
| Price | `120.00` | `priceCents` | `12000` |
| Child price | *(hidden for One to one)* | `childPriceCents` | `0` |
| Duration (minutes) | `60` | `durationMinutes` | `60` |
| Maximum capacity | *(hidden, always 1)* | `capacityMax` | `1` |
| Minimum guests | *(hidden, always 1)* | `capacityMin` | `1` |
| Location | **The studio** | `locationId` | `"<location-uuid>"` |
| Meeting point | `Wheel room, second door on the left` | `meetingPoint` | text |
| Available days / Start times | **Leave empty.** Slots come from the instructor's working hours | — | — |
| Icon | `🏺` | `emoji` | `"🏺"` |
| Colour | `#6E3418` | `color` | `"#6E3418"` |
| Cancellation policy | **Standard** | `cancellationPolicyId` | `"<policy-uuid>"` |
| Minimum notice (minutes) | `1440` (24 hours) | `minNoticeMinutes` | `1440` |
| Bookable up to (days ahead) | `60` | `maxHorizonDays` | `60` |
| Deposit | None | `depositType` / `depositValue` | `"none"` / `0` |
| What is included | `Clay and tools` / `Firing of up to 2 pieces` | `highlights` | one per line |
| Before you come | `Short nails, closed shoes.` | `preparationNotes` | text |
| Booking instructions | `Ring the bell at the wheel room door.` | `bookingInstructions` | text |

**Required after saving:**

| Step | Where | Value |
|---|---|---|
| Assign the instructor | **Staff & Guides** → instructor → activity chip | **Private Wheel Lesson**: on |
| Working hours | **Staff & Guides** → instructor → **Hours** | e.g. **Tue–Fri**, `16:00` → `20:00` |
| Location link | *(no screen, see staff guide)* | Instructor linked to **The studio** |

---

## Field reference

All fields the activity accepts, with the rules the app enforces.

### Basics

| API field | Form label | Type | Required | Rules | Default |
|---|---|---|---|---|---|
| `name` | Activity name | text | ✅ | 1–120 characters | — |
| `shortDescription` | Short description | text | | max 200 | `null` |
| `description` | Full description | text | | max 4000 | — |
| `bookingMode` | Type | enum | | `EVENT` = Group class, `APPOINTMENT` = One to one, `COURSE_SERIES` = multi-week course (not in this form) | **API: `APPOINTMENT`** · Form: Group class |
| `categoryId` | Category | uuid | | Must belong to the studio | `null` |
| `isActive` | Status | boolean | | `true` = Active, `false` = Draft | `true` |

### Pricing & capacity

| API field | Form label | Type | Required | Rules | Default |
|---|---|---|---|---|---|
| `priceCents` | Adult price / Price | integer (**cents**) | | 0 – 100,000,000. `6500` = $65.00 | `0` |
| `childPriceCents` | Child price | integer (**cents**) | | 0 – 100,000,000. **`0` = adults only**. The form warns if it's above the adult price | `0` |
| `durationMinutes` | Duration (minutes) | integer | ✅ | 5 – 1440 | Form: `120` |
| `capacityMax` | Maximum capacity | integer | | 1 – 500. **Must be `1` for `APPOINTMENT`** | API: `1` · Form: `8` |
| `capacityMin` | Minimum guests | integer | | 1 – 500, and ≤ `capacityMax`. **Stored but not enforced when booking** | `1` |

### Where

| API field | Form label | Type | Required | Rules | Default |
|---|---|---|---|---|---|
| `locationId` | Location | uuid | | **Set it.** Sessions without a location don't show on the booking page | `null` |
| `meetingPoint` | Meeting point | text | | max 300 | `null` |

### Presentation

| API field | Form label | Type | Rules | Default |
|---|---|---|---|---|
| `emoji` | Icon | text | max 8 characters (one emoji) | `null` |
| `color` | Colour | hex | `#RRGGBB` | `#A6522C` |
| `colorAccent` | *(gradient)* | hex | `#RRGGBB`. `null` = a shade of `color` | `null` |

### Policies

| API field | Form label | Type | Rules | Default |
|---|---|---|---|---|
| `cancellationPolicyId` | Cancellation policy | uuid | Must belong to the studio | `null` (studio default) |
| `minNoticeMinutes` | Minimum notice (minutes) | integer | 0 – 525,600 | `0` |
| `maxHorizonDays` | Bookable up to (days ahead) | integer | 1 – 730 | `120` |
| `depositType` | Deposit | enum | `none`, `percent`, `fixed` | `none` |
| `depositValue` | Deposit value | integer | `percent`: 1–100. `fixed`: **cents**. Must be > 0 unless `none`. **Only collected with Stripe** | `0` |
| `highlights` | What is included | text | One item per line, **max 12 lines**, max 1200 characters | `null` |
| `preparationNotes` | Before you come | text | max 2000 | `null` |
| `bookingInstructions` | Booking instructions | text | max 2000. Sent with the confirmation only | `null` |

### API-only fields (not in the form)

| API field | Type | Rules | Default |
|---|---|---|---|
| `slotGranularityMinutes` | integer | 5 – 480. Step between One to one start times | `15` |
| `paddingBeforeMinutes` | integer | 0 – 480. Buffer before each booking | `0` |
| `paddingAfterMinutes` | integer | 0 – 480. Buffer after each booking | `0` |
| `staffPreference` | enum | `MANUAL`, `LEAST_BUSY`, `MOST_BUSY`, `ROUND_ROBIN` | `MANUAL` |
| `skillLevel` | text | max 40, e.g. `Beginner` | `null` |
| `prerequisiteServiceTypeId` | uuid | An activity that must be completed first | `null` |

### Validation errors you may see

| Message | Cause |
|---|---|
| *Minimum capacity cannot exceed maximum capacity.* | `capacityMin` > `capacityMax` |
| *A percentage deposit cannot exceed 100.* | `depositType: percent` with `depositValue` > 100 |
| *A deposit needs a value above zero.* | Deposit type set, value `0` |
| *Appointments are one-to-one; use EVENT for group classes.* | `APPOINTMENT` with `capacityMax` ≠ 1 |
| *Twelve highlights is the most a booking page will show.* | More than 12 lines in `highlights` |
| *Colour must be a hex value like #A6522C.* | Bad `color` / `colorAccent` |

---

## API request bodies

All requests need an Owner or Admin login:

```text
Authorization: Bearer <access-token>
Content-Type: application/json
```

Base path: `/api/organizations/<organization-id>`

### 1. Create the activity: Group class

`POST /api/organizations/<organization-id>/services`

```json
{
  "name": "Pottery Wheel Throwing Party",
  "shortDescription": "A private wheel-throwing party for your group — clay, tools and firing included.",
  "description": "Celebrate with clay! Your group gets the studio's wheels and an instructor for two hours.\n\n• 15 min — Welcome and a live wheel demo\n• 75 min — Everyone at the wheel, with hands-on help\n• 30 min — Pick your glazes and wrap up\n\nMinimum 6 guests. Pieces are fired and ready to collect in about 2 weeks.",
  "bookingMode": "EVENT",
  "categoryId": null,
  "isActive": true,

  "priceCents": 6500,
  "childPriceCents": 4500,
  "durationMinutes": 120,
  "capacityMax": 10,
  "capacityMin": 6,

  "locationId": "<location-uuid>",
  "meetingPoint": "Front entrance, ring the bell — we'll bring you to the wheel room",

  "emoji": "🎉",
  "color": "#A6522C",
  "colorAccent": "#E07F4A",

  "cancellationPolicyId": "<policy-uuid>",
  "minNoticeMinutes": 2880,
  "maxHorizonDays": 90,
  "depositType": "percent",
  "depositValue": 25,
  "highlights": "All the clay you need\nTools and aprons\nGlazing in your choice of colours\nKiln firing\nAn instructor for the whole party",
  "preparationNotes": "Keep nails short and wear closed shoes.\nWear clothes you don't mind getting muddy.\nRemove rings and bracelets before you start.",
  "bookingInstructions": "Please arrive 10 minutes early.\nParking is at the rear of the building.\nIf the front door is locked, ring the top bell."
}
```

**Response** `201`: `{ "service": { "id": "<service-uuid>", ... } }`

> ⚠️ Omitting `bookingMode` creates a **One to one** (`APPOINTMENT`) activity. Always send it.

### 2. Create the sessions: one request per start time

`POST /api/organizations/<organization-id>/sessions`

```json
{
  "serviceTypeId": "<service-uuid>",
  "startLocalDate": "2026-09-19",
  "localStartTime": "11:00",
  "capacity": 10,
  "locationId": "<location-uuid>",
  "staffId": "<staff-uuid>",
  "repeat": { "rrule": "FREQ=WEEKLY;BYDAY=SA,SU", "count": 24 }
}
```

Send it again with `"localStartTime": "14:00"`, then `"17:00"`.

| Field | Meaning |
|---|---|
| `startLocalDate` | First date to schedule from, **in the studio's timezone** |
| `localStartTime` | `HH:MM`, studio time |
| `capacity` | Seats in each session, 1–500, up to the activity's `capacityMax` |
| `locationId` | **Required in practice**: sessions without it don't show on the booking page |
| `staffId` | *Optional.* Instructor for these sessions. Saves assigning them one by one later |
| `timezone` | *Optional.* Defaults to the studio's timezone |
| `repeat.rrule` | Weekly days: `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU`. Don't put `COUNT` or `UNTIL` in it |
| `repeat.count` | Number of **sessions** (not weeks), **2–52**. Omit `repeat` for a single session |

**Response:** `{ "created": [ { "id": "<session-uuid>", ... }, ... ] }`

### 3. Assign instructors to the activity

`PUT /api/organizations/<organization-id>/services/<service-uuid>/staff`

```json
{ "staffIds": ["<staff-uuid>"] }
```

This **replaces** the whole list. Send every instructor who should teach it.

### 4. Create the activity: One to one

`POST /api/organizations/<organization-id>/services`

```json
{
  "name": "Private Wheel Lesson",
  "shortDescription": "One to one at the wheel, at your own pace.",
  "description": "A focused hour with an instructor. Complete beginners welcome, or bring a technique you're stuck on.",
  "bookingMode": "APPOINTMENT",
  "isActive": true,
  "priceCents": 12000,
  "childPriceCents": 0,
  "durationMinutes": 60,
  "capacityMax": 1,
  "capacityMin": 1,
  "slotGranularityMinutes": 30,
  "locationId": "<location-uuid>",
  "meetingPoint": "Wheel room, second door on the left",
  "emoji": "🏺",
  "color": "#6E3418",
  "cancellationPolicyId": "<policy-uuid>",
  "minNoticeMinutes": 1440,
  "maxHorizonDays": 60,
  "depositType": "none",
  "depositValue": 0,
  "highlights": "Clay and tools\nFiring of up to 2 pieces",
  "preparationNotes": "Short nails, closed shoes.",
  "bookingInstructions": "Ring the bell at the wheel room door."
}
```

Then assign the instructor (request 3). **No sessions needed**: slots come from the instructor's working hours.

### Finding the IDs

| ID | Request | Pick from |
|---|---|---|
| `<organization-id>` | — | Dashboard: stored as `bsaas.activeOrg` |
| `<location-uuid>` | `GET /api/organizations/<organization-id>/locations` | `locations[].id` |
| `<policy-uuid>` | `GET /api/organizations/<organization-id>/policies` | `policies[].id` (e.g. `name: "Standard"`) |
| `<staff-uuid>` | `GET /api/organizations/<organization-id>/staff` | `staff[].id` |
| `<service-uuid>` | Response of the create request | `service.id` |

---

## Blank template

Copy this and fill it in before creating a new activity.

```markdown
## Activity: ______________________

### Basics
| Field               | Value |
|---------------------|-------|
| Activity name       |       |
| Short description   |       |   (max 200)
| Full description    |       |   (max 4000)
| Type                |       |   Group class / One to one
| Category            |       |
| Status              |       |   Active / Draft

### Pricing & capacity
| Field               | Value |
|---------------------|-------|
| Adult price         |       |
| Child price         |       |   (0 = adults only; Group class only)
| Duration (minutes)  |       |   (5–1440)
| Maximum capacity    |       |   (Group class only; 1–500)
| Minimum guests      |       |   (Group class only; not enforced)

### Where
| Field               | Value |
|---------------------|-------|
| Location            |       |   (always set this)
| Meeting point       |       |   (max 300)

### Availability (Group class)
| Field               | Value |
|---------------------|-------|
| Available days      |       |
| Start times         |       |
| Schedule for        |       |   4 / 8 / 12 weeks

### Presentation
| Field               | Value |
|---------------------|-------|
| Icon                |       |
| Colour              |       |   (#RRGGBB)

### Policies
| Field                        | Value |
|------------------------------|-------|
| Cancellation policy          |       |
| Minimum notice (minutes)     |       |
| Bookable up to (days ahead)  |       |   (must cover the schedule)
| Deposit                      |       |   None / % / fixed (needs Stripe)
| What is included             |       |   (one per line, max 12)
| Before you come              |       |
| Booking instructions         |       |

### After saving
| Step                    | Value |
|-------------------------|-------|
| Instructor(s) assigned  |       |
| Instructor hours        |       |
| Instructor on sessions  |       |   (Group class)
| Tested on booking page  |       |
```
