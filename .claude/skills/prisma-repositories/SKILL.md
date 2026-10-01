---
name: prisma-repositories
description: >
  Persistence rules for Prisma repositories. Use when creating or modifying
  repositories, Prisma queries, tenant/store-scoped persistence, transactions,
  database constraints, schema changes, or migrations.
---

# Prisma Repositories

## Purpose

Use this skill whenever implementing, modifying, or reviewing:

- repository interfaces
- repository implementations
- Prisma queries
- database reads/writes
- tenant/store-scoped persistence
- transactions
- concurrency-sensitive writes
- schema changes
- migrations

`backend-architecture` defines where persistence belongs.

This skill defines how persistence should be implemented.

---

## Core Rule

All Prisma access belongs inside repository implementations.

```text
Service
   ↓
Repository Interface
   ↓
DI Token
   ↓
Prisma Repository
   ↓
PrismaService
   ↓
PostgreSQL
```

`PrismaService` MUST NOT be injected into business services.

Expected:

```ts
constructor(
  @Inject(TOKENS.ProductRepo)
  private readonly productRepository: IProductRepository,
) {}
```

Repository:

```ts
@Injectable()
export class ProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}
}
```

---

## 1. Inspect Before Creating

Before creating a repository or method:

1. inspect the affected module;
2. inspect existing repository interfaces;
3. inspect repository implementations;
4. search `TOKENS`;
5. inspect module bindings;
6. inspect `schema.prisma`;
7. search for an existing persistence capability.

Prefer extending a cohesive existing repository over duplicating persistence
logic.

Do not create a new repository merely because a new service method exists.

---

## 2. Repository Structure

Interfaces belong under:

```text
src/modules/<module>/interfaces/
```

Prisma-backed implementations belong under:

```text
src/modules/<module>/infra/
```

Example:

```text
products/
├── products.module.ts
├── products.controller.ts
├── products.service.ts
├── dtos/
├── interfaces/
│   └── product.repository.interface.ts
└── infra/
    └── product.repository.ts
```

---

## 3. Repository Interfaces

Repository interfaces should:

- expose cohesive persistence capabilities;
- make required tenant/store scope explicit;
- avoid unnecessary Prisma-specific types;
- use meaningful operation names;
- expose only operations needed by application logic.

Example:

```ts
export interface IProductRepository {
  findById(id: string, tenantId: string): Promise<Product | null>;

  create(data: CreateProductData): Promise<Product>;

  update(
    id: string,
    tenantId: string,
    data: UpdateProductData,
  ): Promise<Product>;
}
```

---

## 4. Avoid Prisma Leakage

Services should not construct Prisma query objects.

Avoid:

```ts
findMany(
  where: Prisma.ProductWhereInput,
)
```

Prefer application-oriented inputs:

```ts
interface ProductFilters {
  search?: string;
  categoryId?: string;
  active?: boolean;
}

findMany(
  tenantId: string,
  filters: ProductFilters,
)
```

The repository translates application inputs into Prisma queries.

Avoid exposing Prisma-specific input/query types through application-facing
interfaces unless the existing project intentionally follows that pattern.

---

## 5. Dependency Injection

Repositories must use the project `TOKENS` architecture.

Example:

```ts
export const TOKENS = {
  ProductRepo: Symbol('ProductRepo'),
};
```

Service:

```ts
constructor(
  @Inject(TOKENS.ProductRepo)
  private readonly productRepository: IProductRepository,
) {}
```

Follow the project's established `useClass` or `useExisting` module binding.

Do not inject concrete repository implementations into business services.

---

## 6. Tenant and Store Scope

Tenant/store isolation must be enforced at the persistence boundary.

Prefer:

```ts
findById(id, tenantId);
```

over:

```ts
findById(id);
```

when ownership matters.

Scope applies to:

- reads
- updates
- deletes
- existence checks
- counts
- aggregates
- relation lookups
- nested resources
- bulk operations

Do not assume a valid entity ID implies authorization.

Use `multi-tenancy-security` for full ownership rules.

---

## 7. Scope Every Mutation

Do not only scope list queries.

Unsafe:

```ts
await this.prisma.product.delete({
  where: {
    id,
  },
});
```

for tenant-owned data.

Repository operations must ensure the target belongs to the intended
tenant/store.

Use compound unique constraints when available.

Example:

```ts
where: {
  id_tenantId: {
    id,
    tenantId,
  },
}
```

Otherwise use an appropriately scoped persistence strategy.

---

## 8. Trusted Ownership

Do not derive tenant/store ownership from request-body data when trusted
authenticated context is available.

Avoid:

```ts
await this.productRepository.create({
  tenantId: dto.tenantId,
  name: dto.name,
});
```

Prefer trusted scope supplied by the application layer:

```ts
await this.productRepository.create({
  tenantId: currentUser.tenantId,
  name: dto.name,
});
```

---

## 9. Transactions

Use a transaction when multiple persistence operations form one atomic
business operation.

Ask:

> If one operation succeeds and a later operation fails, would the database
> be left inconsistent?

If yes, use a shared transaction.

For detailed transaction design, `TransactionClient` propagation,
external side effects, and concurrency-sensitive workflows, read
[TRANSACTIONS.md](TRANSACTIONS.md).

---

## 10. Concurrency

Do not rely solely on application-level checks for database invariants.

Use database mechanisms where appropriate:

- unique constraints
- compound unique constraints
- atomic updates
- transactions
- upserts

Application-level checks may improve error messages but do not replace
database integrity constraints.

For concurrency-sensitive writes, read
[TRANSACTIONS.md](TRANSACTIONS.md).

---

## 11. Query Design

Queries should be intentional.

Avoid:

- unnecessary relation loading
- N+1 queries
- unbounded lists
- unstable pagination
- unnecessary in-memory aggregation
- arbitrary client-controlled Prisma sorting

For pagination, filtering, sorting, aggregates, relation loading, bulk
operations, and N+1 prevention, read
[QUERY-PATTERNS.md](QUERY-PATTERNS.md).

---

## 12. Repository Method Design

Prefer methods that communicate intent and scope.

Good:

```ts
findById(id, tenantId);

findBySku(sku, tenantId);

findActiveByStore(storeId);

countOrdersByStatus(storeId, status);

updateStatus(orderId, tenantId, status);
```

Be cautious with generic methods such as:

```ts
find(where);

update(where, data);

query(options);
```

Generic APIs can leak persistence concerns into services.

---

## 13. Repository Boundary

Repositories contain:

```text
persistence mechanics
```

Services contain:

```text
business decisions
workflow orchestration
state-transition rules
```

Example:

Repository:

```ts
getAvailableStock(productId, storeId);
```

Service:

```text
Determine whether requested quantity is allowed.
```

Do not move business logic into repositories merely to reduce service size.

---

## 14. Database Errors

Do not expose raw Prisma errors to API consumers.

Translate known persistence failures only when the application can
meaningfully interpret them.

Examples:

- unique constraint violation
- record not found
- foreign-key violation

Do not catch all Prisma errors and convert them into one generic exception.

---

## 15. Schema Changes

When modifying:

- `schema.prisma`
- relations
- constraints
- indexes
- nullability
- defaults
- migrations

read [SCHEMA-MIGRATIONS.md](SCHEMA-MIGRATIONS.md) before implementation.

Do not treat successful Prisma generation as proof that a migration is safe.

---

## 16. Examples

When uncertain about:

- repository interface design
- tenant-scoped queries
- transaction propagation
- query patterns
- schema/migration design

read [EXAMPLES.md](EXAMPLES.md).

---

## Repository Review

### Architecture

- all Prisma access is inside repositories
- services are free from Prisma
- repository implements an interface
- repository is injected through the correct token
- persistence behavior belongs to the correct repository

### Scope

- tenant/store scope is enforced
- reads are scoped
- updates are scoped
- deletes are scoped
- relation lookups are scoped

### Transactions

- atomic workflows use one transaction
- all participating repository calls use the same `TransactionClient`
- no call accidentally uses global Prisma inside the transaction
- external I/O is outside database transactions

### Concurrency

- simultaneous requests cannot violate invariants
- database constraints are used where required
- read-modify-write flows are safe
- sequence generation is concurrency-safe

### Query Design

- no unnecessary relations
- no obvious N+1 pattern
- large collections are paginated
- ordering is deterministic
- database aggregates are used where appropriate

### Schema

- nullability/defaults are intentional
- uniqueness scope is correct
- relations are correct
- foreign-key behavior is intentional
- indexes are justified
- migrations are non-destructive or intentionally handled

---

## Critical Questions

For multi-step writes:

> What happens if the process fails after each database operation?

For scoped queries:

> Could Tenant A provide an ID belonging to Tenant B and cause this query
> to return or mutate Tenant B's data?

For store-scoped queries:

> Could Store A access or mutate Store B's data?

---

## Verification

After persistence changes:

1. review repository methods;
2. verify tenant/store scope;
3. verify transaction boundaries;
4. verify `TransactionClient` propagation;
5. review schema/migration changes;
6. run `yarn prisma:generate` if schema changed;
7. run relevant tests;
8. use `backend-verification` for final checks.

---

## Final Principle

Prioritize:

```text
Correctness
    ↓
Data isolation
    ↓
Data integrity
    ↓
Atomicity
    ↓
Maintainability
    ↓
Performance
```

The repository layer is the application's database boundary.

```

```
