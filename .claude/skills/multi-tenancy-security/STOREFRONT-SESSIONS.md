# Storefront Sessions

Use this reference when implementing:

- `StoreUserGuard`
- `OptionalStoreUserGuard`
- `store_user` ownership
- anonymous carts
- anonymous checkout
- `sid` session ownership
- anonymous → authenticated cart/order transitions

---

## Store User Scope

A store user belongs to a single store.

```text
Store
 ↓
StoreUser
```

Customer-owned resources may require both:

```text
storeId
+
storeUserId
```

Store scope alone does not imply ownership by a particular customer.

---

## Authenticated Store User

For customer-owned operations determine:

```text
storeId
storeUserId
resourceId
```

Example order lookup may conceptually require:

```text
order.id = orderId
AND
order.storeId = authenticatedStoreId
AND
order.storeUserId = authenticatedStoreUserId
```

depending on domain rules.

---

## Anonymous Sessions

Anonymous storefront flows may use:

```text
sid
```

from a cookie.

Treat `sid` as security-sensitive ownership context.

An anonymous request must not be able to access another anonymous session's:

- cart
- checkout state
- order
- related resources

by changing a resource ID.

---

## OptionalStoreUserGuard

Endpoints using:

```ts
OptionalStoreUserGuard;
```

may operate in two modes:

```text
authenticated user
```

or:

```text
anonymous session
```

The service must determine the correct ownership identity.

Conceptually:

```text
if authenticated:
    storeId + storeUserId
else:
    storeId + sid
```

Follow existing project patterns for the exact request shape.

---

## Never Trust sid from Arbitrary Payloads

Use the project's trusted session mechanism.

Do not allow a client to claim another session simply by submitting:

```json
{
  "sid": "someone-elses-session"
}
```

if session identity is expected to come from the cookie/request context.

---

## Anonymous Resource Ownership

A resource created by an anonymous session should retain enough ownership
information for later validation.

Do not rely solely on:

```text
cartId
orderId
```

to prove access.

---

## Anonymous → Authenticated Transition

When a user signs in after creating anonymous state:

```text
Anonymous session
       ↓
authenticated store user
```

verify:

- anonymous session ownership;
- store ownership;
- authenticated `storeUserId`;
- target resources belong to the same store;
- merge/transfer is permitted by business rules.

Do not merge data simply because IDs exist.

---

## Cart Merge

Before merging anonymous and authenticated carts, determine the intended
business behavior.

Possible concerns:

- same product in both carts
- quantities
- stale/invalid items
- price changes
- different stores
- existing checkout state

Ownership validation must happen before merge behavior.

Business merge rules belong in the relevant service.

---

## Store Boundary

Anonymous and authenticated data must never move across stores accidentally.

Example:

```text
sid belongs to Store A
authenticated user belongs to Store B
```

must not automatically merge.

Always verify store consistency.

---

## Checkout

For checkout operations determine ownership using the correct mode:

```text
authenticated:
storeId + storeUserId

anonymous:
storeId + sid
```

Do not trust only cart/order IDs.

---

## Background Processing

If an anonymous/customer order is processed asynchronously, workers should
use persisted ownership context rather than fabricating an authenticated
request user.

Use `background-jobs` for worker behavior.

---

## Session Security Review

Ask:

- Is this endpoint authenticated, optional-auth, or anonymous?
- What identifies the store?
- What identifies the customer/session?
- Can another session guess this resource ID?
- Can a user access another customer's resource?
- Can a session from Store A affect Store B?
- Is anonymous → authenticated ownership transfer verified?
