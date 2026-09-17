# Managing Staff — User Guide

How to add staff members, make them bookable, give them a dashboard login, and deactivate or remove them.

> **Where things live**
> - **Dashboard:** `https://app.bookaihub.com`
> - **Public booking page:** `https://bookaihub.com/public/<your-studio-slug>`
>
> Staging equivalents: `https://app.artweel.fillforge.cloud` and `https://artweel.fillforge.cloud`.

---

## Contents

1. [Staff vs. Team: two different lists](#1-staff-vs-team-two-different-lists)
2. [Before you start: known issues](#2-before-you-start-known-issues)
3. [Part A: Create the staff record](#part-a-create-the-staff-record)
4. [Part B: Make them bookable](#part-b-make-them-bookable)
5. [Part C: Put them on classes](#part-c-put-them-on-classes)
6. [Part D: Give them a login (optional)](#part-d-give-them-a-login-optional)
7. [Part E: Test](#part-e-test)
8. [Editing a staff member](#editing-a-staff-member)
9. [Deactivating or removing someone](#deactivating-or-removing-someone)
10. [The Staff & Guides page at a glance](#the-staff--guides-page-at-a-glance)
11. [Plan limits](#plan-limits)
12. [Troubleshooting](#troubleshooting)
13. [Internal notes: remove before publishing](#internal-notes-remove-before-publishing)

---

## 1. Staff vs. Team: two different lists

| | **Staff** | **Team** |
|---|---|---|
| **Where** | **Staff & Guides** | **Settings → Users & Permissions** |
| **What it is** | People you schedule and customers can book | People who can **sign in** to the dashboard |
| **Needed to teach?** | ✅ Yes | ❌ No |
| **Needed to sign in?** | ❌ No | ✅ Yes |

An instructor who only teaches needs a **staff record** and nothing else. Someone who also needs to see the dashboard needs **both**.

---

## 2. Before you start: known issues

> ⚠️ Staff added with **Add staff** can end up **impossible to book, or booked at the wrong times**, because of the issues below. The instructor created by **Set up my studio** isn't affected: setup gives them the studio's timezone and links them to the studio's location.

| # | Issue | Who it affects | Workaround |
|---|---|---|---|
| 1 | **New staff aren't linked to any location, and no screen can link them.** The booking page selects a location, and **One to one** activities only offer staff linked to that location. | **One to one** activities. Group classes aren't affected | Ask your platform admin to link the staff member to the location (see [Internal notes](#internal-notes-remove-before-publishing)) |
| 2 | **New staff get the timezone *America/New_York*, and no screen can change it.** Their working hours are saved in that timezone. | Studios **not** on US Eastern time | Ask your platform admin to set the staff member's timezone **before** you add working hours. Hours added earlier keep the old timezone |
| 3 | **Accepting a login invitation doesn't connect the login to the staff record.** | Staff who sign in | Their **My schedule** page shows nothing. The rest of the dashboard works for their role |

---

## Part A: Create the staff record

### Step 1: Open the form
**Staff & Guides → Add staff**

Only an **Owner** or **Admin** sees this button.

### Step 2: Fill in the details

| Field | Required | Notes |
|---|---|---|
| **Name** | ✅ | Shown to customers |
| **Email** | ✅ | Must be unique within the studio. **Never shown publicly** |
| Phone | | Optional. **Never shown publicly** |
| Role | | The line under their name, 2–3 words, e.g. `Wheel instructor` |
| Calendar colour | | Colour of their sessions on your calendar |
| Max bookings a day | | `0` = unlimited |
| **Show on the booking page** | | **On**: customers see them and can pick them. **Off**: hidden from customers, but still usable behind the scenes |

### Step 3: Save
They now appear on the page marked **No hours set**.

---

## Part B: Make them bookable

### Step 4: Assign activities
On their card, **click each activity chip** they teach so it turns on.

> If no chip is on, the card shows **"Not bookable yet"**, and **nothing can be booked with them**.

### Step 5: Link them to a location
*Required for **One to one** activities.*

There's currently no screen for this (known issue 1). Ask your platform admin to link them to your location.

### Step 6: Check their timezone
*Required if your studio isn't on US Eastern time.*

There's currently no screen for this (known issue 2). Ask your platform admin to set their timezone to the studio's **before step 7**.

### Step 7: Set working hours
On their card, click **Hours**. This opens **"When [name] works"**.

1. Tick the **days**.
2. Set **From** and **Until**.
3. Add the block.
4. Repeat for different patterns, e.g. Sat–Sun 10:00–20:00, then Tue–Fri 16:00–20:00.

> **Cover the whole activity.** A 2-hour activity starting at 17:00 needs them working until **at least 19:00**.
>
> **One to one** activities are only offered inside these hours.

### Step 8: Days off and exceptions
In the same panel, under **Days off and exceptions**:

| What | Effect |
|---|---|
| **Day off** | Unavailable all day on that date |
| **Different hours** | Replaces their normal hours on that date |
| **Extra hours** | Adds hours on top of their normal ones |

Pick **What**, the **Date**, and the **From / Until** times where needed, then add it.

> A **Day off** is refused if they already have sessions that day. Move or cancel those first.
>
> Staff who sign in can add their own days off from **My schedule**. Their weekly hours can only be changed by an Owner or Admin. (Blocked for now by known issue 3.)

---

## Part C: Put them on classes

### Step 9: Group classes: assign them to sessions
- **Existing sessions:** **Activities → Scheduled classes**, then set the **Instructor**.
- **New sessions:** **Activities → Schedule a class → Instructor**.

The **Unassigned this week** tile on Staff & Guides counts sessions that have nobody assigned.

### Step 10: One to one activities
Nothing else to do once steps 4–7 are done. The booking page offers time slots inside their working hours.

---

## Part D: Give them a login (optional)

Only needed if they should sign in to the dashboard.

### Step 11: Invite them
**Settings → Users & Permissions → Invite somebody**

| Field | Notes |
|---|---|
| Name | Their name |
| Email | Use the **same email** as their staff record |
| Role | See the table below |

| Role | Can do |
|---|---|
| **Admin** | Everything except billing and removing owners |
| **Instructor** | Their own classes, the manifest, and taking the register |
| **Front desk** | Bookings, customers and payments. Can't change how the studio runs |

Click **Send invitation**.

### Step 12: Make sure it reaches them
- Studio emails often land in spam, so the screen also shows a **link you can copy and send yourself**.
- The invitation stays under **Waiting to accept** until they accept it.

> **Owner** can't be chosen when inviting. Invite them first, then change their role once they've accepted.

---

## Part E: Test

### Step 13: Check the booking page
Open `https://bookaihub.com/public/<your-studio-slug>`.

| Activity type | What to check |
|---|---|
| **One to one** | Pick the activity. The staff member appears (if **Show on the booking page** is on), with time slots inside their hours, **at the correct local time** |
| **Group class** | Open a session they're assigned to. It books normally |

Then check **Bookings** in the dashboard, and cancel the booking if it was a test.

---

## Editing a staff member

**Staff & Guides → their card → Edit**

You can change: Name, Email, Phone, Role, Calendar colour, Max bookings a day, Show on the booking page.

- Their activities are changed with the chips (Step 4).
- Their hours are changed with **Hours** (Step 7).
- **Location and timezone can't be changed here** (known issues 1 and 2).

---

## Deactivating or removing someone

| Action | When it's allowed | Effect |
|---|---|---|
| **Remove** | Only if they've **never** had a booking, a session or a course | Deleted permanently. Can't be undone |
| **Deactivate** | Always | Hidden from availability and the booking page. History kept. **Frees a plan slot**. Can be reactivated |
| **Reactivate** | Any deactivated staff member | Bookable again, if your plan has a free slot |

- If you try to remove someone with history, the dashboard explains why it can't and **offers to deactivate them instead**.
- On deactivation you'll see: *"[Name] is deactivated and will not appear in availability."*

> Deactivating a staff member doesn't remove their **login**. Remove them from **Settings → Users & Permissions** separately if needed.

---

## The Staff & Guides page at a glance

### Summary tiles

| Tile | Meaning |
|---|---|
| **Team members** | Staff on the list |
| **Teaching today** | Staff with sessions today |
| **Classes this week** | Sessions scheduled this week |
| **Unassigned this week** | Sessions with no instructor. **This is the one to act on** |

### Status filter

| Status | Meaning |
|---|---|
| **Available** | Active, with working hours |
| **Away today** | Has a day off today |
| **No hours set** | Active but no working hours, so they can't be booked for One to one |
| **Deactivated** | Switched off |

### Views
Switch between **Cards** and **Table**.

---

## Plan limits

| Plan | Active staff |
|---|---|
| **SOLO** (default for new studios) | 1 |
| **STUDIO** | 5 |
| **PRO** | Unlimited |

- Only **active** staff count towards the limit. Deactivating someone frees a slot.
- **Downgrading never deactivates anyone.** You keep your existing staff, but can't add more until you're under the limit.
- A **new** studio already uses its SOLO slot on the instructor created by **Set up my studio**. Edit that instructor rather than adding another.
- Upgrade in **Billing**. These are the default limits and can be changed by the platform admin.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"The Solo plan includes 1 instructors. Upgrade to Studio to add more."* | Plan limit reached | Upgrade, or deactivate someone |
| *"A staff member with that email already exists at this studio."* | Duplicate email | Use a different email, or edit the existing record |
| No **Add staff** button | You're not an Owner or Admin | Ask an Owner or Admin |
| Card says **Not bookable yet** | No activities assigned | Step 4 |
| Card says **No hours set** | No working hours | Step 7 |
| Missing from **One to one** on the booking page | Not linked to the location | Step 5 (known issue 1) |
| Time slots at strange times | Staff timezone is America/New_York | Step 6, then delete and re-add their hours |
| Not shown by name on the booking page | **Show on the booking page** is off | Edit and turn it on |
| Only some of their hours are offered | Activity is longer than the remaining hours, or **Minimum notice** hides near slots | Extend their hours, or lower the activity's minimum notice |
| Can't mark a day off | They have sessions that day | Move or cancel those sessions first |
| Can't remove them | They have booking or session history | Deactivate instead |
| Invitation never arrived | Email in spam | Copy the invitation link and send it yourself |
| Their **My schedule** is empty | Login isn't linked to the staff record | Known issue 3 |

---

## Internal notes: remove before publishing

These are for the platform team, not for studios.

### Code references

| Issue | Where |
|---|---|
| New staff have no location link | `client/src/pages/Staff.tsx` sends no `locationIds`. The only writer is `PUT /api/organizations/:orgId/staff/:staffId/locations`, which has no UI. Availability filters on `staffLocations` whenever `locationId` is in the query: `server/src/scheduling/availability/availability.service.ts` (`getAppointmentAvailability`). The booking page always sends `locationId` when it selects a location: `server/src/modules/public/booking-page.client.ts` (`pickService`, `showTimes`) |
| New staff default to America/New_York | `createStaffSchema` in `server/src/modules/staff/staff.route.ts` defaults `timezone` to `America/New_York`, and the form doesn't send one. Working hours rules copy `staff.timezone` at creation: `server/src/modules/schedules/schedule.service.ts` |
| Login not linked to staff | Accepting an invitation creates a membership only: `server/src/modules/organizations/invitation.service.ts`. Nothing ever sets `staff.userId`. `client/src/pages/MySchedule.tsx` finds the record by `userId` |
| Seeded instructor unaffected | `seedPotteryDefaults` in `server/src/modules/onboarding/onboarding.service.ts` sets `timezone: org.timezone` and creates a `staffLocation` |

### Manual workaround (admin, until fixed)
Run while signed in to the dashboard as an Owner or Admin, from the browser console on the dashboard origin.

```js
const org  = localStorage.getItem('bsaas.activeOrg');
const auth = { Authorization: 'Bearer ' + localStorage.getItem('bsaas.access'),
               'Content-Type': 'application/json' };
const base = `/api/organizations/${org}`;

// Find the staff member and the location
const { staff }     = await (await fetch(`${base}/staff`, { headers: auth })).json();
const { locations } = await (await fetch(`${base}/locations`, { headers: auth })).json();
const person = staff.find((s) => s.name === 'STAFF NAME HERE');

// Issue 1: link to all active locations
await fetch(`${base}/staff/${person.id}/locations`, {
  method: 'PUT', headers: auth,
  body: JSON.stringify({ locationIds: locations.map((l) => l.id) }),
});

// Issue 2: set the timezone (do this BEFORE adding working hours)
await fetch(`${base}/staff/${person.id}`, {
  method: 'PATCH', headers: auth,
  body: JSON.stringify({ timezone: 'America/New_York' /* the studio's timezone */ }),
});
```

> Working hours added **before** the timezone fix keep the old timezone. Delete them and add them again afterwards.

### Suggested product fix
1. Add a **Locations** picker to the Add/Edit staff form (calls `PUT /staff/:id/locations`), defaulting to all locations when the studio has one.
2. Default a new staff member's `timezone` to the studio's timezone instead of `America/New_York`, and add a timezone field to the form.
3. On invitation accept, link any staff record at that studio with a matching email (`staff.userId = account.id`).
