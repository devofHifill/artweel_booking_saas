# Connecting Stripe

How to connect your studio to Stripe so customers can pay online, what each status means, and how payouts, refunds and your bookaihub plan work.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Step 1: Start in bookaihub](#step-1-start-in-bookaihub)
3. [Step 2: Fill in Stripe's pages](#step-2-fill-in-stripes-pages)
4. [Step 3: Check your status](#step-3-check-your-status)
5. [Step 4: Payment settings](#step-4-payment-settings)
6. [Step 5: Test it](#step-5-test-it)
7. [Day to day](#day-to-day)
8. [Paying for bookaihub](#paying-for-bookaihub)
9. [Troubleshooting](#troubleshooting)

---

## 1. Before you start

Stripe is the company that takes card payments for you. Money for bookings goes **straight into your own Stripe account**, and from there to your bank. bookaihub never holds it and takes no cut. Stripe charges its standard processing fee.

Only an **Owner** or **Admin** can connect Stripe. Other team members can see the status but not change it.

It takes about 10 minutes. Have these to hand:

| You need | Notes |
|---|---|
| Legal name and date of birth | Of the person responsible for the business |
| Home address | Of that person |
| SSN | The last 4 digits; Stripe sometimes asks for the full number |
| EIN | Only if your business is a registered company |
| Website | Your bookaihub booking page works if you have no other |
| Bank account | Routing and account number, for payouts |

---

## Step 1: Start in bookaihub

Either:

- **Integrations → Payments → Connect Stripe**, or
- **Settings → Payment Settings → Connect Stripe**

You are taken to Stripe's own pages, branded **bookaihub**. Everything you enter there goes to Stripe. bookaihub never sees your bank or identity details.

---

## Step 2: Fill in Stripe's pages

1. **Email and phone.** Enter your mobile number and the code Stripe texts you. If you already have a Stripe login, you can sign in instead.
2. **Business type.** *Individual / sole proprietor* if you have not registered a company. Otherwise *Company* (LLC, corporation…) or *Non-profit*.
3. **Business details.** Legal business name and EIN (companies), industry (for example *Education* or *Recreational services*), and your website. With no website, use your booking page: `https://bookaihub.com/public/your-studio-slug`.
4. **Personal details.** Legal first and last name, email, date of birth, home address, phone, and the last 4 digits of your SSN. Companies also add owners and directors.
5. **Payout account.** The bank account (routing and account number) that should receive the money, or a debit card.
6. **Public details.** The **statement descriptor** customers see on their card statement (keep it recognisable, such as your studio name) and a customer support phone number.
7. **Review and submit → Agree and submit.**

Stripe sends you back to **Settings → Payment Settings**, which checks with Stripe straight away.

---

## Step 3: Check your status

**Settings → Payment Settings** shows where you are:

| It shows | What it means | Do this |
|---|---|---|
| **Not connected** | No Stripe account yet | **Connect Stripe** |
| **Connected — not yet able to take payments** | Stripe still needs something, or is still checking | **Finish Stripe setup** to fill in what is missing, then **Refresh status**. The note under the buttons says how many details Stripe still wants |
| **Connected — taking payments**, Payouts **Enabled** | Done | Nothing |
| "Your Stripe setup link expired before you finished" | Stripe's page was left open too long | **Continue Stripe setup**. You carry on where you left off |
| "…can't be reached with the platform's Stripe key…" | Your account was made under an old setup | **Finish Stripe setup**. A fresh account is created; go through Step 2 again |

Stripe's checks can take from a few minutes to a day. Come back and press **Refresh status**, or just look again later: Stripe tells bookaihub when anything changes.

**Integrations** shows the same status, with a warning if you are connected but cannot take payments yet.

---

## Step 4: Payment settings

Still on **Settings → Payment Settings**:

| Setting | What it does |
|---|---|
| **Deposit percentage** | What a **new** activity starts at. `0` means full payment. Each activity's deposit is set on the activity afterwards (**Activities → the activity**) |
| **Let guests pay a deposit instead of the full amount** | The master switch: off turns deposits off everywhere, whatever an activity says |
| **Allow "pay on arrival" bookings** | Lets customers book now and pay on the day, even with Stripe connected |
| **Accept cash at the meeting point** | Shown to customers as a way to pay |

Press **Save changes**.

How much a cancellation refunds is set in **Settings → Cancellation Policy**.

---

## Step 5: Test it

1. Open your booking page (**View booking page**, top right) and book a class.
2. Pay with a card.
3. The booking shows as paid under **Bookings**, and the money under **Payments**.
4. Cancel the booking from **Bookings** to refund it.

If bookaihub has told you your account is in **test mode**, no real money moves: pay with the card `4242 4242 4242 4242`, any future expiry date, any CVC and any ZIP.

---

## Day to day

- **Refunds.** **Bookings** → cancel the booking (one, or several selected at once). The refund follows your cancellation policy and comes out of your Stripe balance. Owners and admins only.
- **Payouts, balance, disputes and tax forms** are in Stripe's own dashboard. Sign in at <https://connect.stripe.com/express_login> with the email or phone you used in Step 2.
- **Fees.** Stripe's standard processing rates. bookaihub takes nothing.

---

## Paying for bookaihub

Your bookaihub plan is billed separately from your customers' payments, and does not need Stripe to be connected.

1. Open **Plan and billing** (account menu → Plan and billing).
2. **Choose Solo, Studio or Pro** → pay on Stripe's page. You come back to Plan and billing, and the plan switches as soon as Stripe confirms, usually within a minute.
3. Once subscribed, **Manage billing — card, invoices, cancellation** opens Stripe's billing page, where you can change your card, download invoices or cancel.
4. **To change plan while subscribed, contact bookaihub** rather than pressing a different plan's button. That would start a second subscription.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Customers aren't asked to pay | Stripe isn't connected, or can't take payments yet | Step 3 |
| "Connected — not yet able to take payments" for a long time | Stripe is waiting on a detail or a document from you | **Finish Stripe setup**, then **Refresh status** |
| Customers see "This studio is not set up to take payments yet" | Same as above | Step 3 |
| "Your Stripe setup link expired" | Stripe's page was open too long | **Continue Stripe setup** |
| "Stripe would not start payment setup…" or "can't be reached with the platform's Stripe key" and **Finish Stripe setup** does not clear it | A problem on bookaihub's side | Contact bookaihub |
| Payouts **Not enabled yet** | Stripe still checking your bank details | Wait, then **Refresh status**. Check Stripe's dashboard for anything it asks for |
