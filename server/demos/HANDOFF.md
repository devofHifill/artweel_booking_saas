# TourFlow demo — handoff

Written 2026-08-19. Read this first if you are picking the demo work up in a
new session.

---

## Status

**Built and verified locally. Not committed, not deployed.**

The TourFlow prototype is complete and works end to end. It is wired into the
Artweel app at `/demo` and the `Demo` nav link renders on the marketing site.
Nothing has been pushed or deployed — git is yours.

Working tree was on **`feature/auth-redesign`** when this was written, with the
demo changes uncommitted on top. Read step 2 below before committing — the
branch choice decides what else ships to staging.

---

## What exists

| Path | What it is |
| --- | --- |
| `server/demos/index.html` | demo gallery served at `/demo` — the shelf for future prototypes |
| `server/demos/tourflow/` | the TourFlow prototype (20 files, 512 KB, zero dependencies) |
| `server/demos/README.md` | how the mount works, and how to remove it |
| `server/demos/tourflow/README.md` | structure, what's simulated, what needs a real backend |

TourFlow has two surfaces on one shared state: the operator dashboard
(`admin.html`, 13 screens) and the customer booking site (`booking.html`,
7-step flow). Open `tourflow/index.html` directly, or browse `/demo/`.

---

## Changes made to the Artweel app (4 files, all marked `TEMPORARY`)

1. `server/src/app.ts` — `express.static` mount at `/demo`
2. `server/Dockerfile` — `COPY demos ./demos` (without this the deployed image has no demos)
3. `server/src/modules/marketing/landing.ts` — `Demo` link, desktop + mobile nav
4. `server/src/modules/marketing/render.ts` — `Demo` link in the marketing-page header

Removal instructions are in `server/demos/README.md`. Nothing else references
them and no test asserts on them.

> `PHASE-2-CLOSEOUT.md` also shows as modified in git. That was **not** part of
> this work — it was already dirty in the working tree.

---

## Verified

- Full guest journey driven in a browser: a booking made on the customer site
  appeared in the admin with seats consumed on that departure, a payment row,
  a new customer, deposit recorded as *Partially Paid*, guide inherited.
- Admin actions: manual booking (correctly refused when the party exceeded
  remaining seats), collect balance, cancel + refund releasing seats, activity
  create, recurring slot series, permission toggle, notification toggle,
  integration connect, settings save, manifest check-in.
- All 13 admin screens, 6 report tabs, 7 website sections, 10 settings
  sections, 3 calendar modes render clean. Every view under 20 ms.
- Mobile 375px on both surfaces: no horizontal scroll, burger and bottom nav work.
- `npm run typecheck` passes.
- `/demo` mount and the `Demo` nav link verified against the **real Express
  app** via supertest — all assets 200, unknown paths still hit the app's own 404.

## Not verified

- **`npm test` was never run** — Docker Desktop was down, so Postgres on
  `localhost:15432` was unreachable and the DB-backed suites could not start.
  The design-token suite passed and no test touches the nav or `/demo`, so
  nothing is expected to break. **Run it before deploying.**
- Nothing has been deployed to staging.

---

## Next session — do these in order

### 1. Run the test suite

```bash
docker compose -f D:/Projects/2026/booking-saas/docker-compose.yml up -d
```

```bash
npm test --prefix D:/Projects/2026/booking-saas/server
```

Expect the existing suite to pass unchanged (499+ tests as of Phase 2 closeout).

### 2. Decide which branch this ships on

**As of 2026-08-19 the working tree is on `feature/auth-redesign`, and the demo
changes are uncommitted on top of it.** That matters because the VPS deploys
whatever branch it has checked out — commit the demo there and pull that branch
on the box, and the auth redesign ships with it, finished or not.

| Option | When it fits |
| --- | --- |
| Commit to `feature/auth-redesign` and deploy it | the auth redesign is already staging-ready |
| Commit there, then merge only into the deployed branch | normal flow, slightly more git |
| Put the demo on its own branch off the deployed one | cleanest separation, most fiddly since the changes are uncommitted |

Remote is `https://github.com/devofHifill/artweel_booking_saas.git`.

### 3. Commit and push — your step

Git is yours; Claude does not run it. `PHASE-2-CLOSEOUT.md` is dirty from
earlier work, so the `add` below names paths explicitly and leaves it alone.

```bash
git -C D:/Projects/2026/booking-saas status --short
```

```bash
git -C D:/Projects/2026/booking-saas diff server/src/app.ts server/Dockerfile server/src/modules/marketing/landing.ts server/src/modules/marketing/render.ts
```

```bash
git -C D:/Projects/2026/booking-saas add server/demos server/src/app.ts server/Dockerfile server/src/modules/marketing/landing.ts server/src/modules/marketing/render.ts
```

```bash
git -C D:/Projects/2026/booking-saas commit -m @'
Add TourFlow prototype under a temporary /demo mount

Static front-end prototype of a tours & activities booking SaaS, served
from server/demos at /demo. Plain HTML/CSS/vanilla JS, no dependencies,
no database, no API — it shares nothing with the app.

Wiring is deliberately minimal and marked TEMPORARY in all four places:
express.static mount in app.ts, COPY demos in the Dockerfile, and the
Demo nav link in marketing/landing.ts and marketing/render.ts. Removal
instructions live in server/demos/README.md.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
'@
```

```bash
git -C D:/Projects/2026/booking-saas push -u origin feature/auth-redesign
```

### 4. Deploy to staging

Claude cannot SSH this box (root is password-only), so these are for you to
paste. The `my-vps` SSH alias points at a **different** machine — connect by IP.

```bash
ssh root@187.127.186.115
```

```bash
cd ~/artweel
```

Check which branch the box is actually on before pulling:

```bash
git status -sb
```

```bash
git pull
```

```bash
docker compose -f docker-compose.prod.yml build api
```

```bash
docker compose -f docker-compose.prod.yml up -d api
```

**No migration is needed** — this change adds no schema. Only if the branch you
deploy carries new migrations from other work, run this before `up -d`:

```bash
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
```

### 5. Verify — by the startup logs, not the health check

A deploy that shipped nothing looks identical from outside: health green,
routes 200, genuinely fresh uptime, because the container did restart — on the
old image.

```bash
docker compose -f docker-compose.prod.yml logs --tail=80 api
```

```bash
curl -sI https://artweel.fillforge.cloud/demo/ | head -1
```

```bash
curl -s https://artweel.fillforge.cloud/demo/tourflow/ | grep -o '<title>.*</title>'
```

Expect `HTTP/2 200` and
`<title>TourFlow — All-in-one booking & management platform</title>`. Then open
`https://artweel.fillforge.cloud/` and confirm the `Demo` link is in the header.

### 6. Rollback, if needed

Nothing here touches the database, so a rollback is just the image — no data to
unwind.

```bash
git -C ~/artweel checkout HEAD~1
```

```bash
docker compose -f docker-compose.prod.yml build api && docker compose -f docker-compose.prod.yml up -d api
```

---

## Decisions locked in this session

- **The `Demo` nav link is temporary.** Suren will move the demo off this
  platform before launch. That is why the mount, the Dockerfile line and both
  nav links carry `TEMPORARY` comments and a removal note — treat them as
  scaffolding, not product.
- **`/demo` is a gallery, not a single link.** Future prototypes drop in as
  their own folder under `server/demos/` plus a card in `demos/index.html`.
- **No booking nudge.** The usual FDG "Hey, you like it 👋" Calendly popup was
  deliberately left out — TourFlow is a pure product demo with no sales overlay.
- **Content Security Policy is the constraint that matters.** The app runs
  `default-src 'self'`. Everything in the demo is same-origin and
  self-contained: no CDN, no web font, no external image, no network call.
  Break that and the demo silently dies behind the CSP.

---

## If the next conversation is about building TourFlow for real

Estimate given 2026-08-19, assuming Claude Code writes the code at two sessions
per day:

| Target | From scratch | Forked from Artweel |
| --- | --- | --- |
| Internal alpha (real DB, auth, test-mode payments) | 4–6 weeks | 2–3 weeks |
| First real operator taking real money | 3–4 months | 6–9 weeks |
| Commercial self-serve SaaS | 5–6 months | 3–4 months |

**Forking Artweel is the single biggest lever** — the domains overlap ~70%
(seat-based capacity, staff availability, Stripe Connect, notification outbox,
Google Calendar sync with the loop guard, waitlists, packs, multi-tenancy,
billing, superadmin). Genuinely new for TourFlow: OTA channel sync, per-departure
guide manifests, waivers, and deposit / pay-later flows.

What will actually set the pace, in order:

1. **Review bandwidth, not code output.** Two build sessions a day produce more
   than one person can exercise. Budget ~1 review session per 2 build sessions.
   This repo has already been bitten twice by the failure mode: `makeUpCreditsEnabled`
   shipped complete, tested and unreachable, and three expiry sweeps were written,
   tested and never called from `src/`.
2. **External approvals nobody can code around** — Stripe Connect platform
   application, Twilio A2P 10DLC (2–6 weeks; without it US SMS looks sent and
   never arrives), OTA partner programmes (contract + certification, weeks to
   months). Start these on day one, in parallel.
3. **Not having a real operator.** Build the manifest and check-in without a
   tour operator watching you use it on a dock and you will rebuild it.

Recommended before any production code: show this prototype to two or three
real tour operators.
