# ADR-0001: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted (Milestone 1)
- **Date:** 2026-10-30

## Context

The platform has a NestJS API, a Next.js web app, a Flutter app and shared TypeScript
code. API and web must agree on contracts (roles, response shapes) and share strict
lint/type configuration.

## Decision

- Single Git repository with `apps/*` and `packages/*`.
- **pnpm workspaces** (strict, non-hoisted `node_modules` prevents phantom dependencies).
- **Turborepo** orchestrates `build`, `lint`, `typecheck`, `test` with dependency-aware
  caching.
- `@kenisha/shared` is compiled with **tsup** to dual CJS (NestJS) + ESM (Next.js).
- `@kenisha/ui` is consumed **as source** via Next.js `transpilePackages`.
- Flutter lives in `apps/mobile` but is **not** a pnpm package; it uses its own toolchain
  and a separate CI job.
- Versions: Node 24 LTS, TypeScript 5.9, NestJS 11, Next.js 15, React 19, Tailwind CSS 4,
  PostgreSQL 18, Redis 7.4.

## Consequences

- One PR can change API + web + contract atomically.
- Contributors need pnpm via corepack (`corepack enable`).
- Mobile cannot import TypeScript contracts; it will use a client generated from OpenAPI.
