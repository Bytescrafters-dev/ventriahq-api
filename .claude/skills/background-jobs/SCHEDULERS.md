# Scheduler and Scheduled Work Guidelines

Use this reference when implementing:

- `@Cron`
- recurring scheduled discovery
- delayed jobs
- grace-period workflows
- scheduler-only execution
- due-record queries
- scheduling overlap protection
- time-based business rules

---

## Scheduler Responsibility

Schedulers should normally:

```text
discover due work
      ↓
enqueue jobs
```

They should not contain the full business workflow.

Example:

```text
BillingScheduler
      ↓
find expired trials
      ↓
enqueue one job per subscription
```

Processor/service performs the actual transition.

---

## Keep Cron Methods Small

Avoid:

```ts
@Cron(...)
async processSubscriptions() {
  // invoice generation
  // subscription transition
  // email sending
  // external API calls
  // many DB writes
}
```

Prefer:

```text
Cron
 ↓
find due records
 ↓
enqueue jobs
```

This gives better:

- retries
- failure isolation
- observability
- workload distribution

---

## Scheduler Persistence Access

Schedulers may need to discover due records.

Prefer:

```text
Scheduler
   ↓
Repository / Application Service
   ↓
scoped due-work query
```

Example:

```text
BillingScheduler
      ↓
SubscriptionRepository.findTrialsDueForExpiry()
      ↓
enqueue
```

Do not allow schedulers to become an alternate persistence layer.

---

## Scheduler-Only Process

The application supports:

```text
SCHEDULER_ONLY=true
        ↓
NestFactory.createApplicationContext(...)
        ↓
no HTTP listener
```

This maps to the dedicated scheduler ECS service.

When adding scheduled behavior verify:

- scheduler provider initializes in application-context mode;
- no HTTP request object is required;
- no request-scoped actor is required;
- required modules/providers are available;
- scheduler does not accidentally run in every API instance.

---

## No Request Context

Schedulers cannot depend on:

- request
- headers
- cookies
- authenticated HTTP user
- session state

Load required durable context explicitly.

---

## Deterministic Enqueueing

Scheduled jobs should use deterministic `jobId`s where repeated scheduler
runs may rediscover the same work.

Example:

```ts
await this.billingQueue.add(
  JOBS.EXPIRE_TRIAL,
  {
    subscriptionId: subscription.id,
  },
  {
    jobId: `trial-expiry_${subscription.id}`,
  },
);
```

Use `IDEMPOTENCY.md` for duplicate execution design.

---

## Bounded Scheduler Queries

Do not assume due work remains small.

Avoid unbounded:

```ts
findMany({
  where: {
    dueAt: {
      lte: now,
    },
  },
});
```

for workloads that may grow significantly.

Use:

- limits
- pagination
- bounded batches

according to project scale.

---

## Scheduler Overlap

Consider:

```text
scheduler run A starts
        ↓
still running
        ↓
scheduler run B starts
```

Possible protections include:

- keeping scheduler work short
- deterministic job IDs
- bounded batching
- dedicated scheduler deployment
- distributed locking only when truly required

Do not introduce a distributed lock automatically.

First determine whether deterministic enqueueing and idempotent processors
already solve the problem.

---

## Delayed Job vs Scheduled Discovery

Choose intentionally between:

```text
enqueue delayed job now
```

and:

```text
periodically discover due DB records
```

Delayed jobs are useful when execution time is known and Redis scheduling is
appropriate.

Scheduled discovery is useful when:

- DB state is the business source of truth;
- due work can be reconstructed;
- business state may change;
- reconciliation is valuable.

Follow existing project patterns unless another design is clearly justified.

---

## Time Semantics

Define time conditions precisely.

Examples:

```text
trialEndsAt
invoiceDueAt
gracePeriodEndsAt
renewAt
```

Avoid ambiguous logic such as:

```text
"today"
```

without explicit timezone/business semantics.

Follow existing timestamp conventions.

---

## Grace-Period Workflows

Example:

```text
invoice due
    ↓
grace period
    ↓
tenant suspension
```

The scheduler may discover candidates.

The processor should re-evaluate:

```text
Is invoice still unpaid?
Is grace period actually over?
Is subscription still active?
Is tenant already suspended?
```

Do not rely solely on the state that originally caused scheduling.

---

## State Transitions

Processors performing scheduled transitions should validate current state.

Examples:

```text
TRIAL → ACTIVE
PAST_DUE → SUSPENDED
```

Do not blindly set the target state.

Use service-level transition rules.

---

## Scheduler Query + Job Granularity

Prefer:

```text
scheduler
   ↓
find bounded candidates
   ↓
one job per resource
```

when practical.

This improves:

- retry isolation
- visibility
- concurrency control
- failure handling

Use bounded batch jobs only when one-job-per-record would be excessive.

---

## Deployment Safety

Verify scheduled code works when:

```text
old job payloads
        +
new code
```

and during rolling deployment where old workers may still exist.

Long-lived scheduled/delayed payloads should remain backward compatible or
be versioned intentionally.

---

## Scheduler Testing

Scheduler tests should verify:

```text
due records
   ↓
correct jobs enqueued
```

and:

```text
not-due records
   ↓
no jobs enqueued
```

Also test:

- deterministic `jobId`
- expected payload
- bounded query behavior where relevant

Do not make scheduler tests execute the full processor workflow.

Keep scheduler and processor responsibilities separate.

---

## Scheduler Review Checklist

- scheduler only discovers/enqueues
- scheduler runs only in intended process
- due-work query is bounded where required
- deterministic job IDs prevent duplicate enqueue
- no HTTP request context is required
- time conditions are explicit
- state is revalidated in processor
- overlap behavior is safe
- delayed vs discovery strategy is intentional
- scheduler tests cover due/not-due behavior
