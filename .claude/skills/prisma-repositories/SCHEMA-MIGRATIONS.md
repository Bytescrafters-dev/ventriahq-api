# Schema and Migration Guidelines

Use this reference whenever modifying:

- `schema.prisma`
- models
- fields
- relations
- indexes
- unique constraints
- nullability
- defaults
- foreign keys
- migration files

---

## Before Changing the Schema

Review:

1. affected domain behavior;
2. existing model conventions;
3. existing relations;
4. field types;
5. nullability;
6. defaults;
7. uniqueness requirements;
8. indexes;
9. foreign-key behavior;
10. existing production data.

Do not make a field required without considering existing rows.

---

## Nullability

Treat nullability as a domain decision.

Ask:

> Is this value genuinely optional in the business domain?

Do not make a field nullable merely to make implementation easier.

Do not make an existing optional field required without a safe migration
strategy.

---

## Defaults

Use defaults only when the default is semantically valid.

Do not use defaults merely to avoid migration/backfill work.

For existing production rows, determine how newly introduced values should
be populated.

---

## Unique Constraints

Determine the real business scope.

Example:

```text
email globally unique
```

is different from:

```text
email unique within tenant
```

Likewise:

```text
SKU globally unique
```

may be incorrect when the real invariant is:

```text
tenantId + sku
```

Use compound uniqueness where the business invariant is scoped.

---

## Indexes

Consider indexes for repeated query patterns involving:

- `tenantId`
- `storeId`
- status
- timestamps
- relation keys
- frequent filters
- frequent sorting

Examples:

```text
tenantId + status
tenantId + createdAt
storeId + status
storeId + createdAt
```

Do not add indexes speculatively.

Indexes improve reads but increase storage and write cost.

---

## Relations

Choose relation behavior intentionally.

Review:

```text
Cascade
Restrict
SetNull
NoAction
```

Do not introduce cascading delete behavior without understanding the
business consequence.

Historical records such as:

- orders
- invoices
- billing records

require particular care.

---

## Monetary Values

Follow the project's existing representation.

Where Prisma `Decimal` is used:

- preserve decimal semantics;
- avoid unsafe JavaScript floating-point transformations;
- do not introduce a second monetary representation without reason.

---

## Dates and Time

Follow existing project conventions.

Understand whether a field represents:

- absolute timestamp
- calendar date
- local business time
- expiry boundary

Avoid introducing ad-hoc timezone transformations inside repositories.

---

## Generating Prisma Types

After schema changes run:

```bash
yarn prisma:generate
```

Do not continue with stale generated types.

---

## Creating Migrations

Use a meaningful migration name:

```bash
npx prisma migrate dev -n <name>
```

Do not reuse the generic `init` migration name for unrelated changes.

Do not modify historical migrations already applied to shared environments.

Create a new migration.

---

## Review Generated SQL

Never assume generated SQL is automatically safe.

Inspect migrations involving:

- dropped columns
- dropped tables
- type changes
- nullability changes
- unique constraints
- foreign keys
- cascade behavior
- renames
- large existing tables

A compiling Prisma schema does not imply a safe production migration.

---

## Renames

Be especially careful when renaming fields or models.

Migration tooling may interpret:

```text
rename old_column → new_column
```

as:

```sql
DROP COLUMN old_column;
ADD COLUMN new_column ...;
```

which can destroy data.

Inspect generated SQL and preserve existing data intentionally.

---

## Required Field Added to Existing Table

If a new required field is added to a populated table, consider strategies
such as:

```text
nullable field
    ↓
backfill data
    ↓
make required
```

or another safe migration approach appropriate to the requirement.

Do not assume development database success proves production safety.

---

## Foreign-Key Changes

Before changing foreign keys ask:

- what existing rows are affected?
- can orphaned data exist?
- what should happen when parent rows are deleted?
- will the new constraint fail on current data?

---

## Deletion Strategy

Schema relations should support the domain's intended deletion behavior.

Determine whether entities should be:

```text
hard deleted
soft deleted
archived
deactivated
kept permanently as history
```

before changing cascading behavior.

---

## Migration Review Checklist

- Is the schema change required by the domain?
- Is nullability correct?
- Are defaults meaningful?
- Is uniqueness scoped correctly?
- Are indexes based on real access patterns?
- Are relations correct?
- Is cascade behavior intentional?
- Could existing rows violate the new schema?
- Could generated SQL destroy data?
- Is a staged migration/backfill needed?
- Was `yarn prisma:generate` run?
- Was the generated migration inspected?
