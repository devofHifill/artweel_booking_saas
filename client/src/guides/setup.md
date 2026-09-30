# Setting up your studio

From signing up to a live booking page, in the order the **Setup** checklist uses. Each step names the screen it happens on.

> **Your booking page:** `https://bookaihub.com/public/<your-studio-slug>`

---

## Contents

1. [The Setup checklist](#1-the-setup-checklist)
2. [Set up the basics](#2-set-up-the-basics)
3. [Your studio's details](#3-your-studios-details)
4. [Timezone and currency](#4-timezone-and-currency)
5. [Locations](#5-locations)
6. [Booking rules](#6-booking-rules)
7. [Cancellation policy](#7-cancellation-policy)
8. [Payments](#8-payments)
9. [Email and text messages](#9-email-and-text-messages)
10. [Your team](#10-your-team)
11. [Activities and instructors](#11-activities-and-instructors)
12. [How it looks](#12-how-it-looks)
13. [Publish and test](#13-publish-and-test)
14. [Your trial and plan](#14-your-trial-and-plan)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. The Setup checklist

After signing up you land on **Setup** (`/setup`). It lists what a studio needs before it can take bookings:

| Step | Ticked when | Link |
|---|---|---|
| Name your studio | Your studio has a name (it does from signup) | Business information |
| Add your location | You have at least one location | Settings → Locations |
| Add a class | You have at least one activity | Activities |
| Set your hours | Everyone who teaches a **One to one** has working hours | Staff & Guides |
| Connect payments *(optional)* | Stripe can take payments | Integrations |

Each step links to the screen that completes it. The ticks come from your data, so doing a step on its own screen ticks it here too.

> **Publishing needs more than ticks.** Setup only offers **Publish** once at least one activity can actually be booked. If none can, it lists each one and why.

---

## 2. Set up the basics

The fastest start: on **Setup**, click **Set up the basics**. It adds only what's missing and never changes what you've already set up:

- a location called **The studio**
- **you** as the instructor, with your name and email, working **Tue–Sat, 10:00–18:00**, teaching any activity nobody teaches yet
- a cancellation policy called **Standard**

Tick **Also add three example pottery classes and studio equipment** only if you run a ceramics studio. For any other business, leave it off and create your own activities.

Everything it adds can be changed afterwards: rename the location, change your hours, edit the policy.

---

## 3. Your studio's details

**Settings → Business Information**

Shown on confirmations, receipts and your booking page.

- **Business name**: what customers see everywhere. **Legal name** is optional, for receipts.
- **Email** and **Phone**: shown at the foot of your booking page, and offered to customers when there's nothing available to book. Worth filling in.
- **Address** and **Website**.
- **Business type**: e.g. *Tour & activity operator*. A pottery studio or ceramics school is offered the example pottery classes in Setup.

Your booking page's **tagline** and **about** text are set in **Website & widget → Page content**.

---

## 4. Timezone and currency

⚠️ **Set these before you schedule anything.** Changing the timezone later does **not** move sessions you've already created.

- **Settings → Localisation**: the timezone your studio is in, and how dates and times are written.
- **Settings → Currency**: the currency prices are shown in. The list offers 17 currencies, including USD, GBP, EUR, INR (Indian Rupee), AUD, CAD, SGD and AED.

---

## 5. Locations

**Settings → Locations**

A location is where your activities happen. Customers see its name and address when they book, on their confirmation and on their booking page.

- **Add a location**: name, address (optional but recommended), and timezone (starts as the studio's).
- **Edit**: rename it, add the address, or correct its timezone.
- **Switch off**: hides it from customers. Refused while classes are still scheduled there. Move or cancel those first.
- **Remove**: only for a location that has never had a class or booking. Otherwise switch it off.

| You have | What happens |
|---|---|
| **One location** | Every class goes there automatically. Nothing to choose |
| **Several locations** | Customers pick one on your booking page, and each class must be at one. A class with no location is hidden from customers and flagged **Not on your booking page** under **Activities** |

The **SOLO** plan includes 1 location. See [Your trial and plan](#14-your-trial-and-plan).

---

## 6. Booking rules

**Settings → Booking Settings**

| Setting | What it does |
|---|---|
| Minimum notice (hours) | How close to the start people can still book. **New activities** start with this; existing ones keep their own |
| Maximum advance (days) | How far ahead people can book. Also a starting value for new activities |
| Seat hold during checkout (minutes) | How long a place is held while someone pays |
| Overbooking buffer | Extra places sold on each class beyond its capacity. Leave at 0 unless you mean to overbook |
| Allow same-day bookings | Off: nothing can be booked for today |
| Confirm bookings automatically when payment succeeds | Usually on |
| Require a signed waiver before departure | Flags guests who haven't signed, on the daily manifest. **It doesn't stop them booking** |
| Require a phone number at checkout | Makes the phone field compulsory |
| Allow child tickets where the activity supports them | Child prices are set per activity |

---

## 7. Cancellation policy

**Settings → Cancellation Policy**

This is the default for new activities. Each activity can pick its own under **Policies**.

| Field | Meaning |
|---|---|
| Start from | **Flexible** (full refund until 24h, then 50%), **Moderate** (full refund until 48h, then 25%), **Strict** (full refund until 7 days, then nothing), **Standard** (full refund until 48h, studio credit from 24–48h, then nothing), or your own |
| What a cancellation gets back | One row per step: **at least N hours before**, the **refund %** and the **studio credit %**. The last row, **Later than that**, covers everything after. Use **+ Add a step** and **Remove** to change the steps |
| No-show fee (%) | Kept when someone doesn't turn up |
| Changing the date | Tick **Let customers change the date of their booking themselves**, and set **up to how many hours before it starts** they can |
| Policy text shown to guests | Leave empty to show a sentence generated from the steps |

- Refund and credit on one step can't add up to more than 100%, and two steps can't use the same number of hours. The form tells you if they do.
- **Studio credit** can be spent on a future booking instead of the money coming back.
- **Customers change the date** from the **Manage or cancel** link in their confirmation, up to the number of hours you set (24 with the **Standard** policy).

---

## 8. Payments

Payments are optional. Without them every booking is confirmed and paid **on the day**, and your booking page says so.

### Connect Stripe
**Integrations → Payments → Connect Stripe**

1. Stripe opens. Create or sign in to your Stripe account and finish their checks.
2. Back in **Integrations**, the status shows:
   - **Connected — taking payments**: done.
   - **Connected but cannot take payments yet**: Stripe is waiting on details from you. Click **Finish Stripe setup**.

Money goes straight to your Stripe account. Stripe sets the processing fee.

### Payment settings
**Settings → Payment Settings**

| Setting | What it does |
|---|---|
| Deposit percentage | The deposit a **new** activity starts with. Each activity sets its own |
| Let guests pay a deposit instead of the full amount | Off turns deposits off everywhere |
| Allow "pay on arrival" bookings | Lets customers book now and pay on the day, even with Stripe connected |
| Accept cash at the meeting point | Shown to customers as a way to pay |

---

## 9. Email and text messages

### Email
**Settings → Email Settings**

- **From name**: whose name confirmations come from (your studio's name if empty).
- **Reply-to**: where customers' replies go. Set this to an inbox you read.
- **BCC every message to**: a copy of every message, if you want one.
- **Email footer**: your address and phone, for example.
- **From address** only takes effect once **Domain authentication** shows **Active**. Until then, mail comes from our address with your name on it. Get in touch to set it up.

### Text messages
**Settings → SMS Settings** and **Integrations → Text messages**

- Texts are only sent to customers who tick **Text me a reminder** when they book.
- **Quiet hours**: reminders aren't sent at night. They wait until the morning.
- Customers can reply **STOP** at any time, and are not texted again unless they reply **START**.
- If **Integrations** shows text messages as **Not set up**, SMS isn't available yet. Email still goes out as normal.

### What goes out, and when
**Notifications** shows every message sent (the **Delivery log**) and lets you edit the wording (**Templates**). See [Running your studio](/help/guides/running).

---

## 10. Your team

**Settings → Users & Permissions**

People who can **sign in** to the dashboard. This is separate from **Staff & Guides**, which lists the people customers book.

1. **Invite somebody**: name, email and role, then **Send invitation**.
2. Studio emails often land in spam, so the screen also shows a **link you can copy and send yourself**.
3. They appear under **Waiting to accept** until they do.

| Role | Can do |
|---|---|
| **Admin** | Everything except billing and removing owners |
| **Instructor** | Their own classes, the manifest, and taking the register |
| **Front desk** | Bookings, customers and payments. Can't change how the studio runs |

- **Owner** can't be chosen when inviting. Invite them, then change their role once they've accepted.
- Someone who also teaches should be invited with **the same email as their staff record**. That links the two, so their **My schedule** works.

---

## 11. Activities and instructors

Two guides cover these step by step:

- [Creating an activity](/help/guides/activities): what customers book, its dates, prices and policies.
- [Managing staff](/help/guides/staff): instructors, their hours, and where they work.

The short version: create an activity, choose **who teaches it**, and give it **dates** (group class) or make sure its instructor has **working hours** (One to one). Each activity's card in **Activities** tells you if customers can't book it yet, and why.

---

## 12. How it looks

- **Settings → Appearance**: your studio colour, used on the booking page and in the dashboard.
- **Website & widget**: your booking page's pages, navigation, branding and SEO, a preview, and the **Booking Widget** snippet to paste into your own website.

---

## 13. Publish and test

1. **Setup → Publish my booking page**. Available once at least one activity can be booked.
2. **Copy your booking page link** from Setup and put it in your bio, website and emails.
3. **Test it**: open the link, book something, and check it appears under **Bookings**. Open the **Manage or cancel** link from the confirmation to see what your customer sees, then cancel the test booking.

---

## 14. Your trial and plan

**Plan and billing** (from the account menu, top right)

- New studios start with a **14-day free trial**. No card is needed to start.
- The dashboard warns you when a few days are left.
- **If the trial ends without a plan**, your account is **paused**: your data and bookings are kept, but you can't make changes and your booking page stops taking new bookings. Choose a plan to pick up where you left off.

| Plan | Instructors | Locations | Mobile bookings |
|---|---|---|---|
| **SOLO** | 1 | 1 | ❌ |
| **STUDIO** | 5 | 3 | ✅ |
| **PRO** | Unlimited | Unlimited | ✅ |

These are the default limits; prices are shown on the **Plan and billing** page.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Setup has no **Publish** button | A step isn't done, or nothing can be booked yet | Setup lists what's missing. Fix each item from its link |
| A step stays unticked | What it waits for isn't there yet | Read the step's description, and use its link |
| Times on the booking page are hours out | Wrong studio or location timezone | Settings → Localisation, and Settings → Locations → Edit |
| *"The Solo plan includes 1 location."* | Plan limit | Upgrade, or switch another location off |
| Can't switch a location off | Classes are still scheduled there | Move or cancel them first |
| Customers aren't asked to pay | Stripe isn't connected, or can't take payments yet | Integrations → Payments |
| Confirmations come from our address | Domain authentication isn't Active | Get in touch to set up your domain |
| No text messages go out | The customer didn't tick the SMS box, replied STOP, or SMS isn't set up | Check the **Delivery log** in Notifications |
| "Your account is paused" | Your trial ended, or a payment failed | Choose a plan in **Plan and billing** |
