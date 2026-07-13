FROM oven/bun:1.3.4 AS dependencies
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.4 AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=dependencies /app/packages/db/node_modules ./packages/db/node_modules
COPY package.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
RUN bun --filter @grade-management/api build

FROM oven/bun:1.3.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3001

COPY --from=build /app/apps/api/dist ./dist

EXPOSE 3001
USER bun
CMD ["bun", "dist/index.js"]
