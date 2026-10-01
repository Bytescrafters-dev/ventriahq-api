# Query Patterns

Use this reference when implementing:

- lists
- search
- filtering
- sorting
- pagination
- relation loading
- aggregates
- existence checks
- bulk operations
- potentially expensive queries

---

## Query Only What Is Needed

Use the narrowest query that satisfies the use case.

Prefer selecting only required fields.

Example:

```ts
return this.prisma.product.findMany({
  where: {
    tenantId,
  },
  select: {
    id: true,
    name: true,
    sku: true,
    price: true,
  },
});
```

Avoid loading large relation graphs without a concrete requirement.

---

## Relation Loading

Avoid broad:

```ts
include: {
  category: true,
  variants: true,
  images: true,
  inventory: true,
  orders: true,
}
```

unless the use case genuinely needs all those relations.

Large relation graphs can create:

- unnecessary database work
- large application objects
- excessive responses
- accidental data exposure

Load relations intentionally.

---

## N+1 Queries

Watch for patterns such as:

```ts
const products =
  await this.productRepository.findProducts(...);

for (const product of products) {
  product.stock =
    await this.inventoryRepository.getStock(
      product.id,
    );
}
```

This may execute one query per product.

Where appropriate use:

- relation loading
- batching
- grouped queries
- aggregation

Do not optimize blindly. First confirm the actual access pattern.

---

## Pagination

Collections that can grow significantly should use the project's existing
pagination convention.

Avoid unbounded lists.

Keep:

- filtering
- ordering
- pagination
- total/count behavior

consistent.

Do not introduce a new pagination response shape if the project already
uses one.

---

## Deterministic Ordering

Paginated queries must use explicit ordering.

Avoid relying on implicit database order.

Where the primary sort value can contain duplicates, use a stable secondary
field where appropriate.

Example:

```ts
orderBy: [
  {
    createdAt: 'desc',
  },
  {
    id: 'desc',
  },
];
```

---

## Filtering

The repository should translate application-level filters into Prisma
conditions.

Service:

```ts
{
  search,
  categoryId,
  active,
}
```

Repository:

```ts
const where: Prisma.ProductWhereInput = {
  tenantId,
};

if (filters.search) {
  where.OR = [
    {
      name: {
        contains: filters.search,
        mode: 'insensitive',
      },
    },
    {
      sku: {
        contains: filters.search,
        mode: 'insensitive',
      },
    },
  ];
}
```

The service should not build Prisma query syntax.

---

## Mandatory Security Scope

Optional filters must never replace mandatory tenant/store scope.

Unsafe:

```ts
const where = filters;
```

if `filters` comes from request input.

Mandatory scope should always be introduced from trusted application
context.

Example:

```ts
const where: Prisma.ProductWhereInput = {
  tenantId,
};
```

then apply optional filters.

---

## Sorting

Do not pass arbitrary client-provided fields directly into Prisma.

Validate or map allowed values.

Example:

```ts
const sortMap = {
  name: 'name',
  createdAt: 'createdAt',
  price: 'price',
} as const;
```

Reject or safely fall back for unsupported sort values according to project
conventions.

---

## Existence Checks

Do not load full records when only existence is required.

Example:

```ts
const record = await this.prisma.product.findFirst({
  where: {
    id,
    tenantId,
  },
  select: {
    id: true,
  },
});

return Boolean(record);
```

Existence checks must still respect tenant/store scope.

---

## Counts and Aggregates

Perform aggregates in the database where practical.

Prefer:

```ts
this.prisma.order.count(...)
```

or:

```ts
this.prisma.order.aggregate(...)
```

over loading all records and calculating totals in application memory.

Expose application-meaningful aggregate methods from repositories.

Example:

```ts
countOrdersByStatus(storeId, status);
```

rather than exposing raw Prisma aggregate syntax.

---

## Bulk Operations

For large operations consider:

- `createMany`
- `updateMany`
- `deleteMany`
- batching
- transactions

only where semantics allow.

Do not remove required per-record validation simply for performance.

Bulk operations must preserve tenant/store ownership.

---

## Deletion Queries

Before using Prisma `delete()` determine whether the domain requires:

```text
hard delete
soft delete
archive
deactivate
status transition
```

Repository behavior must match the domain's established deletion semantics.

---

## Index Awareness

When query patterns repeatedly filter or order by fields such as:

```text
tenantId
storeId
status
createdAt
```

consider whether schema indexes are justified.

Do not add indexes automatically.

Use `SCHEMA-MIGRATIONS.md` when changing indexes.

---

## Query Review Checklist

- Is tenant/store scope mandatory and preserved?
- Are only needed fields/relations loaded?
- Is there an N+1 pattern?
- Can the list grow without pagination?
- Is ordering deterministic?
- Are client sort fields validated?
- Are aggregates calculated in the DB?
- Are existence queries minimal?
- Can a bulk operation cross tenant boundaries?
- Would a schema index materially support this access pattern?
