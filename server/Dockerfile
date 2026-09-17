# syntax=docker/dockerfile:1
#
# Production image for the scheduling core.
#
# Build context is ./server — everything the API needs lives there.
#
# NOTE ON node_modules: the runtime stage keeps the FULL dependency tree,
# devDependencies included. That is deliberate, not an oversight:
#   - `prisma migrate deploy` needs the prisma CLI, a devDependency, and
#     migrations run from this same image so they use the same schema that
#     was built into it;
#   - `npm run db:seed` needs tsx for the same reason.
# Pruning to --omit=dev would save ~150MB and cost the ability to migrate the
# database from the thing that is actually deployed.

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Prisma's query engine links against OpenSSL; without it `prisma generate`
# picks the wrong binary target and the client fails at runtime, not build time.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci

# Generate before copying src so a source-only change does not invalidate it.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# The TypeScript sources ship too, purely so seeding works on the server:
# prisma/seed.ts imports ../src/scheduling/session.service and ../src/lib/password
# directly, and runs through tsx rather than the compiled output. A few hundred
# kilobytes buys `npm run db:seed` against the real deployment.
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./

# Operator scripts, for the same reason and one that matters more.
#
# `npm run platform:grant` is the ONLY way to create a platform admin — there is
# deliberately no HTTP route for it, because an endpoint that mints platform
# admins would have to be guarded by the authority it hands out. Without this
# line the deployed image has a platform surface that nobody can ever reach, and
# the only remedy is a hand-written INSERT against production Postgres.
#
# Copied from the build CONTEXT rather than the build stage: the compile does not
# need these, and going through the build stage would invalidate its cache every
# time a script changed.
COPY scripts ./scripts

# TEMPORARY — static demo prototypes served at /demo (see the comment in
# src/app.ts). Plain HTML/CSS/JS, so the compile never touches them; copied
# from the build CONTEXT for the same reason as scripts above. Delete this
# line when the demos come off this host.
COPY demos ./demos

# Configuration arrives as real environment variables from compose's env_file.
# config/index.ts also looks for /app/.env and shrugs when it is absent —
# dotenv does not overwrite variables that are already set, so there is no
# conflict between the two mechanisms.

USER node

EXPOSE 4000

# /api/health asserts Postgres reachability plus the postgis and btree_gist
# extensions, so an unhealthy container here means something real.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.js"]
