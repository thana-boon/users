# ─── SchoolOS Users — Next.js production image (standalone) ───
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Mount the app under a sub-path (e.g. /users-app) behind the SchoolOS gateway.
# Build-time only — basePath is baked into the bundle by next.config.mjs, so
# changing it means rebuilding the image, not restarting the container.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
RUN npm run build

# ─── Migrator: full deps (incl. drizzle-kit) + source, runs schema push ───
# Used by the one-shot `migrate` compose service to create/update tables
# before the app starts. DATABASE_URL is supplied by compose at run time.
FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "drizzle-kit", "push", "--force"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# pg_dump / pg_restore for the backup + restore page (src/lib/backup.ts). Pinned
# to the 16 client to match the postgres:16 server this stack connects to — a
# client older than the server cannot read its dumps, so the major version is
# not a detail to leave to the "latest" meta-package.
#
# tzdata + TZ: without them the container runs on UTC and a backup taken at
# 00:05 in Bangkok is filed as `...-20260731-170500-auto.dump`, seven hours off
# from the day it belongs to. The filenames are what someone reads when they go
# looking through the folder for "last Tuesday", so they have to be local time.
RUN apk add --no-cache postgresql16-client tzdata
ENV TZ=Asia/Bangkok

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Default BACKUP_DIR. Compose bind-mounts a host folder over this; creating it
# here (owned by the app user) keeps backups working without a mount too.
RUN mkdir -p /app/backups && chown nextjs:nodejs /app/backups

USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
