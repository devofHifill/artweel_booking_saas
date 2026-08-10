# syntax=docker/dockerfile:1
#
# Dashboard SPA: built with Node, served by nginx, fronted by Traefik.
#
# The bundle needs no build-time configuration. It calls the API with relative
# paths (src/lib/api.ts — fetch('/api/...')), and Traefik routes /api and
# /public on this hostname to the api service. That keeps it same-origin in
# production exactly as the Vite dev proxy makes it same-origin locally, so
# there is no CORS behaviour that only exists in one of the two.

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/index.html >/dev/null 2>&1 || exit 1
