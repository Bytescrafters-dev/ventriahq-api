---
name: multi-tenancy-security
description: >
  Authorization and data-isolation rules for super admins, tenant admins,
  store users, stores, tenants, and anonymous storefront sessions. Use when
  implementing or reviewing guards, roles, tenant/store scope, ownership,
  resource relationships, or scoped repository operations.
---

# Multi-Tenancy Security

## Purpose

Use this skill whenever implementing, modifying, or reviewing:

- authentication
- authorization
- guards
- roles
- tenant-scoped data
- store-scoped data
- resource ownership
- repository scope
- relationship assignments
- store-user access
- anonymous storefront ownership
- bulk scoped operations

The core rule is:

```text
Authenticated Actor
      ↓
Correct Guard / Role
      ↓
Trusted Tenant / Store Scope
      ↓
Service Business Rule
      ↓
Scoped Repository Operation
      ↓
Scoped Prisma Query
```

Controller-level authorization alone is not sufficient.

---

## 1. Determine Security Context First

Before implementing an endpoint or service method, determine:

1. Which actor may call it?
2. What guard applies?
3. Is role-level authorization required?
4. What tenant scope applies?
5. What store scope applies?
6. Who owns the target resource?
7. Are referenced/nested resources in the same authorized scope?

Do not design persistence before answering these questions.

For detailed actor behavior, read
[ACTOR-MODEL.md](ACTOR-MODEL.md).

---

## 2. Authentication Is Not Authorization

A valid JWT proves identity.

It does not prove access to every resource.

Example:

```text
Admin from Tenant A
        +
Product ID from Tenant B
```

must not succeed merely because the actor is authenticated.

Always enforce resource ownership.

---

## 3. Use the Correct Guard

Use the guard matching the expected actor.

Examples:

```ts
@UseGuards(SuperAdminGuard)
```

```ts
@UseGuards(AdminGuard)
```

```ts
@UseGuards(StoreUserGuard)
```

```ts
@UseGuards(OptionalStoreUserGuard)
```

Do not rely on:

- route naming
- controller location
- frontend behavior
- JWT existence alone

---

## 4. Scope Must Propagate

Tenant/store scope must propagate through all layers.

```text
Authenticated Actor
       ↓
tenantId / storeId
       ↓
Controller
       ↓
Service
       ↓
Repository
       ↓
Scoped Prisma Query
```

Prefer:

```ts
findById(id, tenantId);
```

over:

```ts
findById(id);
```

when ownership matters.

Likewise, use explicit store scope where store ownership matters.

---

## 5. Never Trust Client Ownership

Do not use client-supplied values to establish authorization when trusted
context already provides them.

Examples:

```text
tenantId
storeId
userId
actor type
```

Avoid:

```ts
await this.service.create({
  tenantId: dto.tenantId,
  ...dto,
});
```

Prefer trusted scope:

```ts
await this.service.create(currentUser.tenantId, dto);
```

Client identifiers may select resources.

They must not establish ownership or permission.

---

## 6. IDs Do Not Establish Authorization

URL/body IDs are untrusted selectors.

For example:

```text
DELETE /products/:productId
```

does not imply the authenticated actor may delete any valid product.

The final repository operation must enforce the correct scope.

Conceptually:

```text
product.id = productId
AND
product.tenantId = authenticatedTenantId
```

Treat every external resource ID as potentially hostile.

UUIDs are not authorization.

---

## 7. Scope Every Operation

Ownership rules apply to:

- lists
- detail reads
- search
- creates
- updates
- deletes
- existence checks
- counts
- aggregates
- relation lookups
- bulk operations
- exports

A cross-tenant read is still a security breach.

Do not secure writes while leaving reads unscoped.

---

## 8. Repository APIs Should Be Safe by Default

Prefer:

```ts
findById(id, tenantId);
```

or:

```ts
findByIdForStore(id, storeId);
```

over:

```ts
findById(id);
updateById(id);
deleteById(id);
```

for scoped resources.

If platform-level access is genuinely needed, make that intent explicit.

Example:

```ts
findByIdForPlatform(id);
```

Do not make the unsafe operation the easiest operation to call.

Use `prisma-repositories` for persistence implementation details.

---

## 9. Validate Relationships

When a request references multiple IDs, verify that all resources belong
to the same authorized scope.

Examples:

```text
product → category
user → store
order → customer
stock order → supplier
inventory → product
invoice → subscription
```

Never assume independently valid IDs may safely be connected.

For detailed ownership patterns, read
[OWNERSHIP-PATTERNS.md](OWNERSHIP-PATTERNS.md).

---

## 10. Roles and Scope Are Separate

Scope answers:

> Which data may this actor access?

Roles answer:

> What may this actor do with that data?

Both may be required.

Example:

```text
Admin belongs to Tenant A
        ↓
resource belongs to Tenant A
        ↓
role still does not permit deletion
```

Use `RolesGuard` and `@Roles()` where required.

Tenant membership does not replace role authorization.

---

## 11. Backend Enforcement Is Mandatory

Frontend visibility is not security.

Hiding a button does not prevent direct API calls.

Likewise:

```ts
@UseGuards(AdminGuard)
```

only proves the actor is an admin.

It does not prove the requested resource belongs to that admin's tenant.

Resource ownership must still be enforced through service/repository scope.

---

## 12. Platform-Level Operations

Some workflows legitimately operate across tenants:

- super-admin operations
- billing schedulers
- subscription expiry
- platform reporting

Keep those operations explicit.

Do not weaken tenant-scoped repository methods merely to support platform
workflows.

---

## 13. Store User / Anonymous Access

When functionality involves:

- `store_user`
- `OptionalStoreUserGuard`
- `sid`
- anonymous carts
- anonymous checkout
- anonymous → authenticated transitions

read
[STOREFRONT-SESSIONS.md](STOREFRONT-SESSIONS.md).

---

## 14. Bulk Operations

Bulk operations require the same scope rules as individual operations.

If a request contains:

```json
{
  "productIds": ["product-a", "product-b", "product-c"]
}
```

validate the complete set.

Do not assume all supplied IDs belong to the authenticated actor's scope.

Avoid partially applying mixed-authority operations unless partial behavior
is explicitly defined by the domain.

---

## 15. Search, Counts, and Aggregates

Mandatory security scope must remain present even when optional filters are
applied.

Do not allow filters to replace:

```text
tenantId
storeId
storeUserId
```

where those are required.

Also scope:

- counts
- totals
- revenue
- inventory summaries
- dashboards
- reports

Aggregate leakage is still data leakage.

---

## 16. Information Leakage

Authorization failures should not unnecessarily reveal information outside
the actor's scope.

Avoid exposing:

- whether another tenant's resource exists
- another tenant's name
- another store's identity
- another customer's identity
- protected resource state
- internal ownership details

Follow existing exception conventions.

---

## 17. Background Jobs

Background jobs may run without an interactive actor.

They still require explicit tenant/store/resource scope.

Do not assume:

```text
job came from trusted queue
```

therefore:

```text
all referenced resources are safe
```

Reload and validate relationships when required.

Use `background-jobs` for retry/idempotency rules.

---

## 18. Transactions and Security

If an ownership/state check must remain valid throughout a mutation, consider
whether validation and mutation belong in the same transaction.

Example:

```text
verify inventory belongs to store
       ↓
modify inventory
```

If concurrency could invalidate that assumption, use appropriate transaction
semantics.

Use `prisma-repositories` for transaction mechanics.

---

## 19. Security Tests

Security-sensitive changes should include negative authorization coverage.

For detailed test patterns, read
[SECURITY-TESTS.md](SECURITY-TESTS.md).

---

## Security Review

### Actor

- expected actor is explicit
- actor type comes from trusted JWT context
- correct guard is used

### Roles

- role restriction is present where required
- intended roles are configured

### Tenant

- tenant scope comes from trusted context
- tenant scope reaches repository queries

### Store

- requested store belongs to tenant
- actor has required store access
- store scope reaches persistence

### Resource Ownership

- target belongs to actor's scope
- nested resources are scoped
- relationship IDs are validated

### Customer / Session

- `storeUserId` is enforced where needed
- `sid` ownership is enforced where needed
- one customer/session cannot access another's data

### Bulk Operations

- every supplied ID is authorized
- mixed-scope inputs cannot cause unauthorized partial mutation

### Information Leakage

- errors do not expose another tenant/store/customer

---

## Critical Questions

For tenant scope ask:

> Can Tenant A provide an ID belonging to Tenant B and retrieve, modify,
> delete, link, count, or infer Tenant B's data?

For store scope ask:

> Can an actor authorized for Store A access or modify Store B's data?

For customer scope ask:

> Can Store User A access Store User B's resource by changing an ID?

If yes, the implementation is unsafe.

---

## Security Violation Handling

If relevant existing code contains an unsafe pattern:

```text
Unscoped Repository Query
        ↓
Determine correct scope
        ↓
Update repository interface
        ↓
Update repository implementation
        ↓
Propagate scope through service
        ↓
Update caller
        ↓
Add negative authorization coverage
```

Do not preserve or expand a security issue merely to minimize the change.

If a complete legacy fix requires a large unrelated refactor:

1. do not expand the unsafe pattern;
2. secure the code path being modified;
3. identify the remaining pre-existing risk;
4. avoid unrelated broad refactoring unless requested.

---

## Final Principle

Every scoped operation must answer:

```text
WHO is performing the operation?
        ↓
WHAT are they allowed to do?
        ↓
WHICH DATA may they do it to?
```

Authentication answers WHO.

Roles/permissions answer WHAT.

Tenant/store/resource ownership answers WHICH DATA.

Never depend on the client to preserve tenant isolation.
