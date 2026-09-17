# Example Staff Data

Sample data for adding staff, with every field, a realistic value, and the rules the app enforces.

Use it as:
- a **filled-in reference** when adding staff in the dashboard (**Staff & Guides → Add staff**)
- **sample data** for documentation, demos and testing
- the **request bodies** if you set staff up through the API

> See also: [user-guide-staff.md](user-guide-staff.md) for the step-by-step guide and known issues.

---

## Contents

1. [Example 1: Instructor (teaches classes and private lessons)](#example-1-instructor)
2. [Example 2: Weekend instructor with exceptions](#example-2-weekend-instructor-with-exceptions)
3. [Example 3: Front desk (dashboard login, doesn't teach)](#example-3-front-desk)
4. [Example 4: Back-office instructor (hidden from customers)](#example-4-back-office-instructor-hidden-from-customers)
5. [Field reference](#field-reference)
6. [API request bodies](#api-request-bodies)
7. [Blank template](#blank-template)

---

## Example 1: Instructor

Teaches group classes and one-to-one lessons, and signs in to see their classes.

### Staff record (Staff & Guides → Add staff)

| Form label | Example value | API field | API value |
|---|---|---|---|
| Name | `Maya Patel` | `name` | `"Maya Patel"` |
| Email | `maya@galaxyempire.studio` | `email` | `"maya@galaxyempire.studio"` |
| Phone | `+1 555 010 2233` | `phone` | `"+15550102233"` |
| Role | `Wheel instructor` | `role` | `"Wheel instructor"` |
| Calendar colour | `#4F46E5` | `color` | `"#4F46E5"` |
| Max bookings a day | `6` | `maxBookingsPerDay` | `6` |
| Show on the booking page | ✅ On | `isPublic` | `true` |
| *(API only)* Bio | — | `bio` | `"Maya has thrown pots for twelve years and loves teaching first-timers."` |
| *(API only)* Photo | — | `photoUrl` | `"https://example.com/staff/maya.jpg"` |
| *(API only)* Timezone | — | `timezone` | **the studio's timezone**, e.g. `"America/New_York"` |

### Activities they teach (activity chips on their card)

| Activity | Chip |
|---|---|
| Pottery Wheel Throwing Party | ✅ On |
| Private Wheel Lesson | ✅ On |
| Handbuilding Workshop | ⬜ Off |

### Location link *(no screen, see [known issue 1](user-guide-staff.md#2-before-you-start-known-issues))*

| Location | Linked |
|---|---|
| The studio | ✅ |

### Working hours (card → Hours → "When Maya Patel works")

| Days | From | Until | API `rrule` | `startMinute` | `endMinute` |
|---|---|---|---|---|---|
| Tue, Wed, Thu, Fri | `16:00` | `20:00` | `FREQ=WEEKLY;BYDAY=TU,WE,TH,FR` | `960` | `1200` |
| Sat, Sun | `10:00` | `20:00` | `FREQ=WEEKLY;BYDAY=SA,SU` | `600` | `1200` |

### Sessions they're on (Activities → Scheduled classes)

| Activity | Day | Start | Instructor |
|---|---|---|---|
| Pottery Wheel Throwing Party | Sat | 11:00 | Maya Patel |
| Pottery Wheel Throwing Party | Sat | 14:00 | Maya Patel |
| Pottery Wheel Throwing Party | Sun | 17:00 | Maya Patel |

### Dashboard login (Settings → Users & Permissions → Invite somebody)

| Form label | Example value | API field |
|---|---|---|
| Name | `Maya Patel` | `name` |
| Email | `maya@galaxyempire.studio` *(same as the staff record)* | `email` |
| Role | **Instructor** | `role`: `"INSTRUCTOR"` |

---

## Example 2: Weekend instructor with exceptions

Works weekends only, has a holiday booked, and does one extra evening.

### Staff record

| Form label | Example value |
|---|---|
| Name | `Leo Martins` |
| Email | `leo@galaxyempire.studio` |
| Phone | *(empty)* |
| Role | `Party host` |
| Calendar colour | `#0EA5E9` |
| Max bookings a day | `0` *(unlimited)* |
| Show on the booking page | ✅ On |

### Activities they teach

| Activity | Chip |
|---|---|
| Pottery Wheel Throwing Party | ✅ On |

### Working hours

| Days | From | Until | `rrule` | `startMinute` | `endMinute` |
|---|---|---|---|---|---|
| Sat, Sun | `10:00` | `19:00` | `FREQ=WEEKLY;BYDAY=SA,SU` | `600` | `1140` |

### Days off and exceptions

| What | Date | From | Until | Reason | API `overrideType` |
|---|---|---|---|---|---|
| **Day off** | `2026-10-10` | — | — | `Family wedding` | `DAY_OFF` |
| **Day off** | `2026-10-11` | — | — | `Family wedding` | `DAY_OFF` |
| **Different hours** | `2026-10-17` | `13:00` | `19:00` | `Morning appointment` | `CUSTOM_HOURS` |
| **Extra hours** | `2026-10-22` | `17:00` | `21:00` | `Corporate party (Thursday)` | `EXTRA_HOURS` |

> A **Day off** is refused if they already have sessions that day. Move or cancel those first.

---

## Example 3: Front desk

Takes bookings and payments at the counter and **doesn't teach**, so they need a **login only, no staff record**.

### Staff record
**None.** Don't add them on Staff & Guides. A staff record would count towards your plan's instructor limit, and without activities or hours it can't be booked anyway.

### Dashboard login (Settings → Users & Permissions → Invite somebody)

| Form label | Example value | API field |
|---|---|---|
| Name | `Sam Okafor` | `name` |
| Email | `sam@galaxyempire.studio` | `email` |
| Role | **Front desk** | `role`: `"FRONT_DESK"` |

**What Front desk can do:** bookings, customers and payments. It can't change how the studio runs.

---

## Example 4: Back-office instructor (hidden from customers)

Covers classes when needed but isn't shown by name on the booking page.

### Staff record

| Form label | Example value | API field | API value |
|---|---|---|---|
| Name | `Priya Shah` | `name` | `"Priya Shah"` |
| Email | `priya@galaxyempire.studio` | `email` | `"priya@galaxyempire.studio"` |
| Role | `Studio manager` | `role` | `"Studio manager"` |
| Calendar colour | `#64748B` | `color` | `"#64748B"` |
| Max bookings a day | `2` | `maxBookingsPerDay` | `2` |
| Show on the booking page | ⬜ **Off** | `isPublic` | `false` |

### Activities they teach

| Activity | Chip |
|---|---|
| Handbuilding Workshop | ✅ On |

### Working hours

| Days | From | Until | `rrule` | `startMinute` | `endMinute` |
|---|---|---|---|---|---|
| Mon | `09:00` | `17:00` | `FREQ=WEEKLY;BYDAY=MO` | `540` | `1020` |

### Dashboard login

| Form label | Example value |
|---|---|
| Role | **Admin** *(everything except billing and removing owners)* |

---

## Field reference

### Staff record

| API field | Form label | Type | Required | Rules | Default |
|---|---|---|---|---|---|
| `name` | Name | text | ✅ | 1–120 characters | — |
| `email` | Email | email | ✅ | max 255. **Unique within the studio**. Stored in lowercase. Never shown publicly | — |
| `phone` | Phone | text | | max 32. Never shown publicly | `null` |
| `role` | Role | text | | max 80. The line under their name, 2–3 words | `null` |
| `color` | Calendar colour | hex | | `#RRGGBB` | `#A6522C` |
| `maxBookingsPerDay` | Max bookings a day | integer | | 0–100. **`0` = unlimited** | `0` |
| `isPublic` | Show on the booking page | boolean | | `false` = hidden from customers | `true` |
| `isActive` | *(Deactivate / Reactivate)* | boolean | | `false` = deactivated | `true` |
| `bio` | *(API only)* | text | | max 4000 | `null` |
| `photoUrl` | *(API only)* | URL | | max 1000 | `null` |
| `timezone` | *(API only)* | IANA zone | | e.g. `America/New_York`, `Asia/Kolkata`. **Working hours are saved in this timezone** | **`America/New_York`** (not the studio's) |

### Activities they teach

| API field | Form | Type | Rules |
|---|---|---|---|
| `serviceTypeIds` | Activity chips | uuid[] | max 200. **Replaces the whole list.** An empty list means "Not bookable yet" |

### Location link

| API field | Form | Type | Rules |
|---|---|---|---|
| `locationIds` | *(no screen)* | uuid[] | max 200. **Replaces the whole list.** Needed for One to one activities |

### Working hours

| API field | Form label | Type | Required | Rules | Default |
|---|---|---|---|---|---|
| `ruleType` | — | enum | | `WORKING` (the form only creates these), `BREAK` | `WORKING` |
| `rrule` | Days | text | ✅ | `FREQ=WEEKLY;BYDAY=` + day codes | — |
| `startMinute` | From | integer | ✅ | Minutes after midnight, 0–2880 | — |
| `endMinute` | Until | integer | ✅ | Minutes after midnight, 1–2880 | — |
| `timezone` | — | IANA zone | | | **the staff member's timezone** |
| `locationId` | — | uuid | | Limits these hours to one location | `null` |
| `effectiveFrom` | — | date | ✅ | When the hours start | Form: now |
| `effectiveUntil` | — | date | | When they stop | `null` (open-ended) |

**Day codes:** `MO` `TU` `WE` `TH` `FR` `SA` `SU`

**Time → minutes:**

| Time | Minutes | | Time | Minutes |
|---|---|---|---|---|
| 08:00 | `480` | | 15:00 | `900` |
| 09:00 | `540` | | 16:00 | `960` |
| 10:00 | `600` | | 17:00 | `1020` |
| 11:00 | `660` | | 18:00 | `1080` |
| 12:00 | `720` | | 19:00 | `1140` |
| 13:00 | `780` | | 20:00 | `1200` |
| 14:00 | `840` | | 21:00 | `1260` |

Formula: `hours × 60 + minutes`. For example, 16:30 = `16 × 60 + 30` = `990`.

### Days off and exceptions

| API field | Form label | Type | Required | Rules |
|---|---|---|---|---|
| `overrideType` | What | enum | ✅ | `DAY_OFF` = Day off, `CUSTOM_HOURS` = Different hours, `EXTRA_HOURS` = Extra hours |
| `localDate` | Date | `YYYY-MM-DD` | ✅ | In the staff member's timezone |
| `startMinute` | From | integer | Different/Extra hours only | 0–2880. **Must be empty for Day off** |
| `endMinute` | Until | integer | Different/Extra hours only | 1–2880. **Must be empty for Day off** |
| `reason` | Reason | text | | max 500. Shown on their card, e.g. "Away — holiday" |

### Dashboard login (invitation)

| API field | Form label | Type | Required | Rules |
|---|---|---|---|---|
| `name` | Name | text | ✅ | 1–120 |
| `email` | Email | email | ✅ | max 255 |
| `role` | Role | enum | ✅ | `ADMIN`, `INSTRUCTOR`, `FRONT_DESK`. **`OWNER` isn't allowed.** Change the role after they accept |

| Role | Can do |
|---|---|
| **Admin** | Everything except billing and removing owners |
| **Instructor** | Their own classes, the manifest, and taking the register |
| **Front desk** | Bookings, customers and payments. Can't change how the studio runs |

### Errors you may see

| Message | Cause |
|---|---|
| *The Solo plan includes 1 instructors. Upgrade to Studio to add more.* | Plan limit reached on active staff |
| *A staff member with that email already exists at this studio.* | Duplicate email |
| *A day off cannot carry a time window.* | Day off sent with From/Until |
| *[Name] has taught classes, so their record has to be kept.* | Tried to remove someone with history. Deactivate instead |
| *One or more locations were not found.* | A `locationIds` entry isn't in this studio |
| *Staff member not found.* | Wrong staff ID, or another studio's |

---

## API request bodies

All requests need a login:

```text
Authorization: Bearer <access-token>
Content-Type: application/json
```

Base path: `/api/organizations/<organization-id>`

| Request | Who can call it |
|---|---|
| Create, edit, assign, locations, working hours | Owner / Admin |
| Days off and exceptions | Owner / Admin, **or the staff member themselves** |
| Invitations | Owner / Admin |

### 1. Create the staff record

`POST /api/organizations/<organization-id>/staff`

```json
{
  "name": "Maya Patel",
  "email": "maya@galaxyempire.studio",
  "phone": "+15550102233",
  "role": "Wheel instructor",
  "bio": "Maya has thrown pots for twelve years and loves teaching first-timers.",
  "photoUrl": "https://example.com/staff/maya.jpg",
  "timezone": "America/New_York",
  "color": "#4F46E5",
  "isPublic": true,
  "maxBookingsPerDay": 6
}
```

> ⚠️ **Always send `timezone`** set to the studio's timezone. If it's omitted, the staff member gets `America/New_York`, and their working hours are saved in it.

**Response** `201`: `{ "staff": { "id": "<staff-uuid>", ... } }`

### 2. Assign the activities they teach

`PUT /api/organizations/<organization-id>/staff/<staff-uuid>/services`

```json
{
  "serviceTypeIds": [
    "<pottery-wheel-throwing-party-uuid>",
    "<private-wheel-lesson-uuid>"
  ]
}
```

Replaces the whole list. The same link can also be set from the activity side: `PUT /services/<service-uuid>/staff` with `{ "staffIds": [...] }`.

### 3. Link them to a location

`PUT /api/organizations/<organization-id>/staff/<staff-uuid>/locations`

```json
{ "locationIds": ["<the-studio-location-uuid>"] }
```

Replaces the whole list. **Required for One to one activities.**

### 4. Add working hours: one request per block

`POST /api/organizations/<organization-id>/schedules/<staff-uuid>/rules`

```json
{
  "ruleType": "WORKING",
  "rrule": "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR",
  "startMinute": 960,
  "endMinute": 1200,
  "effectiveFrom": "2026-09-17T00:00:00.000Z"
}
```

```json
{
  "ruleType": "WORKING",
  "rrule": "FREQ=WEEKLY;BYDAY=SA,SU",
  "startMinute": 600,
  "endMinute": 1200,
  "effectiveFrom": "2026-09-17T00:00:00.000Z"
}
```

**Response** `201`: `{ "rule": { "id": "<rule-uuid>", ... } }`
Remove one with `DELETE /schedules/<staff-uuid>/rules/<rule-uuid>`.

### 5. Days off and exceptions: one request each

`POST /api/organizations/<organization-id>/schedules/<staff-uuid>/overrides`

**Day off** (no times):

```json
{
  "overrideType": "DAY_OFF",
  "localDate": "2026-10-10",
  "reason": "Family wedding"
}
```

**Different hours:**

```json
{
  "overrideType": "CUSTOM_HOURS",
  "localDate": "2026-10-17",
  "startMinute": 780,
  "endMinute": 1140,
  "reason": "Morning appointment"
}
```

**Extra hours:**

```json
{
  "overrideType": "EXTRA_HOURS",
  "localDate": "2026-10-22",
  "startMinute": 1020,
  "endMinute": 1260,
  "reason": "Corporate party (Thursday)"
}
```

**Response** `201`: `{ "override": { "id": "<override-uuid>", ... } }`
Remove one with `DELETE /schedules/<staff-uuid>/overrides/<override-uuid>`.

### 6. Edit, deactivate or reactivate

`PATCH /api/organizations/<organization-id>/staff/<staff-uuid>`

Send only the fields that change:

```json
{ "role": "Senior wheel instructor", "maxBookingsPerDay": 8 }
```

```json
{ "isActive": false }
```

```json
{ "isActive": true }
```

### 7. Remove (only if they have no history)

`DELETE /api/organizations/<organization-id>/staff/<staff-uuid>`

Refused with `STAFF_IN_USE` if they've ever had a booking, session or course. Deactivate instead.

### 8. Invite a dashboard login

`POST /api/organizations/<organization-id>/invitations`

```json
{
  "name": "Maya Patel",
  "email": "maya@galaxyempire.studio",
  "role": "INSTRUCTOR"
}
```

**Response** `201`:

```json
{
  "invitation": { "id": "<invitation-uuid>", "status": "PENDING", "...": "..." },
  "inviteUrl": "https://app.bookaihub.com/invite/<token>"
}
```

Send `inviteUrl` to them yourself if the email doesn't arrive.
Revoke with `DELETE /api/organizations/<organization-id>/invitations/<invitation-uuid>`.

### Finding the IDs

| ID | Request | Pick from |
|---|---|---|
| `<organization-id>` | — | Dashboard: stored as `bsaas.activeOrg` |
| `<staff-uuid>` | `GET /api/organizations/<organization-id>/staff?includeInactive=true` | `staff[].id` |
| `<service-uuid>` | `GET /api/organizations/<organization-id>/services` | `services[].id` |
| `<location-uuid>` | `GET /api/organizations/<organization-id>/locations` | `locations[].id` |
| `<rule-uuid>` | `GET /api/organizations/<organization-id>/schedules/<staff-uuid>/rules` | `rules[].id` |
| `<override-uuid>` | `GET /api/organizations/<organization-id>/schedules/<staff-uuid>/overrides` | `overrides[].id` |

### Recommended order

1. Create the staff record, **with `timezone`**.
2. Link them to the location.
3. Assign activities.
4. Add working hours. **Only after the timezone is right**, because hours keep the timezone they were created with.
5. Add days off and exceptions.
6. Put them on sessions (see [example-activity-data.md](example-activity-data.md), `staffId` on sessions).
7. Invite a login, if needed.
8. Test on the booking page.

---

## Blank template

Copy this and fill it in for each new staff member.

```markdown
## Staff member: ______________________

### Staff record
| Field                     | Value |
|---------------------------|-------|
| Name                      |       |   (required, max 120)
| Email                     |       |   (required, unique in studio)
| Phone                     |       |   (optional, not public)
| Role                      |       |   (2–3 words)
| Calendar colour           |       |   (#RRGGBB)
| Max bookings a day        |       |   (0 = unlimited)
| Show on the booking page  |       |   Yes / No
| Timezone                  |       |   (set to the studio's — no screen)

### Activities they teach
| Activity                  | Yes/No |
|---------------------------|--------|
|                           |        |
|                           |        |

### Location link (no screen — needed for One to one)
| Location                  | Yes/No |
|---------------------------|--------|
|                           |        |

### Working hours
| Days          | From  | Until |
|---------------|-------|-------|
|               |       |       |
|               |       |       |

### Days off and exceptions
| What (Day off / Different / Extra) | Date | From | Until | Reason |
|------------------------------------|------|------|-------|--------|
|                                    |      |      |       |        |

### Sessions they're on (Group classes)
| Activity      | Day | Start | 
|---------------|-----|-------|
|               |     |       |

### Dashboard login (optional)
| Field    | Value |
|----------|-------|
| Invite?  |       |   Yes / No
| Role     |       |   Admin / Instructor / Front desk

### Checks
| Check                                  | Done |
|----------------------------------------|------|
| Card is not "Not bookable yet"         |      |
| Card is not "No hours set"             |      |
| Appears on booking page (if public)    |      |
| Slots show at the correct local time   |      |
```
