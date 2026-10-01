# Module Boundaries

Use this reference when:

- one NestJS module needs functionality from another;
- introducing a new module;
- exporting/importing services;
- resolving circular dependencies;
- deciding where cross-domain orchestration belongs.

---

## Standard Module Responsibility

A feature module should own its domain-specific:

```text
controller
service
DTOs
repository interfaces
repository implementations
workers
```

Example:

```text
src/modules/orders/
├── orders.module.ts
├── orders.controller.ts
├── orders.service.ts
├── dtos/
├── interfaces/
├── infra/
└── workers/
```

Do not move unrelated functionality into a module merely because that module
already has convenient dependencies.

---

## Cross-Module Dependencies

Before importing another feature module, ask:

1. Is there a genuine domain relationship?
2. What capability is actually required?
3. Is that capability already exposed through a service?
4. Is the dependency direction sensible?
5. Could this create a circular dependency?

Prefer:

```text
OrdersModule
    ↓
InventoryService exported by InventoryModule
```

over directly accessing another module's repository implementation.

Application modules should communicate through intentional application-level
APIs rather than reaching into each other's persistence internals.

---

## Repository Ownership

A module should normally own persistence for its domain.

Avoid:

```text
OrdersService
    ↓
concrete InventoryRepository
```

when the inventory module already owns an application service representing
the required operation.

Use repository dependencies directly only where that repository logically
belongs to the current application's use case and follows existing project
patterns.

Do not create arbitrary cross-module repository coupling.

---

## Circular Dependencies

Do not automatically use:

```ts
forwardRef(...)
```

when Nest reports a circular dependency.

First inspect the dependency direction.

Example:

```text
OrdersService
    ↓
InventoryService
    ↓
OrdersService
```

may indicate that responsibilities are incorrectly split.

Possible solutions may include:

- moving the shared workflow into the correct service;
- extracting a cohesive shared application capability;
- changing which service owns the orchestration;
- introducing a focused abstraction where genuinely needed.

Use `forwardRef()` only when the circular relationship is truly required and
consistent with established architecture.

---

## Cross-Domain Workflows

One application service may orchestrate several domain capabilities when it
owns the business use case.

Example:

```text
OrderService.confirmOrder()
     │
     ├── OrderRepository
     ├── InventoryService / Repository
     └── PaymentService / Repository
```

Choose the orchestrating service based on the business operation.

Do not move orchestration into a repository.

Do not create a generic "manager" merely because multiple modules are
involved.

---

## Shared Utilities

Place functionality into shared/common code only when it is genuinely
domain-independent.

Good shared candidates:

- generic parsing
- infrastructure helpers
- shared decorators
- common constants

Poor shared candidates:

- product business rules
- order state transitions
- subscription lifecycle logic

Domain behavior should stay near the domain that owns it.

---

## Module Exports

Export only dependencies that other modules genuinely need.

Avoid exporting every service/repository by default.

A module's public surface should remain intentional.

Before exporting something ask:

> Is another module supposed to depend on this capability as part of the
> application's architecture?

---

## New Module Decision

Create a new module when there is a cohesive domain capability with its own
meaningful behavior and dependencies.

Do not create a new module merely because:

- a file is getting long;
- one new endpoint is being added;
- a new database table exists.

A database model does not automatically require a separate NestJS module.

---

## Review Checklist

When changing module boundaries verify:

- the dependency represents a real domain relationship;
- application services are preferred over infrastructure leakage;
- repositories are not exposed casually across modules;
- exports are intentional;
- circular dependencies are avoided;
- `forwardRef()` is justified if used;
- orchestration belongs to the service owning the business workflow;
- shared code is genuinely shared rather than misplaced domain logic.
