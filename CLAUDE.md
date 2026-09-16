# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There are no `lint` or `build` scripts in `package.json` — invoke those tools directly. Test scripts do exist (`test`, `test:watch`, `test:cov`, `test:e2e`).

```bash
# install
yarn install

# run (dev, with watch)
yarn start:dev

# run scheduler-only process (see main.ts SCHEDULER_ONLY branch)
SCHEDULER_ONLY=true yarn start

# build
npx nest build

# lint
npx eslint .

# unit tests (config in jest.config.ts at the repo root)
yarn test
yarn test:watch
yarn test:cov
npx jest path/to/file.spec.ts   # single file
npx jest -t "test name"         # single test by name

# e2e / integration tests (config in test/jest-e2e.json)
# These run against a REAL Postgres (the `db-test` compose service on :5433)
# plus Redis, booting the actual AppModule. Env comes from .env.test.
# One-time / after a schema change — starts containers and migrates:
yarn test:e2e:setup
yarn test:e2e

# prisma
yarn prisma:generate
yarn prisma:migrate          # runs `prisma migrate dev -n init`
npx prisma migrate dev -n <name>   # create a new named migration
yarn seed                    # prisma/seed.ts
npx ts-node --transpile-only prisma/seed-tenant.ts
npx ts-node --transpile-only prisma/seed-super-admin.ts

# local infra (Postgres/Redis via docker-compose)
yarn docker:up
```

Test coverage is uneven — check before assuming. Covered with unit tests (mocked repositories, see `src/**/*.spec.ts`): orders, products, inventory, auth, billing utils + processor, guards, JwtStrategy. Not covered: stock-orders, cart, users, tenants, categories, leads, and every repository/controller.

Integration tests live in `test/*.e2e-spec.ts` and run against a real Postgres — they are the only place route guards and tenant scoping are actually verified. `test/helpers/` holds the app factory, table truncation, and tenant seeding.

The e2e suite truncates every table between tests, so it must never point at a dev database; `test/setup-e2e.ts` loads `.env.test` with `override: true` to make that hard to get wrong.

## Architecture

NestJS + Prisma (Postgres) API with BullMQ/Redis for background jobs. Deployed to AWS ECS via GitHub Actions (`.github/workflows/deploy-dev.yml`) on push to `dev`; CDK infra lives under `infra/` (separate yarn workspace, not part of the API's own install).

### Multi-tenancy and actor types

Three distinct JWT-authenticated actor types coexist in the same API, distinguished by `user.type` on the request (set in `JwtStrategy.validate`, `src/modules/auth/jwt.strategy.ts`):

- **`super_admin`** — platform operators. Manage `Tenant`s, `PlanPrice`s, `TenantSubscription`s/`TenantInvoice`s (billing). Guarded by `SuperAdminGuard`.
- **`admin`** — a tenant's own staff (`User` model, scoped by `tenantId`, has `AdminRole`). Manage stores, products, inventory, orders, suppliers, leads. Guarded by `AdminGuard`, with `RolesGuard`/`@Roles()` for role-level restriction within a tenant.
- **`store_user`** — storefront customers, scoped to a single `Store`. Guarded by `StoreUserGuard`, or `OptionalStoreUserGuard` for endpoints that work for both logged-in customers and anonymous cart/checkout sessions (session id via `sid` cookie, see `OrdersController`).

Tenancy chain: `Tenant` → `User` (admin staff) → `Store` (via `AdminStore`) → `Product`/`Order`/`StockOrder`/etc. `StoreUser` belongs directly to a `Store`. Every repository query that lists/mutates tenant- or store-scoped data must filter by the relevant `tenantId`/`storeId` — there is no global row-level security, it's enforced entirely in application code.

### Module layout

Each feature lives under `src/modules/<name>/` following a consistent layered pattern:

```
<name>.module.ts          # wires controller + service + DI tokens
<name>.controller.ts      # HTTP layer, route guards, DTO validation
<name>.service.ts         # business logic, orchestrates repositories/transactions
dtos/                      # class-validator request DTOs
interfaces/                # repository interfaces (I*Repository) — service depends on these, not concrete classes
infra/                      # Prisma-backed repository implementations
workers/                    # BullMQ processors (where the module owns a queue)
```

Repositories are bound to their interface via a Symbol token in `src/common/constants/tokens.ts` (the `TOKENS` map) and injected with `@Inject(TOKENS.XxxRepo)`. When adding a new repository, register both the interface and the token — don't inject Prisma repository classes directly into services.

Multi-step writes that touch multiple tables (e.g. order creation + inventory movement, stock order confirmation) go through `prisma.$transaction`/`Prisma.TransactionClient` passed down into repository methods, rather than sequential independent calls — see `OrderRepository.create`/`generateOrderNumber` for the pattern (per-store sequential order numbers via `StoreSequence` upsert inside the same transaction).

### Background jobs

BullMQ queues are declared in `src/common/queues/queues.constants.ts` (`QUEUES`, `JOBS`) and registered globally in `AppModule` via `BullModule.forRootAsync`. Two patterns exist:

- **Scheduled enqueue**: `@nestjs/schedule` `@Cron(...)` methods (e.g. `BillingScheduler`) query Prisma for due work and enqueue one job per record, using a deterministic `jobId` (e.g. `` `trial-expiry_${subscriptionId}` ``) so re-running the cron doesn't duplicate jobs.
- **Processors**: `workers/*.processor.ts` files consume a queue (e.g. `billing.processor.ts`, `email.processor.ts`, uploads' `image-metadata` worker).

The same container image runs both the HTTP API and a scheduler-only process, switched via the `SCHEDULER_ONLY` env var in `main.ts` (`NestFactory.createApplicationContext` instead of a listening server) — this maps to the separate `ventriahq-dev-scheduler` ECS service in the deploy workflow.

### Auth

Two independent JWT flows share `JwtStrategy`/`PlatformJwtModule`: admin/super-admin auth (`src/modules/auth`) and store-user auth, each with their own refresh-token tables (`RefreshToken`, `StoreUserRefreshToken`, `SuperAdminRefreshToken`) and controllers. Guards distinguish actors purely by the `type` claim in the JWT payload, not by which endpoint was hit — always add the correct guard rather than relying on route naming.

### Conventions

- Path aliasing uses the literal `src/...` prefix (e.g. `import { PrismaService } from 'src/common/prisma/prisma.service'`), not `@/`.
- DTOs use `class-validator`; the global `ValidationPipe` (`main.ts`) has `whitelist: true, transform: true`.
- Prettier: single quotes, trailing commas everywhere (`.prettierrc`).
