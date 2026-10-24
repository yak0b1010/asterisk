# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies first so the layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.29-alpine AS runtime

# API_UPSTREAM is substituted into the nginx template at container start.
# In the backend Compose stack the API service is reachable as api:8080.
ENV API_UPSTREAM=api:8080

RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

STOPSIGNAL SIGQUIT
