# Actor Model

Use this reference when:

- selecting guards;
- determining actor scope;
- working with super admins;
- working with tenant admins;
- applying role restrictions;
- working with store users;
- deciding whether access is platform, tenant, or store scoped.

---

## Actor Types

The API has three authenticated actor types:

```text
super_admin
admin
store_user
```

Actor type is derived from trusted JWT context:

```ts
user.type;
```

set by `JwtStrategy.validate`.

Never derive actor type from:

- request body
- query parameters
- route parameters
- frontend claims

---

## super_admin

`super_admin` represents platform operators.

Typical capabilities include:

- tenant management
- plan management
- subscription management
- tenant invoice management
- platform billing operations

Guard:

```ts
SuperAdminGuard;
```

Scope:

```text
platform
```

A super admin may legitimately access data across tenants where the feature
requires it.

Keep cross-tenant behavior explicit.

Do not use a tenant-admin endpoint merely because a super admin happens to
have a valid JWT.

---

## admin

`admin` represents staff belonging to a tenant.

Relationship:

```text
Tenant
  ↓
User
```

Tenant identity is part of the admin's trusted authenticated context.

Admin operations are generally:

```text
tenant-scoped
```

and may additionally be:

```text
store-scoped
```

Guard:

```ts
AdminGuard;
```

---

## Admin Store Assignment

Admins may be associated with stores through:

```text
User
 ↓
AdminStore
 ↓
Store
```

Do not assume:

```text
admin belongs to tenant
```

therefore:

```text
admin may access every store
```

The required rule depends on the feature.

Some operations may require only tenant membership.

Others may require an explicit `AdminStore` assignment.

Determine that before implementation.

---

## Roles

Role authorization is separate from ownership scope.

Possible flow:

```text
AdminGuard
    ↓
actor belongs to tenant
    ↓
RolesGuard / @Roles()
    ↓
actor may perform action
    ↓
resource ownership check
```

Do not assume a correct tenant means the actor may perform every operation.

---

## store_user

`store_user` represents a storefront customer belonging to a store.

Relationship:

```text
Store
 ↓
StoreUser
```

Guard:

```ts
StoreUserGuard;
```

Typical scope may include:

```text
storeId
+
storeUserId
```

Store scope alone may not be enough for customer-owned resources.

For example, two customers in the same store must not automatically access
each other's orders.

---

## Optional Store User

Some storefront endpoints support either:

```text
authenticated store_user
```

or:

```text
anonymous session
```

using:

```ts
OptionalStoreUserGuard;
```

Anonymous ownership may use the `sid` cookie.

For those flows read:

```text
STOREFRONT-SESSIONS.md
```

---

## Actor vs Resource Scope

Do not confuse:

```text
Who is the actor?
```

with:

```text
Which resource may the actor access?
```

Example:

```text
user.type = admin
```

proves actor category.

It does not prove ownership of:

```text
productId
orderId
storeId
supplierId
```

Resource ownership must still be established.

---

## Actor Review

Before implementing an endpoint, document mentally:

```text
Actor:
admin

Guard:
AdminGuard

Role:
INVENTORY_MANAGER

Tenant scope:
user.tenantId

Store scope:
requested store must be assigned

Resource:
inventory item must belong to same store
```

Actor/security assumptions should never remain implicit.

---

## Guard Review Checklist

- Is the expected actor type clear?
- Is the correct guard used?
- Is actor type from trusted JWT context?
- Is role authorization needed?
- Is tenant scope required?
- Is store assignment required?
- Is resource-level ownership required?
- Is the operation actually platform-level instead?
