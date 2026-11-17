# Creating an activity

How to set up your studio, create a Class or an Event customers can book, and put the booking widget on your own website.

> **Your booking page:** `https://bookaihub.com/public/<your-studio-slug>`

---

## Contents

1. [Before you start: important rules](#1-before-you-start-important-rules)
2. [Part A: Studio setup (once)](#part-a-studio-setup-once)
3. [Part B: Staff](#part-b-staff)
4. [Part C: Create a Class or an Event](#part-c-create-a-class-or-an-event)
5. [Part D: Payments (optional)](#part-d-payments-optional)
6. [Part E: Publish and test](#part-e-publish-and-test)
7. [Part F: Put the widget on your website](#part-f-put-the-widget-on-your-website)
8. [Worked examples](#worked-examples)
9. [Deleting or hiding an activity](#deleting-or-hiding-an-activity)
10. [Plan limits](#plan-limits)
11. [Known limitations](#known-limitations)
12. [Troubleshooting](#troubleshooting)

---

## 1. Before you start: important rules

These cause most "my activity isn't showing" problems. Read them first.

| # | Rule | What happens if you miss it |
|---|------|-----------------------------|
| 1 | **Add your location first**, in **Settings → Locations** (or with **Set up the basics** on `/setup`). | You can't pick a location for your activity. |
| 2 | **With more than one location, every class session needs one.** With a single location, sessions go there automatically, including ones scheduled before it existed. | With several locations, a session left on *"Not set"* appears on your calendar but **not on the booking page or widget**. |
| 3 | **A staff member needs at least one activity assigned.** | They show *"Not bookable yet"* and customers can't book them. |
| 4 | **Set the studio timezone before scheduling anything.** | Start times are saved in the wrong timezone. Fixing the timezone later does **not** move sessions already created. |
| 5 | **New studios start on the SOLO plan:** 1 instructor, 1 location, no mobile bookings. | You can't add a second instructor. Edit the one created during setup instead. |

---

## Part A: Studio setup (once)

Setting up the studio itself has its own guide: [Setting up your studio](/help/guides/setup). In short:

### Step 1: Sign in
Sign in, or start a new studio.

### Step 2: Set up the basics
**Setup → Set up the basics** adds a location, you as the instructor with Tue–Sat 10:00–18:00 hours, and a Standard cancellation policy. Pottery examples are optional.

### Step 3: Business information
**Settings → Business Information**: the name, email and phone customers see.

### Step 4: Timezone and currency
**Settings → Localisation** and **Settings → Currency**. ⚠️ Do this **before** creating any activity or schedule.

### Step 5: Hide the example activities (optional)
If you added the pottery examples, for each one you don't want: **Activities → open it → Status: Hidden → Save**.

---

## Part B: Staff

### Step 6: Add or edit a staff member
**Staff & Guides**
- **SOLO plan:** edit the instructor setup created (you). Don't add a new one.
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
On the staff member's card, click the **activity chips** to turn them on. If no chip is on, they show **"Not bookable yet"**.

You can also do this from the activity's side: the **Where and who** step when you create a Class, **Seats and price** for an Event, or the **Who teaches** button on its card in **Activities**.

### Step 8: Working hours
On the staff member's row, click **Hours**.
- Set their weekly working hours.
- Add exceptions: **Day off**, **Different hours** or **Extra hours**.

> **One to one** activities are only offered inside these hours. The default hours from setup (Tue–Sat, 10:00–18:00) **don't include Sunday or Monday, or anything after 18:00**. Adjust them to match when you actually run activities.

---

## Part C: Create a Class or an Event

### Step 9: Choose Class or Event
**Activities → Create activity** asks one question first.

| | **Class** | **Event** |
|---|---|---|
| What it is | A course of several sessions, e.g. a 6-week beginner course. It can repeat weekly or monthly, run at several times a day, and run again and again over a date range | One date, e.g. a date night, a workshop, a party |
| How customers book | Once, for **every session** | A seat on that date |
| Price | For the whole class | Per seat |
| Plan | Every plan. **Solo runs 1 class at a time**; Studio and Pro, unlimited. Several times or runs of one Class still count as **one** class | Every plan, unlimited |

Then a few short steps. **Next** checks each step before moving on, and **Back** never loses what you typed.

> **Nothing is lost if you close it.** Each step is saved as a draft. Drafts appear at the top of **Activities** with **Continue** and **Discard**. A draft is invisible to customers and doesn't hold anyone's time.

Every activity has one of three statuses, shown on its card and in the table:

| Status | What it means | Customers can book it? |
|---|---|---|
| **Draft** | Started in Create activity but not finished. Listed at the top of **Activities** | No |
| **Hidden** | Saved, but not on your booking page | No |
| **Published** | On your booking page | Yes |

### 9.1 An Event: four steps

| Step | What you fill in |
|---|---|
| **What** | Name, and an optional one-line description for the booking page |
| **When and where** | Date, start and end time, location. With one location (or one building plus a mobile service area) it's chosen for you |
| **Seats and price** | Seats, price per seat, instructor |
| **Review** | How it will look on your booking page. Press **Publish** |

Two time slots on the same day are two events: publish the first, then **Duplicate** it (Step 11).

### 9.2 A Class: eight steps

Only three things are required: a **name**, at least one **day**, and an **adult price** (`0` if it's free). Everything else is filled in for you or optional.

| Step | What you fill in |
|---|---|
| **What** | **Activity name**, short description, full description, **Category**. **Type** shows *Class* (it was chosen on the first screen) |
| **Schedule** | **Starts on**, **Until** (optional), **Days**, start and end time, **More times**, and **Repeat weekly** or **Repeat monthly**. The number of sessions is worked out for you (Step 9.3) |
| **Where and who** | Location, **Meeting point** (which door or room), instructor |
| **Seats and price** | **Adult price** and **Child price**, both for the **whole** class (child `0` = adults only), **Currency** (set for the whole studio), **Maximum capacity**, **Minimum guests**, **Deposit** |
| **Look** | **Icon** and **Colour** for its card and calendar block |
| **Policies** | **Cancellation policy**, **Minimum notice (minutes)**, **Bookable up to (days ahead)** |
| **For customers** | **What is included** (one per line), **Before you come**, **Booking instructions** (sent after booking) |
| **Review** | How it will look, and **Status**: **Published** or **Hidden**. Press **Publish** (or **Save as hidden**) |

What the booking rules mean for a Class, which is booked once for the whole run:

| Field | For a Class |
|---|---|
| **Child price** | The booking page asks how many of the places are children, and charges each one the child price, for every session |
| **Minimum guests** | The smallest party one booking can be (e.g. `2` for a parent-and-child class). Not the minimum class size |
| **Minimum notice** | Booking closes this long before the **first** session. `0`: right up to the start |
| **Bookable up to** | Booking opens this many days before the first session. **Blank: open as soon as you publish.** Until then the card says *Booking opens …* |
| **Status: Hidden** | Saved, but not on the booking page and can't be booked. On Solo it doesn't use your one class until you switch it to Published |

### 9.3 The Schedule step

| Field | What it does |
|---|---|
| **Starts on** | The first possible date. The class starts on the first ticked day on or after it |
| **Days** | Mon–Sun. Tick the days it runs. All seven = every day |
| **Starts at / Ends at** | The time of the class. **Duration** is worked out from these |
| **More times** | **+ Add another time** runs the same class again that day, at a start time you choose. Every time is the same length as the first. Each time is its **own group** with its own customers, e.g. a 6:00pm and an 8:00pm group |
| **Repeat weekly** | Then **How many weeks**. Sessions = days × weeks: Mon & Wed for 4 weeks is 8 sessions |
| **Repeat monthly** | Then **How many months** (up to 24), then **Each month**: *On the 23rd* (only with one day ticked), *On the fourth Monday* (and Wednesday, if both are ticked), or *On the last Monday* (when the start date is in the month's last week). Worked out from the start date |
| Neither ticked | **One week**: one session on each ticked day |
| **Until** (optional) | Leave empty for one run. With a date, the same pattern runs **again and again, back to back**, until then (Step 9.4) |

Ticking one repeat box unticks the other. The real dates appear as you go, for example:

> 6 sessions · Mon & Tue 6:00pm–8:00pm · ends Tue 8 Dec
>
> ☑ Mon 23 Nov ☑ Tue 24 Nov ☑ Mon 30 Nov …

- **Untick a date** to skip it (a holiday). Another is added at the end, so the class keeps the same number of sessions and the end date moves.
- Times stay the same on the clock across a daylight-saving change.
- A monthly date that a month doesn't have (the 31st) is skipped for that month.

### 9.4 Running it again over a date range: Until
Set **Until** and the class repeats itself: each **run** starts straight after the last one ends, as long as a **full** run still fits.

> Mon & Tue, Repeat weekly **3 weeks**, from 23 Nov **until 31 Jan**:
>
> **3 runs of 6 sessions**
>
> - Run 1 · Mon 23 Nov – Tue 8 Dec
> - Run 2 · Mon 14 Dec – Tue 29 Dec
> - Run 3 · Mon 4 Jan – Tue 19 Jan
>
> *Mon 25 Jan, Tue 26 Jan are not enough for another full run, so they are left out.*

- Runs never share a date, and every run has the same number of sessions, so one price fits them all.
- With **more times**, every run runs at every time. 3 runs at 6:00pm and 8:00pm are **6 groups**, each booked on its own.
- Unticking a date in one run moves that run's end, and every later run, along.
- Neither repeat box ticked gives **one-week runs**: a new run every week.
- Customers see **one card**; they pick the run and time they want on its calendar.
- It is still **one class** on your plan.

### 9.5 Clashes
While you choose dates, the steps check each one and show what is already there, beside the date:

> **Tue 17 Nov** Rowan Pike is teaching Wheel Basics 6–8pm

| Clash | When |
|---|---|
| **Instructor** | They're already teaching, or away, at that time |
| **Location** | Something else is on at a location marked **One thing at a time** |

**Next** and **Publish** wait until every clash is fixed: change the time, the instructor or the location, or untick the date (Class). If something is booked in the moment between checking and publishing, publishing refuses and names the date. Nothing is half-created.

> **One thing at a time** is a setting on each building in **Settings → Locations → Edit**. Tick it for a single room. Leave it off for a studio that runs things side by side (it's off unless you change it).

### Step 10: Publish
**Publish** puts it on your booking page straight away and says so at the top of **Activities**.

- An **Event** appears under **Events** on the booking page, with its date first.
- A **Class** appears under **Classes**, as **one card** however many times or runs it has (e.g. *6 sessions · 3 runs, from 23 Nov · 2 times: 6:00pm, 8:00pm · Choose a date*). With several times or runs, the card opens a calendar where customers pick their start date and time. They book once and are booked into every session of that group. Missed sessions are not made up.
- **Weekly** classes close when their first session starts. **Monthly** classes take late joiners: after the start, a group shows on its next session as *Joins in progress*.

Each card in **Activities** shows **Class** or **Event**, and says whether customers can book it. If not, it says why, with a link to fix it. **Bookable now** at the top counts only the ones customers can book.

### Step 11: Run it again: Duplicate
On any Class or Event card, live or past, the **Duplicate** button (two sheets) copies everything except the dates and opens at the dates step. Pick new dates and publish. This is how you run "Beginner Wheel" again next term as a separate class, e.g. on different days. To run the same class again on later dates, you can instead move its **Until** date later (Step 12): no new class is needed.

### Step 12: Change it later
**Edit** (the pencil) on a Class or Event opens the same steps you made it with, filled in with what it has now. Change anything, then **Save changes** on Review. Every step can be clicked straight away.

| What you change | What happens |
|---|---|
| Name, descriptions, category, icon, colour, what is included, before you come, booking instructions | Updated everywhere, including the booking page and your website |
| Adult price, child price, deposit, minimum guests | Applies to bookings made from now on. People already booked keep what they paid |
| **Maximum capacity** | Every session still to run gets the new number. It can't go below what is already booked |
| **Instructor** | Every session still to run moves to them, and their time is blocked instead. Refused, naming the date, if they're already busy |
| **Location** | Every session still to run moves there, clash-checked |
| Cancellation policy, minimum notice, bookable up to | Applies from now on |
| **Status** | Published or Hidden. On Solo, switching a hidden Class on needs your one class place free |
| **Dates and times** (Class) | Locked **run by run**. A run (or time group) somebody has booked, or that has started, keeps its dates. The others can change or be removed. Once anyone has booked, the **Schedule** step is greyed out **except Until**: move Until later to **add more runs after the last one**. To call one date off, cancel it from **Scheduled sessions** |
| **Dates and times** (Event) | Can change only while nobody has booked and it hasn't started. Then the old date is replaced by the new one |

**Type** can't change: a Class stays a Class and an Event stays an Event. Make a new one (or **Duplicate**) instead.

Editing an Event also shows **Look**, **Policies** and **For customers**, so you can add a deposit, a policy or what's included to an Event after making it.

Sessions that have already run are left as they were.

### Step 13: When it's over
Once the last date has ended, a Class or Event moves to the **Past** tab in **Activities** and leaves the booking page. Its bookings, payments and pieces are all kept. Past ones can be **Duplicated** but not edited.

### Older activities
Activities created before Classes and Events existed (group classes with many separate dates, and one to one lessons) keep working exactly as before.

- **Add more dates** to an older group class with **Activities → Add a session**. With several locations, **pick one**: *"Not set"* hides the session from customers.
- **One to one** lessons need somebody who **teaches** them (Step 7) and **working hours** that cover when you offer them (Step 8). Without both, no time slots appear, and the card says which is missing.

---

## Part D: Payments (optional)

### Step 14: Connect Stripe
**Settings → Payment Settings** (or **Payments**): connect Stripe.

| Setup | What customers experience |
|---|---|
| **No Stripe** | Bookings are confirmed **unpaid**, and customers pay at the studio. Fine for testing. |
| **Stripe connected** | Customers **pay online when they book** |
| **Stripe + "Allow pay on arrival"** | Customers can choose to pay at the studio |

Deposits (set with **Edit**, Step 12) only take effect once Stripe is connected.

---

## Part E: Publish and test

### Step 15: Publish
Go to **Setup** → **Publish my booking page**.
This button appears once every step is done **and at least one activity can actually be booked**. If nothing can be booked yet, Setup lists each activity that's stuck, with why and a link to fix it.

### Step 16: Test the booking page directly
1. Open `https://bookaihub.com/public/<your-studio-slug>`.
2. Book the activity end to end.
3. Check **Bookings** in the dashboard. The booking should be there, with source **web**.
4. If it was a test, cancel it.

> Customers can **change the date themselves**: the **Manage or cancel** link in their confirmation offers other dates of the same class (or other times with the same instructor), within your cancellation policy's reschedule rules. Their payment and booking link stay the same.

> **Always test here before embedding.** If booking doesn't work on this page, it won't work in the widget either.

---

## Part F: Put the widget on your website

### Step 17: Copy the snippet
**Website & widget → Booking Widget → Copy snippet**

It looks like this:

```html
<div data-studio="your-studio-slug"></div>
<script src="https://bookaihub.com/embed.js" async></script>
```

### Step 18: Paste it into your website
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

### Step 19: Test through your website
1. Make a booking through the widget on your site.
2. Check **Bookings** in the dashboard. Its source should be **embed**.
3. If it was a test, cancel it.

---

## Worked examples

### An Event: Valentine Date Night
A one-evening couples' class.

| Step | Value |
|---|---|
| Choose | **Event** |
| What | `Valentine Date Night`, short description `Two of you, one wheel, a bottle of something` |
| When and where | `Fri 12 Feb`, `18:30`–`21:00`, **the studio** |
| Seats and price | `12` seats, `85.00` per seat, instructor **you** |
| Review | Check the card, then **Publish** |

Next year: **Duplicate** it from the **Past** tab and pick the new date.

### A Class: Beginner Wheel, six Tuesdays
A course where everyone starts together and builds week on week.

| Step | Value |
|---|---|
| Choose | **Class** |
| What | `Beginner Wheel`, short description `Centre, open and pull your first pots` |
| Schedule | Starts on `3 Mar`, days **Tue**, `18:00`–`20:00`, **Repeat weekly** `6` weeks (6 sessions). Untick `17 Mar` for spring break: the class now ends a week later |
| Where and who | **The studio**, instructor **you** |
| Seats and price | Adult price `320.00`, child price blank (adults only), maximum capacity `8` (one per wheel), minimum guests `1`, pay in full |
| Look | 🏺, the terracotta colour |
| Policies | **Standard** policy, minimum notice `1440` (booking closes a day before), bookable up to blank |
| For customers | `Clay, tools and glazes` / `Firing for your pieces`; before you come: `Short nails, closed shoes` |
| Review | Status **Published**, then **Publish** |

### A Class at two times, all winter: Wheel Basics
Three-week courses, back to back, at 6pm and 8pm.

| Step | Value |
|---|---|
| Schedule | Starts on `23 Nov`, **Until** `31 Jan`, days **Mon** and **Tue**, `18:00`–`20:00`, **+ Add another time** `20:00`, **Repeat weekly** `3` weeks |
| Result | 3 runs of 6 sessions (from 23 Nov, 14 Dec and 4 Jan), each at 6:00pm and 8:00pm: 6 groups, one card on the booking page |
| Later | Bookings coming in? **Edit** and move **Until** to `31 Mar` to add the spring runs. Booked runs stay as they are |

### After publishing
1. Optional, for an Event: **Edit** to add what's included, preparation notes, a deposit or a cancellation policy (Step 12). A Class asked for these in its steps.
2. Optional: connect Stripe (Part D).
3. Open the booking page and book it end to end. **Bookings** shows it; a Class booking covers every session.
4. Cancel if it was a test.

---

## Deleting or hiding an activity

| Action | When it's allowed | Effect |
|---|---|---|
| **Delete** | Whenever it has **no upcoming bookings**, whatever its status | Permanently removed with all its sessions and past bookings. Can't be undone |
| **Set Status: Hidden** | Always | Hidden from the booking page and widget. Existing bookings are kept |

- Activities → trash icon. The dialog lists what goes with it (sessions, past bookings, payments); type the activity's name and press **Delete permanently**.
- If people are still booked for dates to come, you'll see *"… has N upcoming bookings. Cancel them first…"*: cancelling tells them and refunds them, then it can be deleted.

**Recommended** while you're unsure: set it to **Hidden**. It keeps its history and can come back with one click.

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
| **Minimum guests is only enforced on a Class.** On an Event or older activity, a booking below the minimum is still accepted | State the minimum clearly in the description |
| **Group sessions aren't private.** If a host books 6 of 10 seats, others can book the remaining 4 | Set **Maximum capacity** to the full party size you expect |
| **A Class run has at most 52 sessions**; **Until** at most a year after the start; at most 12 times a day | Use **Until** for more runs, or publish a second class (**Duplicate**) |
| **Every run of a Class has the same days and times** | For a run on different days, publish a second class (**Duplicate**) |
| **Equipment is not checked for clashes** (e.g. more seats than wheels) | Set seats to the number of wheels |
| **Add a session** (older activities) doesn't check one-thing-at-a-time locations | Check the calendar first |
| **Changing the timezone doesn't move existing sessions** | Delete wrongly-timed sessions and schedule them again |
| **Deposits need Stripe** | Connect Stripe first (Part D) |
| **Max 50 guests per booking** | Split very large groups across bookings |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Activity not on the booking page | Status is **Hidden**, or it is still a **Draft** at the top of Activities | Set **Status: Published**, or **Continue** the draft and publish it |
| Activity listed but **no dates** | You have several locations and the sessions have **none** | In **Activities → Scheduled sessions**, each such session is flagged **Not on your booking page**. Pick its location there |
| Card says **Not bookable: …** | What it names: no dates, nobody teaches it, no hours, or instructors not at that location | Use the button or link on the card |
| No dates in the next day or two | **Minimum notice** hides them | Expected. Lower the minimum notice if needed |
| Later dates missing | **Bookable up to (days ahead)** is too short | Increase it |
| **Next** won't move on, dates shown in red | Those dates clash (Step 9.5) | Change the time, instructor or location, or untick the dates |
| **Class** card is greyed out | On Solo, a class is already running (1 at a time) | Publish the next one when it ends (**Duplicate** it from **Past**), or upgrade in **Billing**. **Billing** shows *Classes running* |
| A Class or Event disappeared from the booking page | Its last date has passed | It's under **Activities → Past**. **Duplicate** it to run it again |
| **Until** gives fewer runs than expected, with dates *left out* | A full run doesn't fit in what is left before Until | Move **Until** later, or choose fewer weeks per run |
| *"One run ends on …"* under **Until** | Until is before the first run can finish | Choose that date or later, or fewer weeks |
| *"The run from 23 Nov has bookings…"* when saving | That run is booked, so its dates can't change | Leave its days and times as they are; to add dates, move **Until** later |
| **One to one** shows no times | Instructor not assigned, or no working hours | Steps 7–8 |
| Instructor not shown | Not assigned, or **Show on the booking page** is off | Steps 6–7 |
| Staff shows "Not bookable yet" | No activities assigned | Step 7 |
| Times are off by hours | Wrong studio timezone | Settings → Localisation, then reschedule |
| "This class has to be paid for when you book it" | Stripe connected and pay on arrival is off | Complete payment, or enable **Allow pay on arrival** |
| Can't add a second instructor | SOLO plan limit | Edit the existing one, or upgrade |
| Can't pick a location | No location exists | **Settings → Locations → Add a location** |
| Can't delete an activity | It has **upcoming** bookings | Cancel them first (customers are told and refunded), or set **Status: Hidden** instead |
| Widget area is blank | Wrong slug in `data-studio` | Copy the snippet again from **Booking Widget** |
| Widget has a scrollbar / wrong height | Using a plain iframe | Use the snippet (it resizes itself), or raise the iframe height |
