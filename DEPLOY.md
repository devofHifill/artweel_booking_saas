# Deploying to the Hostinger VPS

Staging deploy, noindexed, Stripe in test mode.

Replace `artweel.fillforge.cloud` throughout if your hostnames differ. Every
command runs on the VPS over SSH unless it says otherwise.

---

## What actually gets deployed

Three things, not four:

| Piece | Where it runs | Served by |
|---|---|---|
| Marketing site + studio booking pages | inside the Node API | nginx → `127.0.0.1:4000` |
| REST API + background workers | Node container | nginx → `127.0.0.1:4000` |
| Studio dashboard (React SPA) | nowhere — it's a static bundle | nginx from `/var/www/artweel-app` |
| Postgres + PostGIS | container | nothing public; `127.0.0.1:5434` for tunnelled admin only |

The marketing pages and booking pages are TypeScript modules that emit HTML
strings, so there is no static site to build for them. The notification outbox
drainer and the calendar sync worker run **inside the API process** — no
separate worker service to deploy.

There is no Redis. `REDIS_URL` is declared optional in config and read nowhere
else in the codebase.

Two hostnames, matching the split the config already expects:

- `artweel.fillforge.cloud` → `PUBLIC_URL` — marketing, booking pages, webhooks
- `app.artweel.fillforge.cloud` → `APP_URL` — dashboard

---

## Step 1 — DNS

Add two A records pointing at the VPS IP:

```
artweel      A   <vps-ip>
app.artweel  A   <vps-ip>
```

Check before continuing — certbot fails confusingly if DNS hasn't propagated:

```bash
dig +short artweel.fillforge.cloud app.artweel.fillforge.cloud
```

---

## Step 2 — Get the code onto the VPS

This is your step — version control is yours to run.

Commit and push the new deployment files from Windows, then on the VPS clone
into `~/artweel`. Everything below assumes that path.

New files this deploy added:

```
DEPLOY.md
docker-compose.prod.yml
deploy/env.production.example
deploy/nginx/artweel-proxy.conf
deploy/nginx/artweel-public.conf
deploy/nginx/artweel-app.conf
server/Dockerfile
server/.dockerignore
server/tsconfig.build.json
server/package.json          (modified — build script)
```

---

## Step 3 — Stripe test keys, before first boot

Order matters here. `NODE_ENV=production` refuses to start without
`STRIPE_SECRET_KEY` *and* `STRIPE_WEBHOOK_SECRET`, and you can only read the
signing secret after creating the endpoint. So create the endpoint first, even
though nothing is listening at that URL yet — Stripe does not check
reachability at creation time, and failed deliveries just retry.

In the Stripe dashboard with **Test mode** toggled on:

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
future expiry works for end-to-end checkout.

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

Then edit `server/.env.production` and fill in:

- `POSTGRES_PASSWORD` **and the same password inside `DATABASE_URL` and
  `SHADOW_DATABASE_URL`** — three places, one value. This is the single most
  common way this deploy fails.
- both JWT secrets, and `CREDENTIAL_ENCRYPTION_KEY`
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from step 3
- `PUBLIC_URL` / `APP_URL` if your hostnames differ

Use the hex password, not base64: `+` and `/` inside a connection string need
percent-encoding, and the resulting failure claims the credentials are wrong.

Lock it down:

```bash
chmod 600 server/.env.production
```

The root `.gitignore` already ignores `.env.*`, so this file cannot be
committed by accident.

---

## Step 5 — Database first, then migrations, then the API

Start Postgres alone and wait for it to be healthy:

```bash
cd ~/artweel
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml ps
```

Build the API image and run migrations against the live database:

```bash
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
```

`migrate deploy` replays the committed migrations and needs no TTY and no
shadow database — the `prisma migrate dev` problem from the Windows box does
not exist here. The first migration creates the `postgis` and `btree_gist`
extensions, which is why the image must stay `postgis/postgis`.

Then start the API:

```bash
docker compose -f docker-compose.prod.yml up -d api
docker compose -f docker-compose.prod.yml logs -f api
```

You want `Scheduling core listening`. If the process exits immediately, config
validation rejected something — the message names the variable.

Confirm the database is genuinely correct, not just reachable:

```bash
curl -s localhost:4000/api/health
```

That endpoint asserts Postgres **plus both extensions**.

---

## Step 6 — Seed a demo studio (optional)

Useful on staging: it gives you a real booking page to show people.

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed
```

It prints a booking URL and login. Skip it if you'd rather test the actual
self-serve signup path, which is what the Phase 1 exit gate covers.

---

## Step 7 — Build and publish the dashboard

No Node needed on the host — build it in a throwaway container:

```bash
cd ~/artweel/client
docker run --rm \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/app -w /app \
  node:22-alpine sh -c "npm ci && npm run build"
```

Running as your own uid keeps `node_modules/` and `dist/` from ending up
root-owned in your home directory.

Publish it:

```bash
sudo rm -rf /var/www/artweel-app
sudo mkdir -p /var/www/artweel-app
sudo cp -r dist/. /var/www/artweel-app/
sudo chown -R www-data:www-data /var/www/artweel-app
```

The bundle needs no build-time configuration: it calls the API with relative
paths, and nginx proxies `/api` on the same origin.

---

## Step 8 — nginx

```bash
cd ~/artweel
sudo cp deploy/nginx/artweel-proxy.conf  /etc/nginx/snippets/
sudo cp deploy/nginx/artweel-public.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/artweel-app.conf    /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/artweel-public.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/artweel-app.conf    /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Check the firewall allows only what it should:

```bash
sudo ufw status
```

80 and 443 open, 4000 and 5434 closed. Both containers publish to `127.0.0.1`
rather than `0.0.0.0` deliberately — Docker writes port mappings straight into
iptables and bypasses ufw, so a `0.0.0.0` binding would be publicly reachable
with the firewall apparently closed.

---

## Step 9 — TLS

```bash
sudo certbot --nginx -d artweel.fillforge.cloud -d app.artweel.fillforge.cloud
```

Choose redirect when asked. Certbot edits both server blocks in place, adding
`listen 443 ssl`, the certificate paths and the 301 from port 80. Renewal is
already a systemd timer; confirm with:

```bash
sudo certbot renew --dry-run
```

Stripe webhooks and Google Calendar OAuth both require HTTPS, so nothing about
payments or calendar works until this step is done.

---

## Step 10 — Verify

```bash
curl -s https://artweel.fillforge.cloud/api/health
curl -s https://artweel.fillforge.cloud/robots.txt
```

The health response must show Postgres, postgis and btree_gist all good. The
robots response must be `Disallow: /` — that is nginx overriding the app's
generated `Allow: /`, which is what keeps the unsettled product name out of
Google.

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
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d api
```

Only when the client changed, repeat step 7.

Migrations run before the new container starts, so any migration you write from
Phase 2 onward must be safe against the *old* code still serving requests for
those few seconds — additive columns, no destructive renames in a single step.

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

# backup (run it somewhere durable, not just on this box)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U booking -d booking --format=custom > artweel-$(date +%F).dump

# restore
cat artweel-2026-08-10.dump | docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U booking -d booking --clean --if-exists
```

---

## Not wired up by this deploy

Being explicit so none of these is a surprise later:

- **Automated backups.** The dump command above is manual. Nothing is scheduled
  and nothing is copied off the VPS.
- **SMS.** Twilio credentials are intentionally blank; messages are logged, not
  sent. Filling them in before A2P 10DLC approval is worse than leaving them
  blank — carriers filter unregistered US traffic silently, so messages look
  sent and never arrive.
- **Email.** `RESEND_API_KEY` blank means the same: logged, not sent. Add the
  key and a verified sending domain when you want real email.
- **Live payments.** Test mode only, pending the Connect platform application.
- **Google Calendar.** Blank credentials fall back to the in-memory fake
  provider. To make it real, register `https://artweel.fillforge.cloud/api/calendar/callback`
  as the redirect URI in Google Cloud console and fill the two variables.
- **Monitoring and alerting.** Nothing watches this. `restart: unless-stopped`
  brings containers back after a crash or reboot; it does not tell you it
  happened.
