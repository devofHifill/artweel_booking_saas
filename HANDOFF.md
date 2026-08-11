# Handoff — Artweel Booking SaaS

Paste this into a new chat to resume work.

---

## What this is

A multi-tenant booking platform for **US ceramics studios** — classes, private
lessons and mobile pottery parties. Self-serve SaaS. Evolved from FDG's earlier
WordPress "WP Booking Flow" plugin, which is a design reference only, not code
to port.

**Positioning:** studio management that understands wheels, kilns and travel.
Competitors (Momence, Sawyer, Punchpass) treat location as a text label and
have no concept of equipment.

- Repo: `https://github.com/devofHifill/artweel_booking_saas.git`
- Code: `D:\Projects\2026\booking-saas`
- Spec: `D:\Projects\2026\booking-saas-spec.md`
- Phase plan: `D:\Projects\2026\booking-saas-phases.pdf`

## Status

**Phase 0 and Phase 1 complete.** 327 tests green in the default suite, plus an
isolated performance gate at ~150ms p95. Both typechecks clean.

Shipping: auth/tenancy, admin CRUD, public booking page, Stripe Connect
payments, notifications (email + SMS outbox), Google Calendar two-way sync,
owner dashboard, onboarding + billing, marketing site + SEO.

Phase 1 exit gate was met and browser-verified: a stranger signed up, seeded a
studio, published, and the page took a real booking — four interactions.

---

## RULES THAT MUST NOT BE BROKEN

### 1. Never run git or gh commands

Suren does all version control manually — he is deliberately learning it. Do
not run `init`, `add`, `commit`, `push`, or repo creation. Not even `status`
unless asked in that moment. Build files; say when version control would be the
natural next step, then stop.

### 2. Phase 0's guarantees are settled — do not weaken them

Correctness lives in Postgres, not application code:

- `staff_time_blocks` has `EXCLUDE USING gist (staff_id WITH =, tstzrange WITH &&)`.
  Appointments AND sessions both write here, because Postgres cannot enforce
  exclusion across two tables — that is how an instructor with a 2pm lesson and
  a 2pm class gets caught.
- `sessions.seats_taken` is mutated only under `SELECT … FOR UPDATE`, with a
  `CHECK (seats_taken <= capacity)` backstop.
- Exclusive resources (kiln, room, van) use a partial `EXCLUDE WHERE (exclusive)`
  kept honest by a `BEFORE` trigger. Counted resources (wheels) use a locked row
  plus a `SUM` — no exclusion constraint can express "at most eight".
- All instants are `timestamptz`; recurrence stores wall-clock intent + IANA zone
  and is re-resolved per date. Never fixed-millisecond stepping.
- Availability makes **no external network call**; calendars are mirrored into
  `busy_blocks` by a background sync.

### 3. Marketing copy may not describe unshipped features

Piece tracking, kiln loads, courses and waitlists are Phase 2. They appear only
under "Being built next — not available yet". A test enforces this.

---

## ENVIRONMENT GOTCHAS

| Thing | Detail |
|---|---|
| Postgres port | **5434**, not 5432/5433. A native Windows Postgres owns `0.0.0.0:5433` and beats Docker's proxy for IPv4 localhost — symptom is "invalid credentials" while the container is healthy. Redis is 6380. |
| Docker | Desktop frequently isn't running. Start `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`, poll `docker info`, then `docker compose up -d`. |
| Migrations | `prisma migrate dev` needs a TTY and fails here. Use `prisma migrate diff --from-migrations … --script` into a temp file, write it to a new `prisma/migrations/<timestamp>_name/migration.sql`, then `prisma migrate deploy`. |
| PowerShell + .NET | `[System.IO.File]::WriteAllText` uses the *process* CWD, not `Set-Location`. Always pass absolute paths. |
| Perf suite | Must run **alone**: `npm run test:perf`. It is excluded from `npm test`. Running it alongside anything else inflates p95 and produces a false failure. |
| Test plan defaults | `signUpStudio` defaults orgs to plan `PRO` so plan limits don't interfere with unrelated suites. Billing tests pass `plan: 'SOLO'` explicitly. |

---

## COMMANDS

```
cd server && npm test              # 327 tests, ~3 min
cd server && npm run test:perf     # isolated timing gate — run alone
cd server && npm run typecheck
cd server && npm run db:seed       # prints booking URL + login
cd server && npm run dev           # API on 4000
cd client && npm run dev           # dashboard on 5173
```

| URL | What |
|---|---|
| `localhost:4000` | Marketing site |
| `localhost:4000/public/clay-and-co` | A studio's booking page |
| `localhost:5173` | Studio dashboard |
| `localhost:4000/api/health` | Asserts Postgres + PostGIS + btree_gist |

---

## OPEN DECISIONS

1. **Product name.** Repo says "artweel"; code still says "Studio Bookings"
   everywhere (marketing titles, JSON-LD, notification sender, package names).
   Needs a decision then a find-and-replace. Matters because SEO bakes in
   `PUBLIC_URL` and re-indexing later is costly.
2. **Talk to three US ceramics studios** before building Phase 2. Pieces, kilns
   and courses rest on inference, not evidence, and Phase 2 is the most
   expensive phase to build the wrong version of.
3. **Stripe Connect platform application** and **Twilio A2P 10DLC** — both
   code-complete, both blocked on approval queues. Without 10DLC, US SMS is
   carrier-filtered: it looks sent and never arrives.

---

## NEXT: PHASE 2 (~7 weeks, scope fixed)

Course series with cohorts → attendance + make-up credits → piece tracking with
pickup SMS → kiln/firing management → resources → waitlists + packages →
embeddable widget + WordPress plugin.

**Nothing else.** Every studio interviewed will request something adjacent;
those go to Phase 3. This is the phase where scope creep is most tempting and
most damaging.

Exit gate: a studio runs a full six-week course (enrolment, attendance, one
absence, a redeemed make-up credit) and a full firing cycle (piece created →
both firings → collected, with the pickup notification delivered).
