# TourFlow

> All-in-one booking & management platform for tours and experiences.

A complete, clickable **front-end prototype** of a FareHarbor-style booking SaaS.
Two surfaces — the operator dashboard and the guest booking site — running on one
shared JavaScript state, so a seat sold on the customer side really disappears
from the operator's capacity.

Plain HTML, CSS and vanilla JavaScript. No framework, no build tools, no backend.

## Running it

Open `index.html` in a browser. That is the whole procedure — no npm, no server.

Served from the Artweel host it lives at `/demo/tourflow/`.

| Entry point | What it is |
| --- | --- |
| `index.html` | launcher — pick a side of the product |
| `admin.html` | operator dashboard (13 screens, hash-routed) |
| `booking.html` | customer booking site + 7-step booking flow |

## File structure

```
tourflow/
  index.html            launcher
  admin.html            operator dashboard shell
  booking.html          customer booking site shell
  css/
    style.css           design system: tokens, components, layout
    booking.css         customer storefront layer
    responsive.css      tablet + mobile behaviour for both
  js/
    data.js             the whole dummy dataset, generated around today
    utils.js            state store, selectors, mutations, formatting, icons,
                        toasts, modals, drawers  (loaded by BOTH surfaces)
    app.js              admin shell: sidebar, top bar, router, global search
    dashboard.js        Dashboard
    bookings.js         Bookings list, drawer, create/edit, reschedule, cancel
    calendar.js         Calendar (month/week/day), slots, recurring, blocking
    activities.js       Activities catalogue + create/edit
    customers.js        Customers + profile drawer
    staff.js            Staff & guides + assignment
    payments.js         Payment ledger + refunds
    reports.js          Reports (6 tabs, hand-drawn charts)
    manifest.js         Daily manifest + check-in
    notifications.js    Notification automations + templates
    integrations.js     Integrations + Google Calendar sync
    website.js          Website builder + embeddable widget
    settings.js         Settings, users, roles & permissions
    booking-flow.js     the entire customer site and booking flow
  assets/images/        (empty — artwork is inline SVG, emoji and gradients)
```

## How the state works

`data.js` generates the demo business **relative to today** with a seeded PRNG,
so the schedule never looks stale and everybody sees the same business. It is
saved to `localStorage` under `tourflow.demo.v5` and regenerated when the day
rolls over or the version changes.

Every screen reads through the selectors in `utils.js`. Capacity is **derived**
from bookings — never stored on a slot — which is why the operator screens and
the customer site can't disagree. Reset from the dashboard profile menu.

## What is simulated

Payments, refunds and payouts · email and SMS delivery · PDF and CSV export ·
every third-party integration (Viator, Tripadvisor, Google, Stripe, PayPal,
Twilio, Zapier…) · Google Calendar sync · waiver signatures · authentication.

No API keys, no network requests, no real customer data. Every business, guest,
price and review is fictional.

## What would need a real backend in production

Server-side capacity locking (the browser cannot prevent two people buying the
last seat), payment processing and webhooks, transactional email/SMS delivery,
authentication and session management, server-enforced roles and permissions,
channel-manager sync, PDF generation, timezone-correct instant storage, audit
logging, and multi-user concurrency.
