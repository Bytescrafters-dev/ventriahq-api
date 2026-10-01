---
name: backend-verification
description: >
  Final verification workflow for NestJS backend changes. Use after
  implementing or modifying backend functionality to verify requirements,
  architecture, security, persistence, tests, lint, build, and relevant
  runtime behavior before reporting completion.
---

# Backend Verification

## Purpose

Use this skill after implementing or modifying backend functionality.

Verification determines whether the implementation is:

- correct
- secure
- architecturally compliant
- testable
- buildable
- safe to integrate

Verification is part of implementation.

Do not consider a task complete immediately after writing code.

---

## 1. Never Claim Unexecuted Verification

Never claim:

```text
tests pass
lint passes
build passes
migration works
runtime works
feature works
```

unless that verification was actually executed successfully.

If a check could not be run, say so explicitly.

Do not convert:

```text
"this should compile"
```

into:

```text
"build passed"
```

Report evidence, not assumptions.

---

## 2. Use the Project's Actual Commands

Do not assume package scripts such as:

```bash
yarn test
yarn lint
yarn build
```

exist.

Use:

### Focused test

```bash
npx jest path/to/file.spec.ts
```

### Test by name

```bash
npx jest -t "test name"
```

### Full unit suite

```bash
npx jest
```

### E2E

```bash
npx jest --config test/jest-e2e.json
```

### Lint

```bash
npx eslint .
```

### Build

```bash
npx nest build
```

### Prisma generation

```bash
yarn prisma:generate
```

Run the smallest relevant check first, then broaden verification according
to risk.

---

## 3. Verification Workflow

For non-trivial backend work:

```text
Requirement review
       ↓
Review changed files
       ↓
Architecture/security/persistence review
       ↓
Focused tests
       ↓
Broader tests where justified
       ↓
Lint
       ↓
Build
       ↓
Runtime/Prisma checks where applicable
       ↓
Completion report
```

Do not blindly run all commands before reviewing the implementation.

Fix structural problems first.

---

## 4. Verify the Requirement First

Before reviewing code quality, confirm the requested behavior actually exists.

Ask:

- What behavior was requested?
- What inputs are expected?
- What outputs are expected?
- Which actor performs the operation?
- What state should change?
- What failures are expected?
- What edge cases matter?
- Was any requested behavior omitted?

Clean code that does not meet the requirement does not pass verification.

---

## 5. Review the Actual Change

Review all files relevant to the implementation.

Potentially affected areas include:

- controller
- service
- repository interface
- repository implementation
- module
- `TOKENS`
- DTOs
- guards
- Prisma schema
- migrations
- workers
- schedulers
- tests
- configuration

Also look for accidental unrelated modifications.

For the detailed review checklist, read
[REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md).

---

## 6. Delegate Detailed Architecture Rules

Use the relevant skill instead of duplicating all its rules here.

### Architecture

Use:

```text
backend-architecture
```

Verify high-level boundaries:

```text
Controller
    ↓
Service
    ↓
Repository Interface
    ↓
Repository Implementation
    ↓
Prisma
```

### Persistence

Use:

```text
prisma-repositories
```

when repositories, transactions, concurrency, schema, or migrations changed.

### Security

Use:

```text
multi-tenancy-security
```

when actors, guards, roles, tenant/store scope, or ownership are involved.

### Background jobs

Use:

```text
background-jobs
```

when queues, schedulers, processors, retries, or idempotency changed.

Do not duplicate those full reviews inside this skill.

---

## 7. Test According to Risk

Run focused tests first.

Then determine whether broader unit, integration, or e2e coverage is needed.

Use e2e tests particularly when behavior depends on multiple layers such as:

- authentication
- guards
- roles
- DTO validation
- routing
- tenant isolation
- database behavior
- request/response contracts

For test selection and security/transaction/job test patterns, read
[TESTING.md](TESTING.md).

---

## 8. Verification Depth

### Small change

Examples:

```text
validation decorator
small helper change
small repository filter
```

Typical checks:

```text
review
focused test where relevant
lint
build
```

---

### Medium feature

Examples:

```text
new CRUD endpoint
new repository method
new business rule
```

Typical checks:

```text
architecture/security review
focused tests
relevant e2e/integration coverage
lint
build
runtime startup where useful
```

---

### High-risk feature

Examples:

```text
billing
inventory mutation
order lifecycle
authentication
tenant access
background jobs
complex transaction
schema migration
```

Typical checks:

```text
full relevant skill reviews
independent reviewer
unit tests
negative security tests
e2e/integration tests
lint
build
runtime verification
migration review where applicable
```

Use judgment.

Do not apply identical verification depth to every change.

---

## 9. Independent Review

For substantial or high-risk changes, use an independent reviewer subagent
when available.

Particularly useful for:

- authentication
- authorization
- tenant isolation
- billing
- payments
- inventory
- orders
- complex transactions
- background jobs
- major architecture changes

Provide the reviewer:

- original requirement
- changed files
- implementation summary
- relevant project rules

Ask the reviewer to find defects rather than merely confirm the work.

Treat reviewer findings as hypotheses.

Evaluate each finding before applying it.

---

## 10. Failure Loop

Any meaningful verification failure returns the task to implementation.

```text
Verification failure
       ↓
Identify root cause
       ↓
Fix
       ↓
Review affected code
       ↓
Run focused verification
       ↓
Run broader relevant checks
```

Do not weaken tests or suppress errors simply to achieve a green result.

---

## 11. Static Checks

For non-trivial changes, run:

```bash
npx eslint .
```

and:

```bash
npx nest build
```

Fix underlying lint/build issues.

Do not automatically introduce:

```ts
// eslint-disable
```

merely to suppress a failure.

A successful build is not proof of runtime correctness, but a failed build
means the implementation is not complete.

---

## 12. Runtime and Infrastructure Checks

When changes involve:

- module registration
- dependency injection
- controllers/routes
- configuration
- Redis/BullMQ
- schedulers
- Prisma schema
- runtime startup

perform appropriate runtime verification.

For exact commands and environment-specific checks, read
[RUNTIME-CHECKS.md](RUNTIME-CHECKS.md).

---

## 13. External Blockers

If a check cannot run because of an environment problem, report it precisely.

Examples:

- PostgreSQL unavailable
- Redis unavailable
- required env variable missing
- migration database inaccessible
- external dependency unavailable

Distinguish:

```text
implementation failed
```

from:

```text
environment prevented verification
```

Do not hide blockers.

---

## 14. Partial Verification

If only part of verification completed, report exactly what was run.

Example:

```text
Verified:
- focused Jest tests
- ESLint
- Nest build

Not verified:
- e2e suite because PostgreSQL was unavailable
```

Do not summarize partial verification as:

```text
everything passes
```

---

## 15. Final Reporting

When complete, report concisely:

1. what was implemented;
2. important architecture/security decisions;
3. relevant files/modules changed;
4. verification actually performed;
5. remaining blockers or limitations.

Example:

```text
Implemented supplier archive support.

Architecture:
- Added repository interface operation and Prisma implementation.
- Service remains persistence-agnostic.
- Archive operation is tenant-scoped.

Verified:
- supplier service tests
- tenant isolation negative test
- npx eslint .
- npx nest build

No known remaining issues.
```

Do not dump raw command output unless useful.

---

## Completion Gate

Before reporting completion, confirm:

- requirement is satisfied;
- relevant architecture review is complete;
- relevant security review is complete;
- persistence/transaction behavior is safe;
- relevant tests passed;
- lint passed where run;
- build passed where run;
- runtime/schema checks were performed when required;
- any unverified areas are explicitly reported.

---

## Final Principle

Verification should answer:

```text
Does it do what was requested?
          ↓
Does it preserve architecture?
          ↓
Is scoped data secure?
          ↓
Is failure/concurrency behavior safe?
          ↓
Does executed evidence support completion?
```

A backend task is complete only when sufficient evidence supports it.
