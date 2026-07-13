FROM oven/bun:1.3.4 AS dependencies
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.4 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=dependencies /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/db ./packages/db
RUN bun --filter @grade-management/web build

FROM oven/bun:1.3.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /app/apps/web/public ./apps/web/public

EXPOSE 3000
USER bun
CMD ["bun", "apps/web/server.js"]
