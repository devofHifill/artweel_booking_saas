# Creating an Activity — User Guide

How to set up a studio, create a bookable activity, and put the booking widget on your own website.

> **Where things live**
> - **Dashboard:** `https://app.bookaihub.com`
> - **Public booking page:** `https://bookaihub.com/public/<your-studio-slug>`
> - **Widget script:** `https://bookaihub.com/embed.js`
>
> Staging equivalents: `https://app.artweel.fillforge.cloud` and `https://artweel.fillforge.cloud`.

---

## Contents

1. [Before you start: important rules](#1-before-you-start-important-rules)
2. [Part A: Studio setup (once)](#part-a-studio-setup-once)
3. [Part B: Staff](#part-b-staff)
4. [Part C: Create the activity](#part-c-create-the-activity)
5. [Part D: Payments (optional)](#part-d-payments-optional)
6. [Part E: Publish and test](#part-e-publish-and-test)
7. [Part F: Put the widget on your website](#part-f-put-the-widget-on-your-website)
8. [Worked example: Pottery Wheel Throwing Party](#worked-example-pottery-wheel-throwing-party)
9. [Deleting or hiding an activity](#deleting-or-hiding-an-activity)
10. [Plan limits](#plan-limits)
11. [Known limitations](#known-limitations)
12. [Troubleshooting](#troubleshooting)

---

## 1. Before you start: important rules

These cause most "my activity isn't showing" problems. Read them first.

| # | Rule | What happens if you miss it |
|---|------|-----------------------------|
| 1 | **No dashboard screen can create a location.** The only way to get one is the **Set up my studio** button on the Setup page (`/setup`). | You can't pick a location for your activity. |
| 2 | **Every class session must have a location.** | The session appears on your calendar but **never appears on the booking page or widget**. |
| 3 | **A staff member needs at least one activity assigned.** | They show *"Not bookable yet"* and customers can't book them. |
| 4 | **Set the studio timezone before scheduling anything.** | Start times are saved in the wrong timezone. Fixing the timezone later does **not** move sessions already created. |
| 5 | **New studios start on the SOLO plan:** 1 instructor, 1 location, no mobile bookings. | You can't add a second instructor. Edit the one created during setup instead. |

---

## Part A: Studio setup (once)

### Step 1: Sign in
Go to the dashboard and sign in, or register a new studio.

### Step 2: Run studio setup
1. Go to **`/setup`** (e.g. `https://app.bookaihub.com/setup`).
2. Click **Set up my studio**.

It **only adds what is missing and never overwrites** anything you've already set up. On a new studio it creates:

- a location called **The studio** (you can't create this any other way)
- an instructor called **Me**, with working hours **Tue–Sat, 10:00–18:00**
- a cancellation policy called **Standard**
- equipment (pottery wheels and a kiln)
- **3 sample activities** (Beginner Wheel Throwing, Handbuilding Workshop, Private Lesson)

> If `/setup` shows **"You are live"** and no **Set up my studio** button, setup is already complete and your location already exists.

### Step 3: Business information
**Settings → Business Information**: set the studio name customers will see.

### Step 4: Timezone and currency
- **Settings → Localisation**: set the timezone the studio is actually in.
- **Settings → Currency**: confirm the currency.

⚠️ Do this **before** creating any activity or schedule.

### Step 5: Hide the sample activities (optional)
For each sample activity you don't want: **Activities → open it → Status: Draft → Save**.

---

## Part B: Staff

### Step 6: Add or edit a staff member
**Staff & Guides**
- **SOLO plan:** edit the existing instructor (e.g. **Me**). Don't add a new one.
- **Studio / Pro plan:** click **Add staff**.

| Field | Notes |
|---|---|
| Name | Shown to customers |
| Email | Never shown publicly |
| Phone | Optional, never shown publicly |
| Role | e.g. "Wheel instructor" |
| Calendar colour | For your own calendar |
| Max bookings a day | Limits their daily load |
| **Show on the booking page** | Tick to show them to customers; untick to hide them |

### Step 7: Assign activities
On the staff member's row, click the **activity chips** to turn them on.
If no chip is on, they show **"Not bookable yet"**.

### Step 8: Working hours
On the staff member's row, click **Hours**.
- Set their weekly working hours.
- Add exceptions: **Day off**, **Different hours** or **Extra hours**.

> **One to one** activities are only offered inside these hours. The default hours from setup (Tue–Sat, 10:00–18:00) **don't include Sunday or Monday, or anything after 18:00**. Adjust them to match when you actually run activities.

---

## Part C: Create the activity

### Step 9: Open the form
**Activities → Create activity**

The form has six sections.

### 9.1 Basics

| Field | Required | Notes |
|---|---|---|
| Activity name | ✅ | e.g. "Beginner Wheel Throwing" |
| Short description | | One line shown on the booking page |
| Full description | | What happens, in order, and what a beginner should expect |
| **Type** | ✅ | **Group class**: several people book seats on the same session. **One to one**: a single person books time with an instructor |
| Category | | Groups activities on the booking page (optional) |
| **Status** | ✅ | **Active** = bookable. **Draft** = hidden from the booking page |

### 9.2 Pricing & capacity

| Field | Required | Notes |
|---|---|---|
| Adult price / Price | | Per person (Group class) or per booking (One to one) |
| Child price | | *Group class only.* **0 means adults only.** Keep it at or below the adult price |
| Currency | | Normally the studio currency |
| Duration (minutes) | ✅ | 5–1440 |
| Maximum capacity | ✅ | *Group class only.* Seats per session (1–500) |
| Minimum guests | | *Group class only.* See [Known limitations](#known-limitations) |

### 9.3 Where

| Field | Notes |
|---|---|
| **Location** | **Pick your location (e.g. The studio).** Don't leave it on *"Anywhere you run it"* |
| Meeting point | Details a map can't give, e.g. "Second door on the left, ring the bell". Sent with the confirmation |

### 9.4 Availability
*Shown only when creating a new activity. Creates the sessions when you save.*

| Field | Notes |
|---|---|
| Available days | Click the day chips (Mon–Sun) |
| Start times | Enter a time → **Add time**. Repeat for each start time |
| Schedule for | The next **4, 8 or 12 weeks** |

- The note under this section shows **how many sessions will be created**.
- If it warns about a location, go back to **Where** and pick one.
- You can leave days and times empty and schedule sessions later (Step 11).

### 9.5 Presentation

| Field | Notes |
|---|---|
| Icon | Shown on the booking page |
| Colour | Used on the calendar and booking page |

### 9.6 Policies

| Field | Notes |
|---|---|
| Cancellation policy | e.g. **Standard**: 100% refund 48h+ before, 100% credit 24–48h before, nothing under 24h |
| Minimum notice (minutes) | How soon before the start people can still book. `0` = up to the last minute. `1440` = 24h, `2880` = 48h |
| Bookable up to (days ahead) | How far ahead people can book. **Must cover your schedule** (e.g. 90 days for 12 weeks) |
| Deposit | Percentage or fixed amount. **Only collected when Stripe is connected** |
| What is included | One item per line, e.g. Clay / Tools / Firing |
| Before you come | Preparation notes, e.g. "Short nails, closed shoes" |
| Booking instructions | Arrival details, e.g. parking, which door |

### Step 10: Save
Click **Save**.

### Step 11: Add more dates (optional)
In **Activities → Schedule a class**:

| Field | Notes |
|---|---|
| Activity | Choose the activity |
| Date / time | Start |
| Capacity | Up to the activity's maximum capacity |
| Instructor | Pick one, or "Nobody yet" |
| **Location** | **Must not be "Not set"** |
| Repeat weekly | Tick and pick weekdays to create a recurring series |

Use this to schedule beyond 12 weeks, or to add one-off dates.

### Step 12: One to one activities: extra checks
- The activity is **assigned** to the instructor (Step 7).
- The instructor has **working hours** covering when you want to offer it (Step 8).

Without both, **no time slots appear** on the booking page.

---

## Part D: Payments (optional)

### Step 13: Connect Stripe
**Settings → Payment Settings** (or **Payments**): connect Stripe.

| Setup | What customers experience |
|---|---|
| **No Stripe** | Bookings are confirmed **unpaid**, and customers pay at the studio. Fine for testing. |
| **Stripe connected** | Customers **pay online when they book** |
| **Stripe + "Allow pay on arrival"** | Customers can choose to pay at the studio |

Deposits (Step 9.6) only take effect once Stripe is connected.

---

## Part E: Publish and test

### Step 14: Publish
Go to **`/setup`** → **Publish my booking page**.
This button appears once the studio, an activity and working hours are all in place.

### Step 15: Test the booking page directly
1. Open `https://bookaihub.com/public/<your-studio-slug>`.
2. Book the activity end to end.
3. Check **Bookings** in the dashboard. The booking should be there, with source **web**.
4. If it was a test, cancel it.

> **Always test here before embedding.** If booking doesn't work on this page, it won't work in the widget either.

---

## Part F: Put the widget on your website

### Step 16: Copy the snippet
**Website & widget → Booking Widget → Copy snippet**

It looks like this:

```html
<div data-studio="your-studio-slug"></div>
<script src="https://bookaihub.com/embed.js" async></script>
```

### Step 17: Paste it into your website
Paste it where you want the booking form to appear.
- **WordPress:** add a **Custom HTML** block.
- **Other sites:** any HTML embed / code block.

The widget **resizes to fit its content**. To set the height it starts at, add `data-height`:

```html
<div data-studio="your-studio-slug" data-height="600"></div>
```

**Alternative: a plain iframe.** It won't resize itself, so give it a generous fixed height:

```html
<iframe
  src="https://bookaihub.com/public/your-studio-slug?embed=1"
  style="width:100%;height:1200px;border:0"
  title="Book a class">
</iframe>
```

### Step 18: Test through your website
1. Make a booking through the widget on your site.
2. Check **Bookings** in the dashboard. Its source should be **embed**.
3. If it was a test, cancel it.

---

## Worked example: Pottery Wheel Throwing Party

A group party held at the studio, where one host books several guests in a single booking.

### Why "Group class"
- **One to one** has no capacity setting, so it can't hold a group.
- **Group class** lets the host book **up to 50 guests in one booking**.

### Before creating it
1. **Settings → Localisation**: correct timezone.
2. Hide any activities you no longer want (**Status: Draft**).

### Basics

| Field | Value |
|---|---|
| Activity name | `Pottery Wheel Throwing Party` |
| Short description | `A private wheel-throwing party for your group — clay, tools and firing included.` |
| Full description | Welcome and demo (15 min), everyone at the wheel (75 min), glazing choices and wrap-up (30 min). *Minimum 6 guests. Pieces are fired and ready to collect in about 2 weeks.* |
| Type | **Group class** |
| Category | Uncategorised |
| Status | **Active** |

### Pricing & capacity

| Field | Value |
|---|---|
| Adult price | e.g. `65.00` per guest |
| Child price | e.g. `45.00` (`0` only if adults-only) |
| Currency | USD |
| Duration (minutes) | `120` |
| Maximum capacity | Number of guests you can seat at wheels, e.g. `10` |
| Minimum guests | `6` (not enforced; see [Known limitations](#known-limitations)) |

### Where

| Field | Value |
|---|---|
| Location | **The studio** |
| Meeting point | `Front entrance, ring the bell — we'll bring you to the wheel room` |

### Availability

| Field | Value |
|---|---|
| Available days | **Sat, Sun** |
| Start times | `11:00`, `14:00`, `17:00` (**Add time** after each) |
| Schedule for | **The next 12 weeks** |

### Presentation
Any icon and colour.

### Policies

| Field | Value |
|---|---|
| Cancellation policy | **Standard** |
| Minimum notice (minutes) | `2880` (48 hours to prepare) |
| Bookable up to (days ahead) | `90` |
| Deposit | Off until Stripe is connected |
| What is included | `Clay` / `Tools & aprons` / `Glazing` / `Firing` / `Instructor for the whole party` |
| Before you come | `Short nails, closed shoes, clothes you don't mind getting muddy.` |
| Booking instructions | `Arrive 10 minutes early. Parking at the rear.` |

### After saving
1. **Staff & Guides → instructor → turn on the "Pottery Wheel Throwing Party" chip.**
2. **Hours**: make sure the instructor works **Saturday and Sunday**, and **until at least 19:00** (the 17:00 party ends at 19:00). The setup defaults (Tue–Sat, 10:00–18:00) don't cover this.
3. Optional: set the instructor on each session under **Activities → Scheduled classes**.
4. Optional: connect Stripe (Part D).

### Test
1. Open the booking page, pick the party and a Saturday, book **6 guests**.
2. **Bookings** shows it with 6 seats, and the session shows **4 of 10** left.
3. Cancel if it was a test.
4. Embed the widget (Part F) and test once more through your site.

---

## Deleting or hiding an activity

| Action | When it's allowed | Effect |
|---|---|---|
| **Delete** | Only if the activity has **never had any booking or session**, whatever its status | Permanently removed. Can't be undone |
| **Set Status: Draft** | Always | Hidden from the booking page and widget. Existing bookings are kept |

- Activities → trash icon → confirm to delete.
- If it has any history you'll see: *"This service has bookings and cannot be deleted. Deactivate it instead…"*
- **Cancelling its bookings doesn't make it deletable.** Cancelled bookings still count, because a customer's receipt has to keep pointing at the activity it was for.

**Recommended:** set it to **Draft**. To fix a name or type, edit it in place; bookings stay attached.

---

## Plan limits

| Plan | Instructors | Locations | Mobile bookings (at the customer's place) |
|---|---|---|---|
| **SOLO** (default for new studios) | 1 | 1 | ❌ |
| **STUDIO** | 5 | 3 | ✅ |
| **PRO** | Unlimited | Unlimited | ✅ |

Upgrade in **Billing**. Plan limits can be changed by the platform admin, so these are the defaults.

---

## Known limitations

| Limitation | Workaround |
|---|---|
| **No screen to create a location** | Use **Set up my studio** on `/setup`, or ask the platform admin |
| **Minimum guests is saved but not enforced.** A booking below the minimum is still accepted | State the minimum clearly in the description |
| **Group sessions aren't private.** If a host books 6 of 10 seats, others can book the remaining 4 | Set **Maximum capacity** to the full party size you expect |
| **Availability creates at most 12 weeks** of sessions | Add more with **Schedule a class → Repeat weekly** |
| **Changing the timezone doesn't move existing sessions** | Delete wrongly-timed sessions and schedule them again |
| **Deposits need Stripe** | Connect Stripe first (Part D) |
| **Max 50 guests per booking** | Split very large groups across bookings |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Activity not on the booking page | Status is **Draft** | Set **Status: Active** |
| Activity listed but **no dates** | Sessions have **no location** | Schedule again with **Location: The studio** |
| No dates in the next day or two | **Minimum notice** hides them | Expected. Lower the minimum notice if needed |
| Later dates missing | **Bookable up to (days ahead)** is too short | Increase it |
| Dates stop after 12 weeks | Availability limit | **Schedule a class → Repeat weekly** |
| **One to one** shows no times | Instructor not assigned, or no working hours | Steps 7–8 |
| Instructor not shown | Not assigned, or **Show on the booking page** is off | Steps 6–7 |
| Staff shows "Not bookable yet" | No activities assigned | Step 7 |
| Times are off by hours | Wrong studio timezone | Settings → Localisation, then reschedule |
| "This class has to be paid for when you book it" | Stripe connected and pay on arrival is off | Complete payment, or enable **Allow pay on arrival** |
| Can't add a second instructor | SOLO plan limit | Edit the existing one, or upgrade |
| Can't pick a location | No location exists | `/setup` → **Set up my studio** |
| Can't delete an activity | It has bookings or sessions | Set **Status: Draft** instead |
| Widget area is blank | Wrong slug in `data-studio` | Copy the snippet again from **Booking Widget** |
| Widget has a scrollbar / wrong height | Using a plain iframe | Use the snippet (it resizes itself), or raise the iframe height |
