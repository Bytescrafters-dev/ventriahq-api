# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

VentriaHQ API: a multi-tenant commerce/inventory backend built on NestJS 11, Prisma 7 (Postgres via `@prisma/adapter-pg`), BullMQ on Redis, and AWS (S3, SES). Package manager is **yarn**. The README is the unmodified Nest starter; ignore it.

## Commands

```bash
yarn docker:up                 # local Postgres (5432) + Redis (6379)
yarn start:dev                 # API on http://localhost:8000 (watch mode)
yarn prisma:generate           # regenerate client after editing prisma/schema.prisma
npx prisma migrate dev -n <name>   # create a migration (the prisma:migrate script hardcodes "init")
yarn seed                      # prisma/seed.ts

npx tsc -p tsconfig.build.json # build (this is what the Dockerfile runs; there is no build script)
npx eslint "src/**/*.ts"       # lint (no lint script in package.json)

yarn test                                        # unit tests (src/**/*.spec.ts)
yarn test src/modules/billing/utils              # single file / directory
yarn test -t "BillingProcessor"                  # by test name
yarn test:e2e:setup                              # start db-test (5433) + redis, apply migrations to it
yarn test:e2e                                    # e2e tests (test/*.e2e-spec.ts), runs serially
```

`SCHEDULER_ONLY=true` boots an application context with no HTTP server — this is how the separate scheduler service runs cron jobs.

## Architecture

### Module layout

Each feature in `src/modules/<name>/` follows the same shape:

- `*.controller.ts` → `*.service.ts` → repository interface in `interfaces/` → Prisma implementation in `infra/`
- `dtos/` hold class-validator DTOs (global `ValidationPipe` uses `whitelist: true, transform: true`, so unknown fields are stripped).
- Repositories are bound by **Symbol tokens** from `src/common/constants/tokens.ts` (`{ provide: TOKENS.XRepo, useClass: XRepository }`) and injected with `@Inject(TOKENS.XRepo)`. New repositories need a token added there.
- Some services (e.g. schedulers, processors) use `PrismaService` directly rather than a repository.

### Imports

Source imports use the literal `src/...` prefix (e.g. `import { PrismaService } from 'src/common/prisma/prisma.service'`). This resolves via tsconfig `baseUrl` at compile time, `moduleNameMapper` in both Jest configs, and `src/register-paths.ts` at runtime in production (`node -r ./dist/register-paths.js dist/main.js`). Keep using this style.

### Auth and actor types

One JWT strategy (`src/modules/auth/jwt.strategy.ts`, bearer token, `JWT_SECRET`) produces `req.user = { sub, type, role, storeId, tenantId }`. The `type` claim distinguishes three actors, each with its own guard in `src/common/guards/`:

- `super_admin` → `SuperAdminGuard` (platform operators; tenants, plans, invoices under `/super-admin/...`)
- `admin` → `AdminGuard` (tenant staff; `User` linked to stores via `AdminStore` with an `AdminRole`)
- `store_user` → `StoreUserGuard` / `OptionalStoreUserGuard` (storefront customers; guest-friendly variant returns `null` instead of throwing)

`validate()` allowlists claims deliberately — don't spread the payload. Modules that use guards import `PlatformJwtModule`.

### Tenancy

`Tenant` → `User` (admins) → `AdminStore` → `Store`; catalog, inventory, orders etc. hang off `storeId`. Scoping to the caller's tenant/store is enforced in services/repositories, not by a global filter. `test/tenant-isolation.e2e-spec.ts` verifies this over HTTP — extend it when adding tenant-owned routes.

### Background jobs

Queue and job names live in `src/common/queues/queues.constants.ts` (`media`, `billing`, `notifications`). Pattern: a `@Cron` scheduler (e.g. `billing/billing.scheduler.ts`) finds due records and enqueues one job per record; a `@Processor` in the module's `workers/` does the work (usually inside `prisma.$transaction`). Custom BullMQ `jobId`s must not contain `:` — use `_` (e.g. `trial-expiry_${id}`).

Billing flow: `PlanPrice` → `TenantSubscription` (TRIAL/ACTIVE/…) → `TenantInvoice`; invoice numbers come from `BillingSequence`, per-store document numbers from `StoreSequence`.

## Architecture Rules

The following rules are mandatory for all implementations.

1. Follow SOLID principles and the existing Clean Architecture boundaries.

2. Business services MUST NOT access PrismaService directly.

3. All database access MUST go through repository abstractions.

4. Services MUST depend on repository interfaces, never concrete
   repository implementations.

5. Repository implementations MUST be injected using the appropriate
   Symbol from TOKENS.

6. Prisma-specific query logic belongs only in repository
   implementations under infra/.

7. Tenant/store scoped entities MUST be queried and mutated using
   the appropriate tenantId/storeId scope.

8. Multi-table operations that must succeed or fail atomically MUST
   use Prisma transactions.

9. Controllers handle HTTP concerns only. Business logic belongs in
   services.

10. Before introducing a new pattern, inspect existing modules and
    follow the established implementation where appropriate.

## Testing

- **Unit tests** (`src/**/*.spec.ts`) mock Prisma with `jest-mock-extended` (`mockDeep<PrismaService>()`) and stub `$transaction`.
- **TZ is pinned to UTC** in `test/global-setup.ts` because billing date math (`billing.utils.ts`) uses local-time Date mutators. Use fixed clocks in date-sensitive tests.
- **E2E tests** boot the real `AppModule` (`test/helpers/test-app.ts`) against the `db-test` container, configured from `.env.test` with `override: true`. `truncateAll()` wipes every table between tests — never point it at a dev database. Use `seedTenant()` / `loginAdmin()` helpers from `test/helpers/`.

## Deployment

Pushing to `dev` triggers `.github/workflows/deploy-dev.yml`: builds the Docker image → ECR, runs Prisma migrations as a one-off ECS task, then redeploys both the `api` and `scheduler` ECS services. Migrations must therefore be committed and deploy-safe before merging to `dev`.
