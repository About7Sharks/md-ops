# syntax=docker/dockerfile:1.7
FROM node:24.11.1-alpine AS ui-build
WORKDIR /src/packages/ui

# This nested lockfile is authoritative; regenerate it independently with
# `npm install --workspaces=false --prefix packages/ui`, never from the root workspace.
COPY packages/ui/package.json packages/ui/package-lock.json ./
RUN npm ci --ignore-scripts
COPY packages/ui/index.html packages/ui/tsconfig.json packages/ui/tsconfig.node.json packages/ui/vite.config.ts ./
COPY packages/ui/src ./src
RUN npm run build

FROM oven/bun:1.3.13-alpine AS runtime
WORKDIR /app

COPY --chown=1000:1000 packages/api/package.json packages/api/bun.lock ./
# Refresh base OS packages at build time so fixed Alpine security updates are
# not delayed until the Bun image publishes a new application-runtime tag.
RUN apk upgrade --no-cache \
    && bun install --frozen-lockfile --production
COPY --chown=1000:1000 packages/api/src ./src
COPY --from=ui-build --chown=1000:1000 /src/packages/ui/dist ./ui

ENV HOST=0.0.0.0 \
    PORT=3098 \
    MD_OPS_ALLOW_MUTATIONS=false \
    HOME=/tmp

USER 1000:1000
EXPOSE 3098
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["bun", "-e", "const u='http://127.0.0.1:'+process.env.PORT+'/readyz';const r=await fetch(u);if(!r.ok)process.exit(1)"]
CMD ["bun", "run", "src/index.ts"]
