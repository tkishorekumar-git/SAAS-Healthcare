# syntax=docker/dockerfile:1.7
#
# Kenisha production images (ADR-0006). Build from the repository root, one target each:
#   docker build -f deploy/docker/Dockerfile --target api      -t kenisha-api .
#   docker build -f deploy/docker/Dockerfile --target web      -t kenisha-web .
#   docker build -f deploy/docker/Dockerfile --target migrate  -t kenisha-migrate .
#   docker build -f deploy/docker/Dockerfile --target postgres -t kenisha-postgres .
#
# Runtime images run as a non-root user, hold no secrets and no build tools. Secrets are
# supplied by the server at run time (deploy/compose.yml). Base images are pinned by tag
# here and by digest in the release record (deploy/scripts/deploy.sh).

ARG NODE_IMAGE=node:24-alpine
ARG POSTGRES_IMAGE=postgres:18

# --- Build everything once -------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    # The web app calls the API on its own origin (/api, routed by Caddy).
    NEXT_PUBLIC_API_URL="" \
    NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kenisha/api... --filter=@kenisha/web...
# Production-only dependencies of the API, with its workspace packages copied in.
RUN pnpm --filter @kenisha/api deploy --prod /out/api

# --- API --------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

# --- Web --------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /repo/apps/web/.next/standalone ./
COPY --from=build --chown=root:root /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# --- One-off migration job (kenisha_migrator) ---------------------------------------------
# Larger image (it needs the Prisma CLI); runs only during a deployment, never stays up.
FROM build AS migrate
WORKDIR /repo/packages/database
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# --- PostgreSQL with pgBackRest ------------------------------------------------------------
FROM ${POSTGRES_IMAGE} AS postgres
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
COPY deploy/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
