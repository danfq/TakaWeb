# syntax=docker/dockerfile:1

# build with bun, it owns the lockfile
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# production dependencies only, the server bundle imports them at runtime
# optional ones are native build tools such as sharp and lightningcss, the server never loads them
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit optional

# run on node, takaweb uses node:sqlite and astro's node adapter
FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    TAKAWEB_DATA_DIR=/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs

# the maintenance cli, e.g. docker compose exec takaweb takaweb reset-password
RUN printf '#!/bin/sh\nexec node /app/dist/takaweb.mjs "$@"\n' > /usr/local/bin/takaweb \
    && chmod +x /usr/local/bin/takaweb \
    && mkdir -p /data \
    && chown node:node /data

USER node
VOLUME /data
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "/app/scripts/healthcheck.mjs"]

CMD ["node", "dist/server/entry.mjs"]
