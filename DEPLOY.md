# Deploying to the Hostinger VPS

Staging deploy onto the **shared** box that already runs n8n and SEBVM behind
Traefik. Noindexed, Stripe in test mode.

Replace `artweel.fillforge.cloud` throughout if your hostnames differ. Every
command runs on the VPS over SSH unless it says otherwise.

---

## What actually gets deployed

Three containers, no host configuration at all:

| Container | Role | Reached via |
|---|---|---|
| `artweel-api` | REST API **and** marketing site **and** booking pages | Traefik → `artweel.fillforge.cloud` |
| `artweel-client` | dashboard SPA, static, nginx inside the container | Traefik → `app.artweel.fillforge.cloud` |
| `artweel-postgres` | Postgres + PostGIS | nothing external; internal network only |

The marketing pages and booking pages are TypeScript modules that emit HTML
strings, so there is no static site to build for them. The notification outbox
drainer and the calendar sync worker run **inside the API process** — there is
no separate worker container.

No Redis: `REDIS_URL` is declared optional in config and read nowhere else in
the codebase.

**Nothing is published to a host port.** Traefik owns 80 and 443 and reaches
these containers over the `n8n_default` network. This matters concretely:
SEBVM's `express-server` already publishes `0.0.0.0:4000`, so a second bind on
4000 would fail at startup. Our API still listens on 4000 *inside its own
container*, where there is no collision.

**There is no certbot step.** Traefik issues and renews certificates through
the same `mytlschallenge` resolver the other two projects use.

Two hostnames, matching the split the config already expects:

- `artweel.fillforge.cloud` → `PUBLIC_URL` — marketing, booking pages, webhooks
- `app.artweel.fillforge.cloud` → `APP_URL` — dashboard

---

## Step 0 — Confirm the box matches these assumptions

The compose file was written from SEBVM's. Verify rather than assume, because
every one of these is load-bearing.

```bash
docker network ls | grep n8n_default
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

You need `n8n_default` to exist, and you should see Traefik holding 80 and 443.

Confirm the certificate resolver is really called `mytlschallenge` — it is a
name chosen when Traefik was set up, not a standard:

```bash
docker inspect $(docker ps -qf name=traefik) --format '{{range .Config.Cmd}}{{println .}}{{end}}' | grep -i certificatesresolvers
```

If it prints a different name, change `tls.certresolver` in the four places it
appears in `docker-compose.prod.yml`. A wrong resolver name fails at
certificate issuance, and the symptom is a browser TLS warning rather than a
clear error.

Check there is room for another Postgres and two Node-ish containers:

```bash
free -h && df -h /
```

---

## Step 1 — DNS

Add two A records pointing at the VPS IP:

```
artweel      A   <vps-ip>
app.artweel  A   <vps-ip>
```

Verify before continuing — Traefik's ACME challenge fails if DNS hasn't
propagated, and it then backs off before retrying:

```bash
dig +short artweel.fillforge.cloud app.artweel.fillforge.cloud
```

---

## Step 2 — Get the code onto the VPS

This is your step — version control is yours to run. Clone into `~/artweel`;
everything below assumes that path.

---

## Step 3 — Stripe test keys, before first boot

Order matters. `NODE_ENV=production` refuses to start without
`STRIPE_SECRET_KEY` *and* `STRIPE_WEBHOOK_SECRET`, and the signing secret only
exists once the endpoint does. So create the endpoint first, even though
nothing is listening at that URL yet — Stripe does not check reachability at
creation time, and failed deliveries simply retry.

In the Stripe dashboard with **Test mode** on:

1. **Developers → API keys** → copy the **Secret key** (`sk_test_…`).
2. **Developers → Webhooks → Add endpoint**
   - URL: `https://artweel.fillforge.cloud/webhooks/stripe`
   - Events — the app handles exactly these:
     - `checkout.session.completed`
     - `checkout.session.expired`
     - `account.updated`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Also tick **listen to events on connected accounts** — `account.updated`
     is how a studio's Connect onboarding completion gets recorded.
3. Copy the endpoint's **Signing secret** (`whsec_…`).

Nothing charges real money in test mode. Card `4242 4242 4242 4242` with any
future expiry completes checkout end to end.

---

## Step 4 — The secrets file

```bash
cd ~/artweel
cp deploy/env.production.example server/.env.production
```

Generate the four secrets:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET  (must differ from the access one)
openssl rand -base64 32   # CREDENTIAL_ENCRYPTION_KEY
```

Edit `server/.env.production` and fill in:

- `POSTGRES_PASSWORD` **and the same password inside `DATABASE_URL` and
  `SHADOW_DATABASE_URL`** — three places, one value. This is the single most
  common way this deploy fails.
- both JWT secrets, and `CREDENTIAL_ENCRYPTION_KEY`
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from step 3
- `PUBLIC_URL` / `APP_URL` if your hostnames differ

Use the hex password, not base64: `+` and `/` inside a connection string need
percent-encoding, and the resulting failure blames the credentials instead.

```bash
chmod 600 server/.env.production
```

The root `.gitignore` already ignores `.env.*`, so this file cannot be
committed by accident.

---

## Step 5 — Database first, then migrations, then the app

Start Postgres alone and let it become healthy:

```bash
cd ~/artweel
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml ps
```

Build the API image and migrate the live database:

```bash
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
```

`migrate deploy` replays committed migrations, needs no TTY and no shadow
database — the `prisma migrate dev` problem from the Windows box does not exist
here. The first migration creates the `postgis` and `btree_gist` extensions,
which is why the image must stay `postgis/postgis`.

Start the API and the dashboard:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f api
```

You want `Scheduling core listening`. If the process exits immediately, config
validation rejected something and the message names the variable.

Because nothing is published to the host, check health from inside the
container rather than with `curl localhost:4000`:

```bash
docker compose -f docker-compose.prod.yml exec api wget -qO- http://127.0.0.1:4000/api/health
```

That endpoint asserts Postgres **plus both extensions**, so it is a real check
and not just a liveness ping.

Confirm Traefik picked up the routers:

```bash
docker logs $(docker ps -qf name=traefik) --tail 50 | grep -i artweel
```

---

## Step 6 — Seed a demo studio (optional)

Useful on staging: it gives you a real booking page to show people.

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed
```

It prints a booking URL and login. Skip it if you would rather exercise the
self-serve signup path, which is what the Phase 1 exit gate actually covers.

---

## Step 7 — Verify

```bash
curl -s https://artweel.fillforge.cloud/api/health
curl -sI https://artweel.fillforge.cloud/ | grep -i x-robots-tag
```

Health must show Postgres, postgis and btree_gist all good. The second must
return `noindex, nofollow` — that is the Traefik middleware keeping an
unsettled product name out of search results.

Note the app still serves `robots.txt` with `Allow: /`, and that is correct
here rather than a leak: a crawler has to be permitted to *fetch* a page in
order to see the `noindex` header telling it not to *index*. Disallowing the
fetch would leave the URL eligible to appear from inbound links alone.

Then in a browser:

1. `https://artweel.fillforge.cloud` — marketing site
2. `https://artweel.fillforge.cloud/public/clay-and-co` — booking page, if seeded
3. `https://app.artweel.fillforge.cloud` — dashboard; sign up as a new studio
4. Take a test booking with card `4242 4242 4242 4242`
5. Stripe dashboard → Developers → Webhooks → your endpoint — deliveries should
   be 200s. A 400 here is almost always the signing secret.

That sequence is the Phase 1 exit gate, run against the deployed system.

---

## Redeploying after a change

```bash
cd ~/artweel
git pull                                                     # your step
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d
```

Migrations run before the new containers start, so any migration written from
Phase 2 onward must be safe against the *old* code still serving requests for
those few seconds — additive columns, no destructive rename in a single step.

---

## Operations

```bash
# logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs --tail=200 postgres

# restart just the API
docker compose -f docker-compose.prod.yml restart api

# psql on the live database
docker compose -f docker-compose.prod.yml exec postgres psql -U booking -d booking

# backup (copy it OFF this box — it is the only machine that has it)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U booking -d booking --format=custom > artweel-$(date +%F).dump

# restore
cat artweel-2026-08-10.dump | docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U booking -d booking --clean --if-exists
```

Postgres is not reachable from outside the stack by design. If you need a GUI
client, tunnel it over SSH rather than publishing a port:

```bash
ssh -L 5434:artweel-postgres:5432 <user>@<vps-ip>
```

---

## Not wired up by this deploy

Being explicit so none of these is a surprise later:

- **Automated backups.** The dump command above is manual, scheduled by
  nothing, and copied nowhere off the VPS.
- **SMS.** Twilio credentials are intentionally blank; messages are logged, not
  sent. Filling them in before A2P 10DLC approval is *worse* than leaving them
  blank — carriers filter unregistered US traffic silently, so messages look
  sent and never arrive.
- **Email.** `RESEND_API_KEY` blank means the same: logged, not sent.
- **Live payments.** Test mode only, pending the Connect platform application.
- **Google Calendar.** Blank credentials fall back to the in-memory fake
  provider. To make it real, register
  `https://artweel.fillforge.cloud/api/calendar/callback` as the redirect URI
  in Google Cloud console and fill the two variables.
- **Monitoring.** Nothing watches this. `restart: unless-stopped` brings
  containers back after a crash or reboot; it does not tell you it happened.
