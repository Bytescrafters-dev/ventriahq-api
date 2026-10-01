---
name: background-jobs
description: >
  Rules for BullMQ queues, workers, processors, scheduled jobs, asynchronous
  workflows, and scheduler-only execution. Use when implementing or reviewing
  background processing, queues, cron jobs, retries, delayed work, or
  asynchronous side effects.
---

# Background Jobs

## Purpose

Use this skill when implementing or reviewing:

- BullMQ queues
- job producers
- processors/workers
- cron jobs
- scheduled work
- delayed jobs
- background emails
- async uploads/processing
- billing automation
- long-running or retryable work

Background processing should be:

- reliable
- idempotent
- retry-safe
- observable
- architecture-compliant
- safe under duplicate execution

---

## Existing Architecture

The project uses:

```text
@nestjs/schedule
       +
     BullMQ
       +
      Redis
```

Typical flow:

```text
Scheduler / Application Service
          ↓
        Queue
          ↓
       BullMQ
          ↓
      Processor
          ↓
   Application Service
          ↓
      Repository
```

Queue/job constants live in:

```text
src/common/queues/queues.constants.ts
```

Workers normally live under:

```text
src/modules/<module>/workers/
```

---

## 1. Decide Whether a Job Is Needed

Use background processing when work:

- is too slow for the request lifecycle;
- can happen after the response;
- needs retries;
- should survive application restarts;
- is delayed or scheduled;
- should be distributed across workers;
- calls unreliable external systems;
- needs queue-based backpressure.

Examples:

```text
send email
process image/file metadata
expire trial subscription
generate delayed billing action
large import
scheduled subscription processing
```

Do not introduce BullMQ for ordinary fast CRUD without a concrete reason.

---

## 2. Keep Business Logic in Services

Processors and schedulers do not bypass backend architecture.

Prefer:

```text
Processor
    ↓
Application Service
    ↓
Repository
```

rather than:

```text
Processor
    ↓
large business workflow
    ↓
direct Prisma
```

If an operation can be triggered from both HTTP and a worker, put the
business behavior in a reusable service.

Example:

```text
HTTP Controller
      ↓
SubscriptionService.expireTrial()

BullMQ Processor
      ↓
SubscriptionService.expireTrial()
```

Do not duplicate the business workflow inside the processor.

Use `backend-architecture` and `prisma-repositories` for detailed rules.

---

## 3. Queue and Job Constants

Do not scatter raw queue/job names throughout the application.

Use:

```text
QUEUES
JOBS
```

from:

```text
src/common/queues/queues.constants.ts
```

Before creating a new queue:

1. check whether an existing queue owns the workload;
2. determine whether adding a new job type is enough;
3. create a separate queue only for a real operational reason.

Separate queues when workloads genuinely require different:

- concurrency
- retry policy
- scaling
- resource usage
- failure isolation

Prefer a few cohesive queues over one queue per job type.

---

## 4. Job Payloads

Keep payloads small.

Prefer:

```ts
{
  subscriptionId: string;
}
```

over serializing complete database records.

IDs allow workers to reload current state.

Avoid storing unnecessary:

- entity snapshots
- secrets
- access tokens
- payment credentials
- personal data

inside Redis jobs.

---

## 5. Reload Current State

The state at enqueue time may differ from the state at processing time.

Example:

```text
Scheduler:
invoice is overdue
      ↓
enqueue
      ↓
processor runs later
      ↓
invoice may now be paid
```

Processors should generally reload the target resource before acting.

Do not blindly trust stale payload state.

---

## 6. Deterministic Job IDs

Use deterministic `jobId`s when duplicate enqueueing is possible.

Example:

```ts
jobId: `trial-expiry_${subscriptionId}`;
```

A good ID represents one logical business operation.

Examples:

```text
trial-expiry_<subscriptionId>

subscription-suspend_<subscriptionId>

invoice-reminder_<invoiceId>_<dueDate>
```

Do not use only the resource ID if several logical job types can exist for
the same resource.

Deterministic job IDs reduce duplicate queue entries.

They do not guarantee exactly-once execution.

For duplicate execution and replay safety, read
[IDEMPOTENCY.md](IDEMPOTENCY.md).

---

## 7. Processor Responsibilities

Processors may:

- validate payload shape
- reload current state
- invoke services
- perform background-specific orchestration
- log job context
- propagate failures for BullMQ retry handling

Processors should remain thin where practical.

Preferred:

```text
Job
 ↓
Processor
 ↓
Service
 ↓
Repository
```

---

## 8. Persistence Rules Still Apply

Do not inject `PrismaService` directly into a processor merely because it
runs outside HTTP.

Use repositories/services according to project architecture.

Tenant/store scope still applies.

For scoped data, use `multi-tenancy-security`.

Example:

```text
job payload
    ↓
tenantId + resourceId
    ↓
scoped repository lookup
```

Do not assume queued data is automatically trustworthy.

---

## 9. User-Initiated Jobs

If an authenticated user initiates background work:

```text
request
   ↓
authorize actor / scope
   ↓
enqueue trusted job
```

Perform authorization before enqueueing.

Do not enqueue arbitrary client-provided IDs and defer all authorization to
the worker.

The worker should still revalidate ownership/integrity where appropriate.

---

## 10. System Jobs

Scheduled/system jobs may operate without an interactive user.

Do not fabricate a fake authenticated admin.

Distinguish:

```text
HTTP actor authorization
```

from:

```text
system resource-scope integrity
```

A system job may legitimately act across tenants while still requiring
correct tenant/resource relationships.

---

## 11. Atomic Database Work

A processor may execute transactional database work.

Use:

```text
Processor
   ↓
Service
   ↓
Database transaction
   ↓
Repositories
```

Do not split one atomic database workflow across several independent jobs
unless eventual consistency is intentionally part of the design.

Do not keep PostgreSQL transactions open around:

```text
queue.add()
external HTTP calls
email
file uploads
```

BullMQ/Redis cannot participate in the PostgreSQL transaction.

Use `prisma-repositories/TRANSACTIONS.md` for transaction design.

---

## 12. Database → Queue Consistency

Always consider:

```text
database update succeeds
        ↓
queue.add fails
```

If missing the job would leave an invalid business state, simple:

```text
update DB
then enqueue
```

may not be sufficient.

Possible solutions include:

- retrying enqueue;
- scheduler-based reconciliation;
- deriving work from durable database state;
- an outbox pattern where business criticality justifies it.

Do not introduce an outbox automatically.

Design according to the actual consistency requirement.

---

## 13. Prefer Durable Business State

BullMQ coordinates execution.

It should not be the only source of truth for critical business state.

For example:

```text
subscription status
invoice state
tenant state
```

belong in PostgreSQL.

Durable DB state enables:

- reconciliation
- rescheduling
- auditing
- recovery

---

## 14. Job Size

Avoid giant unbounded jobs.

Bad:

```text
one job
   ↓
process every invoice in database
```

Prefer:

```text
scheduler
   ↓
one job per invoice
```

or bounded batches where appropriate.

Smaller work units improve:

- retries
- observability
- failure isolation
- scalability

---

## 15. Batch Jobs

If batching is required:

- keep batches bounded;
- make retries safe;
- define partial-failure behavior;
- avoid silently dropping failed items;
- use deterministic boundaries where useful.

Do not mark a batch successful when important items silently failed unless
that behavior is explicitly intended.

---

## 16. No Durable In-Memory State

Workers may restart at any time.

Do not rely on process memory for durable progress.

Use:

- database state
- BullMQ job state
- another durable store

according to the workflow.

---

## 17. Job Ordering

Do not assume jobs execute in business order merely because they were
enqueued in that order.

If:

```text
Job B
```

requires:

```text
Job A
```

to complete first, encode that dependency explicitly.

Do not rely on incidental queue order for correctness.

---

## 18. Obsolete Jobs

A job may become unnecessary before it executes.

Example:

```text
send overdue reminder
        ↓
invoice paid before execution
```

Processor should reload current state and safely skip obsolete work.

Explicit queue cancellation is not always required when state validation can
turn obsolete work into a safe no-op.

---

## 19. Deployment Compatibility

Queued jobs may outlive a deployment.

Consider:

```text
old queued payload
      +
new processor code
```

and during rolling deployments:

```text
newly enqueued payload
      +
older worker instance
```

Avoid breaking payload changes for long-lived/delayed jobs.

Use backward-compatible handling or explicit payload versioning where
required.

---

## 20. Logging

Logs should contain enough context to diagnose failures.

Useful fields:

- queue name
- job name
- job ID
- resource ID
- tenant/store ID where appropriate
- attempt number
- failure reason

Avoid logging:

- tokens
- passwords
- secrets
- payment credentials
- unnecessary personal data

Prefer:

```text
Failed trial-expiry job for subscription <id>
```

over:

```text
Something failed
```

---

## 21. Retry Behavior

Do not invent retry behavior casually.

For:

- retryable vs permanent failures
- backoff
- failure propagation
- poison jobs
- external side-effect safety
- provider idempotency keys

read [RETRIES.md](RETRIES.md).

---

## 22. Scheduled Work

For:

- cron responsibilities
- scheduler-only execution
- deterministic enqueueing
- scheduler overlap
- bounded due-work queries
- delayed jobs vs discovery
- grace-period workflows

read [SCHEDULERS.md](SCHEDULERS.md).

---

## Background Job Review

### Architecture

- Is BullMQ actually justified?
- Is business logic kept in services?
- Is persistence behind repositories?

### Payload

- Is payload minimal?
- Are resource IDs sufficient?
- Are secrets avoided?
- Is queued-payload compatibility considered?

### Processor

- Does it reload current state?
- Is duplicate execution safe?
- Can obsolete work become a no-op?
- Are failures propagated correctly?

### Persistence

- Are database writes atomic where required?
- Is queue/network I/O outside DB transactions?
- Is DB-success/enqueue-failure considered?

### Scope

- Is tenant/store scope explicit?
- Are resource relationships revalidated?
- Can manipulated payload data cross boundaries?

### Operations

- Are logs diagnostic?
- Can jobs be replayed safely?
- Are permanently failed critical jobs visible?

---

## Failure Questions

For every significant job ask:

```text
What if the job executes twice?

What if the worker crashes halfway?

What if state changes after enqueue?

What if DB succeeds but external work fails?

What if external work succeeds but the worker crashes?

What if DB commits but queue.add fails?

What if deployment happens while old jobs remain queued?
```

The design should remain correct or recoverable.

---

## Verification

After background-job changes:

1. review queue/job constants;
2. verify processor architecture;
3. verify idempotency;
4. verify retry behavior;
5. verify scheduler-only compatibility where relevant;
6. verify tenant/store scope;
7. verify transaction behavior;
8. run relevant tests;
9. use `backend-verification` for final checks.

---

## Final Principle

Design as though:

```text
Jobs may execute more than once.
Workers may crash.
Schedulers may run more than once.
State may change after enqueue.
External systems may fail.
Deployments may happen while jobs remain queued.
```

Prefer:

```text
deterministic enqueueing
        +
idempotent processing
        +
current-state validation
        +
retry-safe side effects
        +
explicit tenant/store scope
        +
durable database state
```

BullMQ does not provide exactly-once business execution.

Correctness must come from application design.
