# syntax=docker/dockerfile:1

###############################################################################
# Dependencies
###############################################################################
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci

###############################################################################
# Build the Next.js app
###############################################################################
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build only needs a syntactically valid URL; it never connects.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

###############################################################################
# Runtime — serves the dashboard and the API
###############################################################################
FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apk add --no-cache libc6-compat curl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: 'standalone'` bundles only the modules the server actually needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]

###############################################################################
# Runtime — background worker (crawler, scheduler, notifications)
###############################################################################
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache libc6-compat \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The worker runs TypeScript directly via tsx, so it needs the full tree.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json tsconfig.json drizzle.config.ts ./
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs drizzle ./drizzle

USER nextjs
CMD ["npx", "tsx", "src/jobs/worker.ts"]
