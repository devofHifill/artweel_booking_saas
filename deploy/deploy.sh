#!/usr/bin/env bash
#
# Deploy Artweel / BookAIHub to a VPS.
#
# Run it ON the box, from the project directory:
#
#   cd /home/ubuntu/jeff-saas   # live      (bookaihub.com)
#   cd /root/artweel            # staging   (artweel.fillforge.cloud)
#   ./deploy/deploy.sh
#
# The same script serves both boxes. They differ ONLY through the gitignored
# root `.env`, which supplies PUBLIC_HOST, PUBLIC_RULE, PUBLIC_MIDDLEWARES,
# APP_HOST and APP_MIDDLEWARES — the `:?` guards in docker-compose.prod.yml
# refuse a deploy that is missing any of them, by name. Nothing below names a
# hostname, and nothing below should ever start to.
#
# Rehearse on staging first. It exercises this exact mechanism where a mistake
# is noindexed and recoverable; the live box also runs n8n, SEBVM and fdgsms,
# so a careless change there breaks working client projects.
#
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- 0. Refuse to start if this box is not configured ----------------------
#
# `config` resolves the whole file, so the `:?` guards fire here — before the
# backup, before the pull, while nothing has changed yet. Failing at step 5
# instead would leave the tree pulled and the containers still on old images.
say "Checking this box's .env"
[[ -f .env ]] || { echo "FATAL: no root .env on this box. See deploy/env.production.example and the topology notes." >&2; exit 1; }
[[ -f server/.env.production ]] || { echo "FATAL: server/.env.production is missing." >&2; exit 1; }
$COMPOSE config >/dev/null
echo "ok — PUBLIC_HOST=$(grep -E '^PUBLIC_HOST=' .env | cut -d= -f2-)"

# --- 1. Back up the database FIRST -----------------------------------------
#
# Before the pull, so the dump matches the code that is currently serving.
# `migrate deploy` below is the only step that can destroy data, and this is
# the only thing standing behind it.
say "Backing up Postgres"
mkdir -p "$BACKUP_DIR"
$COMPOSE exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
echo "wrote $BACKUP_DIR/db-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/db-$STAMP.sql.gz" | cut -f1))"

# --- 2. Pull ----------------------------------------------------------------
say "Pulling"
git pull --ff-only
echo "now at $(git log --oneline -1)"

# --- 3 & 4. Build, one image at a time --------------------------------------
#
# SEPARATELY, deliberately. These boxes have 2 vCPU; building both at once has
# the Vite build and the tsc build competing for the same two cores, and the
# box swaps rather than finishes.
say "Building api"
$COMPOSE build api

say "Building client"
$COMPOSE build client

# --- 5. Migrate -------------------------------------------------------------
#
# `migrate deploy` replays committed migrations only — it never diffs, never
# resets, and never touches SHADOW_DATABASE_URL. Run against the OLD container,
# which is still up: schema first, then the code that expects it.
say "Applying migrations"
$COMPOSE run --rm api npx prisma migrate deploy

# --- 6. Swap in the new containers -----------------------------------------
#
# `up -d` recreates only what changed. NEVER `down -v` here: -v deletes the
# artweel_pgdata volume, which is the database.
say "Starting"
$COMPOSE up -d

# --- 7. Prove it came back --------------------------------------------------
say "Health"
for _ in $(seq 1 30); do
  if $COMPOSE exec -T api wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "api healthy"
    $COMPOSE ps
    say "Deployed $(git log --oneline -1)"
    exit 0
  fi
  sleep 2
done

echo "FATAL: api did not become healthy within 60s. Last 50 log lines:" >&2
$COMPOSE logs --tail=50 api >&2
exit 1
