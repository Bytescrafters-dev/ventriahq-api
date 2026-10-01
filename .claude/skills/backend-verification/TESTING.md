# Backend Testing Guidelines

Use this reference when deciding:

- what tests to run;
- what tests to add;
- whether unit/e2e/integration coverage is appropriate;
- how to test security, transactions, and background jobs.

---

## Start Focused

Run the most relevant test first.

Example:

```bash
npx jest src/modules/products/products.service.spec.ts
```

or:

```bash
npx jest -t "creates a product"
```

Focused tests provide faster feedback.

After they pass, broaden according to risk.

---

## Unit Tests

Unit tests should protect business behavior rather than merely mirror method
implementation.

Useful cases include:

```text
valid operation succeeds
invalid state fails
missing resource fails
correct repository scope is supplied
side effect occurs when expected
side effect does not occur after validation failure
```

Avoid tests that assert trivial internal calls without protecting a
meaningful contract.

---

## Security Tests

For scoped functionality test both positive and negative paths.

Tenant example:

```text
Tenant A → Tenant A resource → success
Tenant A → Tenant B resource → denied/not found
```

Store example:

```text
Store A → Store A resource → success
Store A → Store B resource → denied
```

Customer example:

```text
User A → User A order → success
User A → User B order → denied
```

Prioritize ID-based:

- reads
- updates
- deletes
- relationship assignments

Use the detailed test patterns from
`multi-tenancy-security/SECURITY-TESTS.md` when needed.

---

## Role Tests

Where `@Roles()` applies, verify:

```text
authorized role → succeeds
unauthorized role → denied
```

Do not assume the existence of `RolesGuard` proves the role configuration
is correct.

---

## Transaction Tests

Where transaction behavior is significant verify:

- all required repository operations receive the transaction client;
- an error prevents dependent later work;
- invalid partial persistence is not treated as success;
- transaction-sensitive behavior is actually protected.

Do not mock away the invariant being tested.

For transaction mechanics use:

```text
prisma-repositories/TRANSACTIONS.md
```

---

## Background Job Tests

When relevant test:

- queue name
- job name
- job payload
- deterministic `jobId`
- processor → service invocation
- state revalidation
- duplicate execution behavior
- obsolete job handling
- retryable error propagation

Use `background-jobs` for detailed job rules.

---

## E2E Tests

Use e2e when behavior depends on integration between several layers.

Especially useful for:

- authentication
- guards
- roles
- DTO validation
- route wiring
- tenant/store isolation
- database behavior
- response contracts

Command:

```bash
npx jest --config test/jest-e2e.json
```

Do not require a new e2e test for every trivial internal refactor.

---

## Highest Useful Layer

Prefer verification through the highest layer that meaningfully protects the
feature.

Example:

```text
repository unit test
```

can prove query behavior.

But:

```text
e2e request
```

may prove together:

```text
guard
DTO
controller
service
repository
response
```

Choose based on the failure risk.

---

## Test Failure Handling

When a test fails:

1. read the actual failure;
2. identify root cause;
3. decide whether implementation or test is wrong;
4. fix the correct layer;
5. rerun the focused failing test;
6. rerun broader affected tests where necessary.

Do not immediately weaken the test.

---

## Never Modify Tests Just to Get Green

Do not solely for passing:

- remove assertions
- skip tests
- disable suites
- broaden mocks
- change expected behavior

Modify tests only when the intended contract genuinely changed.

---

## Regression Testing

Broaden testing when changing:

- shared repository methods
- shared services
- auth logic
- enums
- schema
- queue/job constants
- reusable validation
- module exports

The broader the shared dependency, the broader the regression surface.

---

## Full Unit Suite

Run when justified:

```bash
npx jest
```

Examples:

- shared abstraction changed
- cross-module behavior changed
- high-risk feature
- focused tests suggest broader regression risk

Do not run it blindly as the first diagnostic step.

---

## Testing Decision Guide

### Small isolated change

Usually:

```text
focused test
lint
build
```

### Medium feature

Usually:

```text
focused unit tests
relevant integration/e2e
lint
build
```

### High-risk workflow

Usually:

```text
unit tests
negative security tests
transaction/failure tests
e2e/integration
full relevant regression suite
lint
build
runtime verification
```

---

## Testing Exit Condition

Before reporting completion:

- relevant focused tests pass;
- required negative/security tests pass;
- required integration/e2e behavior passes;
- no test was disabled merely to obtain success;
- any unexecuted test area is explicitly reported.
