# Security Test Patterns

Use this reference when testing:

- tenant isolation
- store isolation
- role restrictions
- customer ownership
- anonymous session ownership
- relationship assignments
- bulk operations
- IDOR/BOLA defenses

Security-sensitive features should test denial paths, not only success paths.

---

## Tenant Isolation

At minimum test:

```text
Tenant A → Tenant A resource → success
Tenant A → Tenant B resource → denied/not found
```

Apply this to relevant:

- reads
- updates
- deletes
- relationship changes

Example:

```ts
it('does not return a product belonging to another tenant', async () => {
  // arrange Tenant A actor
  // create Product under Tenant B
  // execute request using Tenant A
  // expect not found / forbidden according to project convention
});
```

---

## Store Isolation

Where store-level authorization exists:

```text
Store A actor → Store A resource → success
Store A actor → Store B resource → denied
```

Also consider:

```text
same tenant
different store
```

because store restrictions may exist inside one tenant.

---

## Store User Isolation

Test:

```text
User A → User A order → success
User A → User B order → denied
```

where customer ownership matters.

Store membership alone should not grant access to another customer's data.

---

## Role Authorization

Where `@Roles()` applies, test:

```text
authorized role → success
unauthorized role → denied
```

Do not only verify that `RolesGuard` exists.

Verify that the expected roles are actually enforced.

---

## Relationship Assignment

Example:

```text
Tenant A product
+
Tenant B category
```

should fail.

Test cross-scope references for:

- create
- update
- assignment endpoints

This protects against cross-tenant relationship injection.

---

## Bulk Operations

Create a mixed-scope input:

```text
resource A → Tenant A
resource B → Tenant A
resource C → Tenant B
```

Verify the operation does not silently mutate Tenant B data.

Expected behavior should follow the domain contract:

- reject whole request; or
- explicitly supported partial behavior.

Do not leave this ambiguous.

---

## Existence Leakage

For endpoints that reveal whether a resource exists, verify that an actor
cannot infer another tenant's resources.

Example:

```text
Tenant A checks Product B ID
```

should follow the same protected not-found/forbidden behavior.

---

## Search and Aggregates

Security tests should cover query forms beyond detail endpoints.

Examples:

- search does not return Tenant B items;
- count excludes Tenant B rows;
- revenue summary excludes Tenant B;
- inventory dashboard excludes unauthorized stores.

---

## Anonymous Session Tests

For anonymous `sid` workflows test:

```text
Session A → Session A cart → success
Session A → Session B cart → denied
```

Also test:

```text
Session from Store A → Store B resource → denied
```

where applicable.

---

## Anonymous → Authenticated Tests

Test transitions such as:

```text
Session A cart
    ↓
User A login
    ↓
allowed merge/transfer
```

and negative cases:

```text
Session A
+
User from different store
→ must not merge
```

---

## Guard Tests

Verify endpoint actor separation.

Examples:

```text
admin → admin endpoint → allowed
store_user → admin endpoint → denied

super_admin → platform endpoint → allowed
admin → platform endpoint → denied
```

Use the project's expected response conventions.

---

## IDOR / BOLA Test Pattern

For every ID-based endpoint ask:

> Can the authenticated actor replace the ID with one they do not own?

A useful test matrix:

```text
GET    foreign ID
PATCH  foreign ID
DELETE foreign ID
POST   foreign relation ID
```

Prioritize high-impact resources.

---

## Test What the Attacker Controls

Focus negative tests on values a caller can manipulate:

```text
route IDs
query parameters
body relation IDs
bulk IDs
store IDs
session/resource IDs
```

Do not rely only on unit tests of internal methods if the vulnerability can
occur through the API boundary.

---

## Security Test Checklist

- correct actor succeeds
- incorrect actor type fails
- incorrect role fails
- cross-tenant ID fails
- cross-store ID fails
- cross-user ID fails
- cross-tenant relationship assignment fails
- mixed-scope bulk input is handled safely
- search is scoped
- counts/aggregates are scoped
- anonymous session ownership is scoped
- information leakage is minimized

Use `backend-verification` for the complete final verification workflow.
