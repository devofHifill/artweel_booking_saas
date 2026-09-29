# New-studio UX audit: findings

Walkthrough run 2026-09-29 on a local copy of `main` (`90dc8a1`), which matches what's live.

The goal: a new operator can set up their studio, staff and activities, link them, and have everything work, with no silent failures. Their customers can book without hitting a dead end.

**How it was tested:** signed up a brand-new studio, "Harbour Kayak Tours", deliberately *not* a pottery studio, and did what a real tour operator would:

1. Signed up.
2. Looked at `/setup`.
3. Created a group activity by hand, with Saturday start times.
4. Booked it as a customer.
5. Opened the customer's manage page.
6. Pressed **Set up my studio**, since it's the only way to get a location.
7. Checked the booking page again.

Every finding below was **seen in the app** unless marked *(code only)*.

---

## The most serious problem

### 16. Adding a location later makes every existing session disappear from the booking page

> **Fixed** on branch `fix/sessions-lost-location`: a studio's first location is given to upcoming sessions that have none; a class scheduled with no location goes to the studio's only one; the home page no longer lists sessions the booking page can't sell; a migration repairs existing studios with exactly one location.

- **What happened:** the studio had 8 kayak sessions and no location. Customers could see and book them, and one was booked. Pressing **Set up my studio** created the studio's first location. From then on, the booking page said *"No dates scheduled yet. Check back soon."* for the kayak tour: all 8 sessions were gone, including the one with a confirmed booking.
- **Why:** the booking page only filters sessions by location once the studio *has* a location. Sessions created before that have no location, so they drop out.
- **What makes it worse:**
  - The operator's dashboard still lists the sessions as normal. Nothing warns them.
  - The public home page still advertises *"Next: 3 Oct 17:00, 8 left, Book now"*, but clicking through leads to "No dates scheduled yet".
  - The setup page says *"Everything needed is in place"* (#17).
- **Where:** availability/booking-page session query (`server/src/modules/public/`); storefront home vs. `/book` use different rules.

---

## Setup and onboarding

| # | Problem | Why it matters | Where |
|---|---|---|---|
| 2 | Setup checklist steps are plain text. None of the four is clickable. | A new operator has to find each screen themselves | `client/src/pages/Onboarding.tsx` |
| 9 | "Name your studio" stays unticked even though the studio was named at signup. It is really waiting for a **location**, which the step never mentions. | The operator can't tell what's missing | `getOnboardingState` in `server/src/modules/onboarding/onboarding.service.ts` (`org.name && locations > 0`) |
| 4 | The only quick start, **Set up my studio**, is described as adding "a ceramics studio". *Correction:* it adds no pottery classes if the operator has already created an activity, but it is still the only way to get a location. | A non-pottery business either takes the ceramics defaults or has no location | `seedPotteryDefaults` in `onboarding.service.ts` |
| 17 | After **Set up my studio**, setup says *"Everything needed is in place. Publish to start taking bookings"*, while the booking page shows no dates (#16) and the only instructor teaches nothing (#18) | The one screen meant to say "you're ready" is wrong | `getOnboardingState` |
| 18 | Setup creates an instructor named **"Me"** with a placeholder email (`instructor@<slug>.local`), not the owner's. They are assigned to **no activities**, including the one that already existed. | The instructor can't be matched to the owner's login, and the activity still has no instructor | `seedPotteryDefaults` |
| 3 | *(code only)* "Set your hours" counts as done as soon as **anyone** has hours | A second instructor with no hours still leaves the checklist looking complete | `getOnboardingState` (`staff > 0 && rules > 0`) |

## Locations

| # | Problem | Why it matters | Where |
|---|---|---|---|
| 10 | The **Create activity** form's Where section says *"None set up. Add them in Settings."* **Settings has no location section**: none of its 12 tabs, nor Website or Integrations, can create one. | The app sends new operators to a screen that doesn't exist | `client/src/pages/Classes.tsx` (activity editor, Where) |
| — | There's no location screen anywhere in the dashboard. The only way to get one is **Set up my studio** (also listed in `user-guide-create-activity.md`). | Every location problem above traces back to this | — |

## Activities

| # | Problem | Why it matters | Where |
|---|---|---|---|
| 8 | **Create activity** has six sections (Basics, Pricing, Where, Availability, Presentation, Policies). None asks who teaches it. | Every new activity starts with no instructor | `client/src/pages/Classes.tsx` (activity editor) |
| 6 | The activity card warns "No instructor assigned" but has no button to fix it. Instructors can only be assigned from Staff & Guides. | The operator has to guess where to go. The server already supports assigning from the activity side (`PUT /services/:id/staff`). | `Classes.tsx` (catalogue card) |
| 7 | "Live activities: **Bookable right now**" counted the kayak tour while its card said "no locations" and "No instructor assigned" | The headline number says everything is fine | `Classes.tsx` (`bookable` = active only) |
| 11 | After **Create activity** saves and schedules sessions, the page still says "No classes in this range" and "0 seats scheduled" until a reload | The operator thinks nothing was scheduled | `Classes.tsx` (list isn't refetched after create) |
| 12 | Scheduled sessions with no location and no instructor look like any other ("0/10 booked"), with no warning | Combined with #16, these are the sessions that silently disappear | `Classes.tsx` (Scheduled classes list) |
| 1 | *Corrected:* the Create activity form **does** warn *"Pick a location above, or these classes will not appear on your booking page."* But (a) a new studio has no location to pick (#10), and (b) the warning is wrong while the studio has no locations at all, when the sessions **do** appear, until #16 hides them. The separate **Schedule a class** form still defaults Where to "Not set" with no warning *(code only)*. | The rule is real but conditional, so both the warning and its absence mislead | `Classes.tsx` |
| — | The form's placeholders and icons are pottery-specific ("Beginner wheel throwing", "Park on Kiln Street", 🏺) for every business | A tour business feels it's using someone else's product | `Classes.tsx` |

## Customer booking

| # | Problem | Why it matters | Where |
|---|---|---|---|
| 14 | Nothing tells the customer **where** to go: not the booking form, the confirmation or the manage page. The form says "Payable at the studio" but gives no address or meeting point. | For a kayak tour, "the studio" means nothing | Booking page, confirmation and manage page (`server/src/modules/public/`) |
| 13 | The public home page promises *"Secure card payment… handled by Stripe"* while the booking form says "Payable at the studio" (this studio has no Stripe) | Two pages contradict each other | Storefront home (`server/src/modules/marketing` / public templates) |
| 15 | The manage page lets a customer **cancel** but not **reschedule**. The status also shows as a raw code ("CONFIRMED"). | A customer who needs a different date must cancel and rebook, and may not bother | Public manage page |
| 5 | *(code only)* An activity with no bookable times ends at "No dates scheduled yet. Check back soon.", with no waitlist offer or studio contact | A dead end. Seen for real in #16. | `booking-page.client.ts` |

## Worked well

- Signup is short: studio name, your name, email, password. It lands straight on setup.
- The new studio got the browser's timezone (Asia/Calcutta), not New York.
- The customer booking flow is quick and clear: pick activity → date → details → confirmed, with a reference, **Add to calendar** and **Manage or cancel**.
- The form correctly said "Payable at the studio" when no card payments were set up.
- Sessions were created at the right local time (17:00 IST).

## Smaller notes

- Prices show in **$** for a studio in India. Currency defaults to USD rather than following the studio's country.
- The "Schedule a class" form is shown on an empty Activities page, before there's anything to schedule.

---

## Suggested fixes, in order

1. **Fix #16 first.** When a studio gets its first location, assign it to sessions that have none, the same way staff are now placed automatically. At minimum, make the storefront home and `/book` use the same rule, and warn the operator.
2. **A location screen** (#10) and a quick start that isn't pottery-only (#4). Most location problems go away once operators can create and choose locations themselves.
3. **A "Can customers book this?" check** on every activity, session and staff card: instructor → hours → location → sessions → published, with a **Fix** button on each warning. Covers #6, #7, #12, #17.
4. **Creation flows that make the links as you go.** Create activity asks who teaches it; setup makes the owner the instructor, with their real email (#8, #18).
5. **Tell customers where to go** (#14), and let them reschedule (#15).

## Not covered yet

- [ ] One to one activities (availability with instructor hours)
- [ ] Staff & Guides flows: adding a second instructor, invitations, My schedule
- [ ] Courses
- [ ] Payments with Stripe connected (deposits, refunds)
- [ ] Confirmation and reminder emails and SMS content
- [ ] Mobile layout of the booking page
