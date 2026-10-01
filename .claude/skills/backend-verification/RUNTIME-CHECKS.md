# Runtime and Tooling Verification

Use this reference when changes involve:

- NestJS module wiring
- dependency injection
- controllers/routes
- configuration
- Prisma schema
- database migrations
- Redis/BullMQ
- schedulers
- startup behavior
- local infrastructure

---

## Lint

Run:

```bash
npx eslint .
```

Fix underlying issues.

Do not suppress lint failures with:

```ts
// eslint-disable
```

without a justified reason.

---

## Build

Run:

```bash
npx nest build
```

Build failures may reveal:

- TypeScript errors
- bad imports
- missing exports
- interface mismatches
- stale generated Prisma types
- some dependency/wiring problems

Fix build failures before reporting completion.

---

## Runtime Startup

When practical run:

```bash
yarn start:dev
```

Particularly important after changes involving:

- module imports
- providers
- DI tokens
- controllers
- routes
- config
- queue initialization

A successful build does not guarantee NestJS DI succeeds at runtime.

---

## Dependency Injection Review

Check:

- module imports
- providers
- exports
- tokens
- repository bindings
- circular dependencies
- `forwardRef()` usage

Do not use `forwardRef()` simply to silence a DI problem.

Understand the dependency direction first.

---

## Scheduler Runtime

For scheduler changes consider:

```bash
SCHEDULER_ONLY=true yarn start
```

Verify:

- application context initializes
- scheduler dependencies resolve
- scheduler providers start
- no HTTP-only dependency is accidentally required

---

## Local Infrastructure

Start local infrastructure where required:

```bash
yarn docker:up
```

This may be needed for:

- PostgreSQL
- Redis
- BullMQ
- integration tests
- runtime checks

Do not claim database/queue runtime verification if the required services
were unavailable.

---

## Prisma Generation

After `schema.prisma` changes run:

```bash
yarn prisma:generate
```

If generation fails:

```text
investigate
   ↓
fix schema/code
   ↓
generate again
```

Do not continue with stale generated types.

---

## Migration

Create a meaningful named migration where required:

```bash
npx prisma migrate dev -n <name>
```

Review generated SQL.

Use:

```text
prisma-repositories/SCHEMA-MIGRATIONS.md
```

for migration safety rules.

---

## Existing Data

Do not verify schema changes only against an empty database.

Ask:

> What happens to existing rows?

For a new required field consider whether the migration needs:

- default
- backfill
- staged migration
- nullable-first approach

---

## Seeds

If schema changes affect seed logic, inspect:

```text
prisma/seed.ts
prisma/seed-tenant.ts
prisma/seed-super-admin.ts
```

Relevant commands:

```bash
yarn seed
```

```bash
npx ts-node --transpile-only prisma/seed-tenant.ts
```

```bash
npx ts-node --transpile-only prisma/seed-super-admin.ts
```

Run seed commands only when safe and relevant.

Do not overwrite important development data merely for verification.

---

## Formatting and Project Conventions

Verify:

```text
single quotes
trailing commas
src/... imports
```

Do not introduce:

```text
@/...
```

if the repository convention is `src/...`.

Match naming and module conventions already present in nearby code.

---

## Environment Blockers

Possible blockers include:

- PostgreSQL unavailable
- Redis unavailable
- env variable missing
- migration DB unavailable
- external API unavailable

Report blockers explicitly.

Example:

```text
Not verified:
- scheduler startup because Redis was unavailable
```

Do not convert environmental inability into a success claim.

---

## Runtime Verification Checklist

- lint passed
- build passed
- application startup checked where appropriate
- DI resolves where relevant
- scheduler-only startup checked when changed
- Prisma client regenerated when required
- migration reviewed when required
- local dependencies were available for claimed runtime checks
- blockers are explicitly documented
