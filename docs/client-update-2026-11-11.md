**Subject:** Booking app update: 19 of your items are live, and a few questions

Hi Jeff,

Thanks for the detailed feedback. Here's where everything stands. Everything listed under "Done" is live now at app.bookaihub.com.

## Done

**Booking at the desk (manual bookings)**
- You can book a date that has no session yet. The form lets you pick an existing session or create one on the spot, and it keeps the guest's details while you do.
- "Departure" now says "Session time".
- Guest numbers start at 0. Typing replaces the number instead of making "12" or "01", and you can't book more places than are left.
- If there's nothing to book, the form says why. Classes (multi-session courses) are booked from the Class's own page, and the form now links there.

**Calendar**
- Week view shows every session, with how many places are booked.
- Month view shows the full class name and time, without cutting them off.
- There's a new Day view. The views are ordered Day, Week, Month, and Today is its own button.

**Your public booking site**
- The What / Category / When bar is gone from Home and Activities.
- On phones you get one card per row, with a clear price ("per person", or "for all N sessions" for a Class) and a "Choose a date" button.
- The cancellation tile now reads "48 hours · notice to cancel for free". Every page uses the same sentence: "Free cancellation up to 48 hours before it starts".
- Totals update as you type the number of guests, not only when you use the arrows.

**Checkout**
- If your studio requires a phone number, the field says "Mobile" (not "optional") and asks for it before the customer can continue. The number is also kept for paid bookings now.

**Photos**
- Activities can have a photo and staff can have a portrait. You can upload, crop, replace or remove them and add a description, and there's a phone preview.

**Activities**
- "Type" is now "Booking format", and it says what each one means. A Class is a multi-session course booked as a whole series, with one price for every session. An Event is a single date, priced per seat.
- Categories work now. Use the new Categories button on the Activities page, or choose "+ New category…" while editing an activity.
- Statuses use the same three words everywhere:
  - **Draft:** started, not finished.
  - **Hidden:** saved, but not on your booking page.
  - **Published:** customers can book it.

  Every activity shows its status.

**Phone numbers and prices**
- Phone numbers now read the same way everywhere, for example "(555) 010-2200". Numbers with another country code stay as typed. Prices follow one rule: "$95", or "$95.50" when there are cents.
- Text messages now reach customers who typed their number with brackets or dashes. Before, those numbers could not be texted.

**Notifications**
- Each message has a "Restore default" button that brings back the original wording. Editing, preview, merge fields and "Send me a test" were already there.

**Staff (an extra, from your comments)**
- Adding a staff member is now a few short steps: who they are, what they teach, their hours, their profile, then review. They can be booked as soon as you add them, and you can send them a login invite at the end. Editing someone uses the same steps.

## Could you retest these?

The full booking cycle, please (item 23):
1. Make a booking that you pay for.
2. Check the confirmation email.
3. Check the payment shows on your side.
4. Check the places left go down.
5. Cancel it.
6. Reschedule it.
7. Refund it.

Your payments are in **Stripe test mode**, so no real money moves. To pay, use card number **4242 4242 4242 4242**, any future expiry date and any 3-digit CVC. Anyone can make the first purchase this way (item 22).

## A few questions

1. **Phone and currency formats (item 17).** These are fixed everywhere I could find. If any screen still looks off, a screenshot would help.
2. **Test offers on the public site (item 19).** Which activities are leftovers from testing? I'll hide them.
3. **The Valentine event (item 14).** Which studio and which screen did you see it on? I couldn't find it in the account I checked.
4. **More instructors for testing (item 25).** Which studio account should I upgrade for free, so you can try several instructors without paying?
5. **Tax (item 26).** Do you need tax added to prices? If so, what kind, and at what rate?

## Coming next

- An automatic **20% off Monday to Thursday sessions** (item 20), then **promo codes** (item 21). I'll send a short plan before building them.
- Return-visit offers, referral rewards, better data exports and catalogue layouts (items 27–29) are on the list after that.

Thanks,
Suren
