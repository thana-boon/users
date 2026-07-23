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
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
