---
name: backend-architecture
description: >
  Architectural rules for NestJS backend development. Use when creating
  or modifying controllers, services, repositories, modules, dependencies,
  business workflows, or application boundaries.
---

# Backend Architecture

## Purpose

Use this skill when designing, implementing, modifying, or reviewing:

- controllers
- services
- repositories
- NestJS modules
- dependency injection
- application workflows
- cross-module dependencies
- architectural boundaries

This project follows:

- Clean Architecture
- SOLID principles
- Repository Pattern
- Dependency Inversion
- separation of concerns

The standard dependency flow is:

```text
Controller
    ↓
Service
    ↓
Repository Interface
    ↓
Repository Implementation
    ↓
Prisma
    ↓
PostgreSQL
```

Business logic must not depend directly on persistence implementations.

---

## Mandatory Rules

### 1. Inspect Before Designing

Before introducing a new implementation:

1. Read the project-level instructions in `CLAUDE.md`.
2. Inspect the affected module.
3. Find a similar implementation where possible.
4. Search for existing:
   - controllers
   - services
   - repository interfaces
   - repository implementations
   - DI tokens
   - DTOs
   - guards
   - helpers

5. Reuse established project patterns where appropriate.

Do not introduce a new architectural pattern merely because another
approach is theoretically cleaner.

Consistency is preferred unless the existing implementation violates a
project invariant or cannot safely support the requirement.

---

## 2. Layer Responsibilities

### Controller

Controllers handle transport/HTTP concerns.

They may:

- define routes
- apply guards and roles
- receive validated DTOs
- read route/query parameters
- extract authenticated/request context
- call services
- return service results

Controllers MUST NOT:

- contain business logic
- access Prisma
- inject `PrismaService`
- coordinate complex workflows
- implement transactions
- duplicate service logic

Preferred flow:

```text
HTTP Request
    ↓
Controller
    ↓
Service
```

---

### Service

Services own application/business behavior.

They may:

- implement business rules
- coordinate repositories
- enforce state transitions
- validate domain conditions
- orchestrate workflows
- coordinate multiple persistence operations
- call other application services
- trigger background work where appropriate

Service methods should represent business operations.

Prefer:

```text
createOrder()
confirmStockOrder()
activateSubscription()
cancelOrder()
assignUserToStore()
```

Avoid persistence-oriented service APIs such as:

```text
insertOrderRow()
updateOrderTable()
queryProducts()
```

---

### Repository

Repositories define the persistence boundary.

They may:

- execute Prisma queries
- retrieve/create/update/delete records
- perform scoped lookups
- implement persistence filtering/pagination
- execute aggregates
- participate in transactions

Repositories should implement persistence behavior, not business decisions.

```text
Service
    → decides WHAT should happen

Repository
    → implements HOW data is persisted/retrieved
```

For detailed repository and Prisma rules, use the
`prisma-repositories` skill.

---

## 3. Prisma Boundary

`PrismaService` MUST NOT be injected into business services.

Prohibited:

```ts
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}
}
```

All persistence access must go through repository abstractions.

If a required persistence operation is missing:

1. inspect existing repositories;
2. extend the appropriate repository interface;
3. implement it in the Prisma repository;
4. consume the abstraction from the service.

Do not bypass the repository layer for convenience.

---

## 4. Dependency Inversion

Business services depend on repository interfaces, not concrete
implementations.

Prohibited:

```ts
constructor(
  private readonly productRepository: ProductRepository,
) {}
```

Expected:

```ts
constructor(
  @Inject(TOKENS.ProductRepo)
  private readonly productRepository: IProductRepository,
) {}
```

Repository tokens belong in:

```text
src/common/constants/tokens.ts
```

Repository interfaces belong under:

```text
src/modules/<module>/interfaces/
```

Prisma-backed implementations belong under:

```text
src/modules/<module>/infra/
```

---

## 5. Clean Architecture Boundaries

Business logic should not depend on:

- Prisma query syntax
- database connection details
- HTTP request objects
- Express-specific APIs
- AWS deployment details
- BullMQ implementation details beyond necessary orchestration

Repositories should not depend on:

- controllers
- route definitions
- request objects
- controller decorators

Keep infrastructure concerns outside the business layer.

---

## 6. DTO Boundary

DTOs belong to the transport boundary and use `class-validator`.

Structural validation belongs in DTOs.

Example:

```text
quantity must be a positive integer
```

Business validation belongs in services.

Example:

```text
requested quantity cannot exceed available inventory
```

Do not use DTO validation as a replacement for business rules.

---

## 7. Reuse Before Creation

Before creating a new:

- repository
- service
- helper
- mapper
- validator
- utility
- abstraction

search the existing codebase.

Ask:

1. Does this already exist?
2. Can it be reused?
3. Can it safely be extended?
4. Would extending it violate its responsibility?

Avoid duplication.

Do not force reuse between concepts that only look superficially similar.

---

## 8. Avoid Premature Abstraction

Do not introduce without a concrete need:

- generic repositories
- generic services
- base classes
- factories
- strategy patterns
- shared abstractions

Prefer implementations that are:

- simple
- explicit
- domain-focused
- easy to understand

Do not create abstractions for hypothetical future requirements.

---

## 9. Cross-Module Dependencies

Before adding a dependency between modules:

1. confirm the domain relationship is valid;
2. check whether the required service is already exported;
3. avoid circular dependencies;
4. avoid importing modules merely to access persistence details;
5. prefer application-level services/interfaces.

Do not automatically solve circular dependencies with `forwardRef()`.

First determine whether the dependency direction is architecturally wrong.

For detailed module-boundary guidance, read
[MODULE-BOUNDARIES.md](MODULE-BOUNDARIES.md).

---

## 10. Cross-Repository Workflows

A service may coordinate multiple repositories for one cohesive use case.

Example:

```text
OrderService.confirmOrder()
      │
      ├── OrderRepository
      ├── InventoryRepository
      └── PaymentRepository
```

This is valid when the operations belong to one business workflow.

Do not move workflow orchestration into repositories merely to keep a
service small.

Use the `prisma-repositories` skill when atomic transactions are required.

---

## 11. Multi-Tenancy Boundary

Tenant/store scope must propagate through the architecture.

```text
Authenticated Actor
       ↓
Controller
       ↓
tenantId / storeId
       ↓
Service
       ↓
Repository
       ↓
Scoped Prisma Query
```

Do not trust client-provided ownership when scope can be derived from
authenticated context.

Use the `multi-tenancy-security` skill for detailed rules.

---

## 12. Background Jobs

Workers do not bypass application architecture.

Prefer:

```text
Processor
    ↓
Application Service
    ↓
Repository Interface
    ↓
Repository
```

Avoid implementing large business workflows directly inside processors.

Use the `background-jobs` skill for queue, scheduler, retry, and
idempotency rules.

---

## 13. Error Boundaries

Each layer should deal with errors appropriate to its responsibility.

Repositories:

- persistence behavior and relevant persistence failures

Services:

- business/domain failures
- invalid state transitions
- application exceptions

Controllers:

- transport concerns

Avoid broad catch-and-rethrow logic that destroys meaningful errors.

---

## 14. SOLID

Apply SOLID pragmatically.

Do not create abstractions merely to demonstrate SOLID.

For design decisions involving:

- SRP
- OCP
- LSP
- ISP
- DIP
- service decomposition
- interface design

read [SOLID.md](SOLID.md).

---

## 15. Examples

When uncertain about:

- where logic belongs
- repository injection
- Prisma placement
- service/repository responsibilities
- business validation vs DTO validation

read [EXAMPLES.md](EXAMPLES.md).

---

## Architecture Review

Before completing an architectural change verify:

### Controller

- thin transport layer
- no Prisma
- no business workflow
- correct guards/context

### Service

- owns business behavior
- no `PrismaService`
- repositories injected through abstractions
- no Prisma query syntax

### Repository

- owns persistence
- implements an interface
- registered through the correct token
- does not contain application workflow logic

### Dependencies

- dependencies flow toward abstractions
- infrastructure does not leak upward
- circular dependencies are avoided

### Design

- existing code was searched first
- unnecessary duplication was avoided
- abstractions have a concrete reason to exist

---

## Architecture Violations

If code relevant to the task violates these rules, do not expand the
violation.

Example:

```text
Service directly uses Prisma
        ↓
Move persistence logic to repository
        ↓
Update repository interface
        ↓
Update DI binding if needed
        ↓
Inject abstraction into service
```

If correcting the entire pre-existing issue would require a large unrelated
refactor:

1. do not expand the violation;
2. implement the requested path correctly;
3. identify the remaining limitation;
4. avoid unrelated large-scale refactoring unless requested.

---

## Final Principle

Prefer architecture that is:

- explicit
- cohesive
- testable
- maintainable
- consistent with the project
- appropriately abstracted

Maintain clear boundaries:

```text
HTTP concerns
      ↓
Application / business logic
      ↓
Persistence abstractions
      ↓
Infrastructure
```
