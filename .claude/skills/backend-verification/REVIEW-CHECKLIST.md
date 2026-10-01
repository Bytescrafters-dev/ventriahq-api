# Backend Review Checklist

Use this reference during code review before running final automated checks.

The purpose is to find structural, security, persistence, and compatibility
problems before spending time on broad test suites.

---

## Requirement

- Does the implementation satisfy the requested behavior?
- Are required inputs supported?
- Are expected outputs correct?
- Are intended errors represented?
- Are relevant edge cases handled?
- Has anything requested been omitted?

---

## Changed Files

Review all relevant changed files.

Check for:

- unintended modifications
- dead code
- stale imports
- duplicated implementation
- unrelated refactoring
- changed shared abstractions

Do not review only the main service.

---

## Architecture

Use `backend-architecture`.

Verify:

### Controller

- remains thin
- contains no Prisma
- contains no transaction logic
- contains no multi-step business workflow
- extracts request/auth context correctly
- delegates to service

### Service

- owns business behavior
- contains no direct Prisma access
- coordinates repositories/services appropriately
- does not build Prisma query DSL
- does not contain HTTP-specific concerns
- does not duplicate business rules

### Repository

- owns persistence
- implements an interface
- is injected through the correct token
- does not contain application workflow decisions

### Dependencies

- dependencies point toward abstractions
- infrastructure does not leak upward
- circular dependencies are avoided
- `forwardRef()` is justified if used

---

## Dependency Injection

Verify:

```text
Service
   ↓
@Inject(TOKENS.XxxRepo)
   ↓
IXxxRepository
```

Check:

- token exists
- repository implementation is registered
- module exports/imports are correct
- concrete repository is not injected into business service

Remember that some DI errors only appear at application startup.

---

## DTO / Validation

Check:

- required decorators
- optionality
- enum validation
- numeric/string validation
- nested validation where applicable
- transform behavior where required

Global validation uses:

```text
whitelist: true
transform: true
```

Distinguish:

```text
structural validation
```

from:

```text
business validation
```

Business validation belongs in services.

---

## API Contract

For endpoint changes verify:

- route path
- HTTP method
- request body
- query/path params
- response structure
- status code
- guard
- roles
- error behavior

Ensure conventions match nearby endpoints.

---

## Security

Use `multi-tenancy-security`.

Check:

### Actor

- correct actor type
- correct guard
- role restriction where required

### Tenant

- trusted `tenantId`
- tenant scope reaches repository
- reads/writes are scoped

### Store

- store belongs to tenant
- actor has required store access
- persistence includes store scope where required

### Customer / Session

- customer-owned data includes appropriate `storeUserId`
- anonymous data includes appropriate `sid`
- one customer/session cannot access another's data

### Relationships

- referenced IDs belong to the authorized tenant/store
- updates validate newly assigned relationship IDs

### IDOR/BOLA

Ask:

> What happens if I replace this ID with one from another tenant/store/user?

---

## Persistence

Use `prisma-repositories`.

Check:

- all Prisma access is inside repositories
- query scope is correct
- relation loading is intentional
- list queries are bounded where required
- pagination order is deterministic
- counts/aggregates happen in DB where appropriate
- raw Prisma errors are not exposed

---

## Transactions

For every multi-step write ask:

> Could partial success leave invalid database state?

If yes:

- transaction boundary covers the whole atomic operation
- same `TransactionClient` reaches all participating repositories
- no participating call silently uses global Prisma
- external I/O is outside the DB transaction

---

## Concurrency

Ask:

- Can two requests produce a lost update?
- Is check-then-create race-safe?
- Is a unique constraint required?
- Is an atomic update required?
- Is sequence generation safe?
- Can duplicate records be created?

Do not assume application-level existence checks guarantee integrity.

---

## Background Jobs

Use `background-jobs`.

Verify:

- async processing is justified
- scheduler mainly discovers/enqueues
- deterministic `jobId` is used where appropriate
- processor is idempotent
- current state is reloaded
- retryable failures propagate
- tenant/store scope is preserved
- duplicate execution is safe
- scheduler-only mode still works

---

## Prisma Schema

If `schema.prisma` changed, verify:

- field types
- nullability
- defaults
- relations
- relation names
- uniqueness
- compound uniqueness
- indexes
- referential actions
- tenant/store ownership model

Do not treat successful generation as proof of logical correctness.

---

## Migration

Review generated SQL when relevant.

Pay particular attention to:

```text
DROP COLUMN
DROP TABLE
type changes
new required fields
unique constraints
foreign-key changes
cascade changes
rename-as-drop/add
```

Ask:

> What happens to existing production rows?

Consider:

- default
- backfill
- staged migration
- nullable-first approach

---

## Error Handling

Check expected application failures such as:

- not found
- duplicate
- invalid state
- insufficient stock
- unauthorized scope
- forbidden role
- invalid relationship
- subscription restrictions

Do not expose raw Prisma/database errors.

Do not replace useful application errors with generic 500s.

---

## Edge Cases

Consider only edge cases relevant to the feature.

Examples:

```text
empty collection
missing optional field
duplicate request
already-completed state
zero/negative quantity
deleted related entity
stale request
concurrent mutation
expired subscription
cross-tenant ID
cross-store ID
```

---

## Regression

Ask:

> What existing behavior could this change break?

Inspect impact on:

- shared repositories
- shared DTOs
- shared services
- module exports
- enums
- authentication logic
- schema
- queue/job constants

Shared abstraction changes require broader verification.

---

## Backward Compatibility

Where applicable consider:

- existing API consumers
- existing DB rows
- existing queued jobs
- enum/state values
- migration compatibility
- seed scripts

Avoid unnecessary breaking changes.

---

## Review Exit Condition

Only proceed to final automated verification once no known structural,
security, or persistence defect remains in the changed path.
