# Transactions and Concurrency

Use this reference when:

- multiple database operations must succeed or fail together;
- more than one repository participates in a write workflow;
- `Prisma.TransactionClient` is involved;
- updating counters or inventory;
- generating sequential numbers;
- implementing concurrency-sensitive state changes.

---

## When a Transaction Is Required

Ask:

> If operation A succeeds and operation B fails, would the database be left
> in an invalid or misleading state?

If yes, the operations should normally share one transaction.

Examples:

```text
Order
+
OrderItems
+
Inventory movement
```

```text
StockOrder confirmation
+
Stock updates
```

```text
Subscription state
+
Invoice update
```

```text
Sequence increment
+
Entity creation
```

Do not implement one atomic business operation as unrelated sequential
database calls.

---

## Transaction Boundary

The transaction must cover the complete atomic persistence operation.

```text
Business Operation
      ↓
prisma.$transaction
      ↓
Repository A
Repository B
Repository C
      ↓
commit / rollback
```

Do not create separate transactions for operations that must succeed or fail
together.

---

## TransactionClient Propagation

Repository methods participating in a transaction should support
`Prisma.TransactionClient` according to project conventions.

Example:

```ts
async create(
  data: CreateProductData,
  tx?: Prisma.TransactionClient,
): Promise<Product> {
  const client = tx ?? this.prisma;

  return client.product.create({
    data,
  });
}
```

This allows the repository to work both normally and inside an existing
transaction.

---

## Never Escape the Transaction

When inside:

```ts
this.prisma.$transaction(async (tx) => {
  ...
});
```

every persistence operation belonging to that atomic workflow must use the
same `tx`.

Unsafe:

```ts
await this.prisma.$transaction(async (tx) => {
  await this.orderRepository.create(order, tx);

  await this.inventoryRepository.updateStock(data);
});
```

If `updateStock()` uses global `PrismaService`, it is outside the
transaction.

Correct:

```ts
await this.prisma.$transaction(async (tx) => {
  await this.orderRepository.create(order, tx);

  await this.inventoryRepository.updateStock(data, tx);
});
```

Always trace transaction propagation through every participating repository.

---

## Keep External I/O Outside Transactions

Avoid inside a database transaction:

- email
- third-party APIs
- BullMQ operations
- file uploads
- long-running computation
- unnecessary network calls

Unsafe:

```ts
await this.prisma.$transaction(async (tx) => {
  await this.orderRepository.create(data, tx);

  await this.emailService.sendConfirmation(...);
});
```

A database rollback cannot undo the email.

Prefer:

```text
Database transaction
      ↓
commit
      ↓
external side effect / background job
```

For reliability-sensitive DB → queue workflows, evaluate the actual failure
model before introducing patterns such as an outbox.

Do not introduce an outbox without a concrete reliability requirement.

---

## Keep Transactions Short

Avoid:

- network calls
- CPU-heavy work
- sleeps
- retry loops
- unrelated queries
- large unnecessary loops

Long transactions increase lock duration and contention.

---

## Concurrency

Do not assume an application-level check prevents concurrent writes.

Unsafe:

```text
check if exists
      ↓
not found
      ↓
create
```

Two requests may both pass the check.

For invariants that must hold under concurrency, consider:

- unique constraints
- compound unique constraints
- atomic database updates
- transactions
- upserts

---

## Atomic Updates

Be careful with read-modify-write operations.

Potentially unsafe:

```ts
const stock = await this.inventoryRepository.getStock(productId);

await this.inventoryRepository.updateStock(
  productId,
  stock.quantity - requestedQuantity,
);
```

Two simultaneous requests may both read the same value and overwrite each
other.

Prefer an atomic database operation when the invariant requires it.

---

## Sequential Numbers

Do not generate sequences using:

```text
find latest
    ↓
+ 1
    ↓
insert
```

without concurrency protection.

Follow the existing `StoreSequence` pattern.

Sequence generation and dependent record creation should share the same
transaction when consistency requires it.

---

## Unique Constraints

Database uniqueness should represent the real business scope.

Examples:

```text
email globally unique
```

is different from:

```text
email unique within tenant
```

Possible scoped invariants:

- tenant-specific SKU
- tenant-specific email
- invoice number
- external reference
- sequence identity

Use database constraints for invariants that must survive concurrent
requests.

---

## Authorization Checks During Transactions

If an ownership or state check must remain true through the mutation,
consider performing the check and write in the same transaction.

Example:

```text
verify inventory belongs to store
       ↓
modify inventory
```

If another operation could invalidate the assumption between those steps,
the workflow requires stronger transactional design.

---

## Transaction Review Checklist

- Does the entire atomic operation share one transaction?
- Does every participating repository receive the same `tx`?
- Does any repository silently fall back to global Prisma?
- Is external I/O outside the transaction?
- Is the transaction kept short?
- Could concurrent execution break an invariant?
- Is an atomic update more appropriate?
- Is a database constraint required?
- Is sequence generation safe?

---

## Failure Question

For every write sequence ask:

> What happens if the process fails after this exact operation?

Repeat that question after every database mutation.

If any intermediate state is invalid, adjust the transaction boundary.
