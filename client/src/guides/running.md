# Running your studio day to day

Bookings, the calendar, the day's manifest, customers, messages and money, once your booking page is live. For getting there, see [Setting up your studio](/help/guides/setup).

---

## Contents

1. [Your dashboard](#1-your-dashboard)
2. [Bookings](#2-bookings)
3. [Taking a booking at the counter](#3-taking-a-booking-at-the-counter)
4. [Cancelling and refunds](#4-cancelling-and-refunds)
5. [Moving a booking](#5-moving-a-booking)
6. [The calendar](#6-the-calendar)
7. [Classes, waitlists and cancelling a class](#7-classes-waitlists-and-cancelling-a-class)
8. [The daily manifest](#8-the-daily-manifest)
9. [Customers](#9-customers)
10. [Messages to customers](#10-messages-to-customers)
11. [Instructors' calendars](#11-instructors-calendars)
12. [Payments and reports](#12-payments-and-reports)
13. [What customers can do themselves](#13-what-customers-can-do-themselves)
14. [Your plan and billing](#14-your-plan-and-billing)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Your dashboard

**Dashboard** is the day at a glance: **Today's schedule**, **Revenue this week**, and **Where bookings come from** (your booking page, the widget, or the counter).

The **bell** in the top bar lists live problems, not history. For example: payments not connected, an instructor's calendar that needs reconnecting, or messages that failed to send. Each links to the screen that fixes it. When something's wrong, look there first.

Press **/** anywhere to search customers and bookings.

---

## 2. Bookings

**Bookings** lists every reservation: from your booking page, your website's widget, and the counter.

Filter by:

| Filter | Options |
|---|---|
| Status | Confirmed, Pending, Attended, No show, Cancelled |
| Payment | Paid, Part paid, Unpaid |
| Source | Booking page, Widget, At the counter |

**Pending** means not confirmed yet, usually waiting for payment.

Tick several bookings to act on them together. The selection bar appears at the bottom.

---

## 3. Taking a booking at the counter

For walk-ins, phone bookings and anyone in front of you: **Bookings → Create manual booking**. It's also on **Customers**.

Pick the activity, the date or time, the customer (existing or new) and the number of places. It shows under **Bookings** with source **At the counter**. A class still can't be sold beyond its places.

---

## 4. Cancelling and refunds

### Cancelling one booking
**Bookings → the booking → Cancel**. Any refund **due under your cancellation policy** is issued automatically if they paid online: full, partial or none, depending on how close to the start it is. The customer gets a cancellation email saying what was refunded.

To cancel several at once, tick them and use **Cancel** on the selection bar.

### Refunds
- Refunds happen **by cancelling**. Cancelling one booking follows the cancellation policy; cancelling a whole class can refund everyone in full ([Cancelling a class](#cancelling-a-class)). There's no separate refund button.
- To refund more than the policy allows (for a goodwill gesture, say), refund it in your **Stripe dashboard**.
- **Payments** lists every charge and refund, with the reason and any studio credit given.

---

## 5. Moving a booking

| Booking | How to move it |
|---|---|
| **One to one** | **Calendar** (week view): drag it to the new time. The customer is emailed the new time |
| **Group class** | The dashboard can't move a class booking yet. The **customer** can, from their **Manage or cancel** link. Or cancel it and book the new date at the counter |

A moved booking **keeps its payment, reference and booking link**, so a refund later still finds the money.

---

## 6. The calendar

**Calendar** shows classes and One to one bookings by month or week.

- In **week** view, drag a One to one booking to move it. A clash with the instructor's other bookings or classes is refused.
- Classes can't be dragged. Change them in **Activities**.

---

## 7. Classes, waitlists and cancelling a class

**Activities → Scheduled classes** lists each class date with its places taken.

- **Waitlist**: see who's waiting for a full class. **Offer next seat** offers a freed place to the next person in the queue. A place freed by a cancellation or a move is offered automatically.
- **A class with no location** (when you have several) is flagged **Not on your booking page**. Pick its location on the row to fix it.
### Cancelling a class
**Cancel** on the class's row. If people are booked, a window says how many and asks one question: **Refund everyone in full** (ticked by default).

When you confirm:

- every booking is cancelled and the places released;
- **every customer is emailed** that it's cancelled (and texted, if they agreed to texts), with what's being refunded;
- their reminders are stopped, so nobody gets a reminder for a class that isn't happening;
- with **Refund everyone in full** ticked, everyone who paid online gets **all of it back, whatever your cancellation policy says**. You're cancelling, not them, so the late-cancellation fee doesn't apply.

Untick **Refund everyone in full** if you're settling it another way, like moving everyone to another date. They're still emailed.

> This is different from cancelling **one booking** from **Bookings**. That follows your cancellation policy, because it's usually the customer asking.

---

## 8. The daily manifest

**Daily Manifest** is the whole day on one page: every class and One to one, who's coming, and what to know about them. It's printable.

- It opens on **today**, in your studio's timezone.
- It shows **who hasn't paid**, **first-time visitors**, notes, and **who hasn't signed a waiver** (if you require one).
- **Taking the register**: once a class has **started**, mark each person **Attended** or **No show**, then save. Marks are saved per class, all at once.
- Instructors can take the register too.

Marking attendance can also be done from **Bookings**.

---

## 9. Customers

**Customers** lists everyone who has booked, with what they've spent and how often they come. Sort by highest spend, most bookings, most recent, or name.

Open a customer to see their bookings, add notes, and set their status:

| Status | Means |
|---|---|
| **Active** | The normal state |
| **VIP** | A label to spot your regulars |
| **Blocked** | Can't book, join a waitlist or pay online themselves; they're asked to contact the studio. You can still book them at the counter |

---

## 10. Messages to customers

**Notifications**

### What's sent automatically
Booking confirmations, reminders before the booking, rescheduled and cancelled notices, and waitlist offers. By **email** always, and by **text** to customers who ticked the SMS box when booking.

### Delivery log
Every message, with its status:

| Status | Meaning |
|---|---|
| **Sent** | Handed to the email or SMS provider |
| **Waiting** | Scheduled, e.g. a reminder, or held until morning by quiet hours |
| **Failed** | Couldn't be delivered. Check the address or number |
| **Skipped** | Deliberately not sent, e.g. no SMS consent, or the customer replied **STOP** |
| **Cancelled** | No longer needed, e.g. the booking was cancelled |

### Templates
Edit the wording of each message. Keep the placeholders in `{{double braces}}`; they're replaced with the booking's details.

---

## 11. Instructors' calendars

**Integrations → Calendars**

Connect each instructor's **Google Calendar**, and anything in it blocks their availability here, so they can't be double-booked.

- **Connect** opens Google's sign-in. **Make sure the instructor signs in as themselves**: whoever is signed in to that browser is the calendar that gets attached.
- **Reconnect needed** means Google's permission has expired. Their outside commitments are no longer blocking their availability, so reconnect it before it causes a double booking.
- **Sync now** checks for changes straight away.

---

## 12. Payments and reports

- **Payments**: everything charged, refunded and attempted, with **Export**. Open a payment to see its refunds and any studio credit.
- **Reports**: where the money and the bookings come from, over time.

---

## 13. What customers can do themselves

Every confirmation email has a **Manage or cancel** link. From it a customer can:

- see their booking: when, where (with the address and meeting point), and what to bring;
- **add it to their calendar**;
- **change the date**: other dates of the same class at the same location, or other times with the same instructor, up to the number of hours set in the cancellation policy (**24** with the **Standard** policy);
- **cancel**, with any refund due under your policy shown before they confirm.

When nothing is available to book, your booking page offers your email and phone, and your other activities. Fill in **Settings → Business Information** so it can.

---

## 14. Your plan and billing

**Plan and billing** (account menu, top right)

- It shows your plan, and any days left on your trial.
- **Choose** a plan to subscribe.
- If a payment fails, you have **7 days** to update your card. Everything keeps working, with a warning.
- If the trial ends, or those 7 days pass, your account is **paused**: your data and bookings are kept, but changes are blocked and your booking page stops taking new bookings. Choosing a plan brings it back.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A customer says they got no email | Spam folder, or a typo in their address | Check the **Delivery log** in Notifications |
| Texts aren't arriving | No SMS consent, the customer replied STOP, or SMS isn't set up | **Delivery log** shows **Skipped** and why |
| Can't drag a booking on the calendar | It's a class booking, or the new time clashes | Classes: see [Moving a booking](#5-moving-a-booking). Clashes are refused on purpose |
| Can't mark attendance | The class hasn't started yet | Mark it once it has |
| An instructor got double-booked | Their Google Calendar needs reconnecting | Integrations → Calendars → **Reconnect** |
| Customers weren't refunded for a class you cancelled | **Refund everyone in full** was unticked, or they paid at the studio | Refund online payments in your Stripe dashboard; settle cash ones in person |
| A blocked customer says they can't book | **Blocked** stops online booking | Book them yourself, or set them back to **Active** |
| "Your account is paused" | Trial ended, or a payment failed | **Plan and billing → Choose a plan** |
