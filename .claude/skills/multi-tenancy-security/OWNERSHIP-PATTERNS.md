# Ownership Patterns

Use this reference when:

- implementing scoped repository methods;
- validating nested resources;
- linking entities;
- handling create/update/delete operations;
- implementing bulk operations;
- reviewing IDOR/BOLA risk.

---

## Core Rule

Every resource lookup or mutation must use the scope appropriate to the
actor and domain.

A valid ID is not authorization.

---

## Tenant-Owned Resource

Unsafe:

```ts
findById(productId);
```

when `Product` belongs to a tenant.

Prefer:

```ts
findById(productId, tenantId);
```

Conceptually:

```text
product.id = productId
AND
product.tenantId = authenticatedTenantId
```

Apply the same principle to:

- reads
- updates
- deletes
- existence checks
- counts
- aggregates

---

## Store-Owned Resource

When the resource belongs to a store, use store scope.

Example:

```ts
findOrder(orderId, storeId);
```

Do not assume tenant ownership alone is enough if store-level restrictions
exist.

---

## Customer-Owned Resource

Some resources require:

```text
resource.id
AND
resource.storeId
AND
resource.storeUserId
```

Example:

```text
Store A
 ├── User 1
 └── User 2
```

User 1 must not access User 2's order merely because both belong to Store A.

---

## Nested Resource Validation

Suppose a request contains:

```text
storeId = Store A
productId = Product B
```

Validating the store and product independently is insufficient.

Verify the relationship:

```text
product belongs to Store A
```

or the equivalent domain rule.

---

## Relationship Assignment

Whenever connecting resources:

```text
product → category
user → store
order → customer
stock order → supplier
inventory → product
product → store
invoice → subscription
```

verify that every referenced resource belongs to the same authorized scope.

Do not allow:

```text
Tenant A Product
      ↓
Tenant B Category
```

simply because both IDs are valid.

---

## Create Operations

Creating a child resource requires validation of referenced parents.

Example:

```text
Create Product
     ↓
categoryId supplied
     ↓
category belongs to tenant?
     ↓
create product
```

Never create cross-tenant relationships.

---

## Update Operations

When update DTOs contain relationship IDs:

```json
{
  "categoryId": "...",
  "storeId": "..."
}
```

validate:

1. the entity being updated;
2. the new category;
3. the new store;
4. all relevant tenant/store relationships.

Do not only validate the target entity.

---

## Delete Operations

Before deleting:

1. verify actor scope;
2. verify role if required;
3. verify target ownership;
4. verify relevant relationship constraints;
5. execute a scoped delete/update.

Do not rely only on:

```text
resource exists
```

---

## Existence Checks

Even:

```ts
exists(resourceId);
```

can leak cross-tenant information.

Prefer scoped existence checks where ownership matters.

Example:

```ts
exists(resourceId, tenantId);
```

---

## Search

Mandatory scope must always remain present.

Unsafe:

```ts
where: {
  name: {
    contains: search,
  },
}
```

Scoped:

```ts
where: {
  tenantId,
  name: {
    contains: search,
  },
}
```

Optional filters must never replace mandatory security scope.

---

## Counts and Aggregates

Scope applies to:

- counts
- totals
- revenue
- inventory values
- order summaries
- dashboards
- reports

Do not treat aggregate data as non-sensitive.

---

## Bulk Operations

Request:

```json
{
  "ids": ["a", "b", "c"]
}
```

must validate the complete set.

Possible unsafe scenario:

```text
a → Tenant A
b → Tenant A
c → Tenant B
```

Do not partially mutate unauthorized mixed-scope input unless partial
behavior is explicitly part of the domain contract.

---

## Platform Methods

Sometimes system/platform workflows need unscoped access.

Do not weaken normal APIs such as:

```ts
findById(id, tenantId);
```

to support them.

Prefer explicit intent:

```ts
findByIdForPlatform(id);
```

where appropriate.

---

## IDOR / BOLA Review

For every user-controlled ID ask:

> What happens if I replace this ID with one belonging to another tenant,
> store, or customer?

Check:

- GET
- PATCH/PUT
- DELETE
- relation assignment
- bulk mutation
- existence checks
- exports
- aggregates

The result must remain inside the actor's allowed scope.

---

## Information Leakage

Avoid telling users:

```text
"This product exists but belongs to another tenant."
```

when they are not authorized to know that.

Prefer existing not-found/forbidden conventions that do not leak protected
ownership information.

---

## Ownership Review Checklist

- Is tenant/store scope explicit?
- Is scope derived from trusted context?
- Are individual reads scoped?
- Are mutations scoped?
- Are existence checks scoped?
- Are nested relationships validated?
- Are new relationship IDs validated?
- Are counts/aggregates scoped?
- Are bulk IDs fully validated?
- Can one customer access another customer's data?
