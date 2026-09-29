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
2. [Part A: Create the staff record](#part-a-create-the-staff-record)
3. [Part B: Make them bookable](#part-b-make-them-bookable)
4. [Part C: Put them on classes](#part-c-put-them-on-classes)
5. [Part D: Give them a login (optional)](#part-d-give-them-a-login-optional)
6. [Part E: Test](#part-e-test)
7. [Editing a staff member](#editing-a-staff-member)
8. [Deactivating or removing someone](#deactivating-or-removing-someone)
9. [The Staff & Guides page at a glance](#the-staff--guides-page-at-a-glance)
10. [Plan limits](#plan-limits)
11. [Troubleshooting](#troubleshooting)

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
| Timezone | | Starts as **Same as the studio**. Their working hours are read in this timezone, so only change it for someone who genuinely works in another one |
| Works at | | The studio's locations they work from. **All are on by default.** Only shown once the studio has a location |
| **Show on the booking page** | | **On**: customers see them and can pick them. **Off**: hidden from customers, but still usable behind the scenes |

### Step 3: Save
They now appear on the page marked **No hours set**.

---

## Part B: Make them bookable

### Step 4: Assign activities
On their card, **click each activity chip** they teach so it turns on.

> If no chip is on, the card shows **"Not bookable yet"**, and **nothing can be booked with them**.

### Step 5: Check where they work
*Matters for **One to one** activities.*

**One to one** activities only offer staff who work at the location the customer picks. New staff work at **every** location, so there's usually nothing to do. To change it, **Edit** them and turn the **Works at** chips on or off.

### Step 6: Check their timezone
New staff use the studio's timezone. Only change it (**Edit → Timezone**) for someone who works in a different one. Changing it later keeps their hours the same on the clock, e.g. 10:00–18:00 stays 10:00–18:00 in the new timezone.

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
> Staff who sign in can add their own days off from **My schedule**. Their weekly hours can only be changed by an Owner or Admin. This needs their login and staff record to use the **same email** (Step 11).

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
| Email | Use the **same email** as their staff record. That's how their login finds their record, e.g. for **My schedule** |
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

You can change: Name, Email, Phone, Role, Calendar colour, Max bookings a day, Timezone, Works at, Show on the booking page.

- Their activities are changed with the chips (Step 4).
- Their hours are changed with **Hours** (Step 7).

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
| *"The Solo plan includes 1 instructor. Upgrade to Studio to add more."* | Plan limit reached | Upgrade, or deactivate someone |
| *"A staff member with that email already exists at this studio."* | Duplicate email | Use a different email, or edit the existing record |
| No **Add staff** button | You're not an Owner or Admin | Ask an Owner or Admin |
| Card says **Not bookable yet** | No activities assigned | Step 4 |
| Card says **No hours set** | No working hours | Step 7 |
| Missing from **One to one** on the booking page | Not working at that location | Step 5 |
| Time slots at strange times | Their timezone isn't the studio's | Step 6 |
| Not shown by name on the booking page | **Show on the booking page** is off | Edit and turn it on |
| Only some of their hours are offered | Activity is longer than the remaining hours, or **Minimum notice** hides near slots | Extend their hours, or lower the activity's minimum notice |
| Can't mark a day off | They have sessions that day | Move or cancel those sessions first |
| Can't remove them | They have booking or session history | Deactivate instead |
| Invitation never arrived | Email in spam | Copy the invitation link and send it yourself |
| Their **My schedule** is empty | Their login and staff record use different emails | Edit the staff record to use the email they sign in with |
