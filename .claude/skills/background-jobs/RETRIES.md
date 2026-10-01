# Retry and Failure Handling

Use this reference when:

- configuring job attempts;
- deciding whether a failure should retry;
- working with external APIs;
- sending email;
- processing payments;
- handling permanent failures;
- designing backoff;
- handling partial success.

---

## Retry Only Recoverable Failures

Retry failures that may reasonably succeed later.

Typical retryable failures:

- temporary network error
- third-party timeout
- transient AWS failure
- email provider outage
- temporary DB connectivity issue

Typical non-retryable failures:

- malformed job payload
- invalid resource ID
- unsupported business transition
- permanently deleted entity
- authorization/integrity violation
- configuration requiring human intervention

Do not retry blindly.

---

## Do Not Swallow Retryable Errors

Bad:

```ts
try {
  await this.emailService.send(...);
} catch (error) {
  this.logger.error(error);
}
```

BullMQ sees this as success.

When retry is required:

```ts
try {
  await this.emailService.send(...);
} catch (error) {
  this.logger.error(...);
  throw error;
}
```

Log and rethrow.

---

## Backoff

Transient external failures should normally use backoff.

Conceptually:

```text
attempt 1
   ↓ fail

wait

attempt 2
   ↓ fail

wait longer

attempt 3
```

Avoid aggressive retries that can overload:

- external APIs
- Redis
- Postgres
- email providers

Follow existing project conventions when available.

---

## Retry Safety

Before enabling retries ask:

> What happens if the operation partially succeeds and then throws?

Example:

```text
payment succeeds externally
       ↓
DB update fails
       ↓
job retries
       ↓
payment may happen again
```

This workflow is not retry-safe without idempotency/reconciliation.

---

## External Side Effects

Irreversible side effects need explicit design.

Examples:

- payment
- email
- SMS
- third-party mutation
- external file creation

Potential protections:

- provider idempotency key
- durable operation record
- state marker
- reconciliation workflow

Use `IDEMPOTENCY.md`.

---

## Database Failure

If a job performs several related DB writes, use a database transaction.

Example:

```text
update invoice
+
update subscription
+
create audit record
```

If one fails, the atomic DB workflow should roll back.

Use `prisma-repositories/TRANSACTIONS.md`.

---

## Queue + Database Failure

Consider:

```text
database succeeds
       ↓
queue.add fails
```

and:

```text
job received
       ↓
database fails
```

The first may require:

- enqueue retry
- scheduled reconciliation
- deriving jobs from DB state
- outbox where justified

The second may be retryable if:

- the DB failure is transient;
- the processor is safe to repeat.

---

## Permanently Failed Jobs

When retries are exhausted, decide whether the workflow requires:

- operational alerting
- manual intervention
- reconciliation
- scheduled rediscovery
- dead-letter-like handling

Do not create elaborate failure infrastructure without a requirement.

But do not silently ignore permanently failed critical jobs.

---

## Poison Jobs

A job that cannot succeed with the same payload should not retry forever.

Examples:

- malformed payload
- unsupported state
- invalid required ID
- permanently missing config

Fail clearly and allow attempt exhaustion.

Do not create infinite retry loops.

---

## Logging Failures

On failure log useful context:

- job name
- job ID
- queue
- resource ID
- tenant/store scope
- attempt number
- failure reason

Preserve original errors where possible.

Do not replace every failure with a generic message.

---

## Failure Classification

Before throwing, determine:

```text
transient?
    → retry

permanent?
    → fail

obsolete?
    → safe no-op

already completed?
    → safe no-op where business rules allow
```

Do not use retries to compensate for invalid business state.

---

## Retry Checklist

- failure type identified
- retries only used where success may later be possible
- backoff appropriate
- processor does not swallow errors
- repeated execution is safe
- external side effects protected
- permanent failure is visible
- poison jobs do not loop forever
- logging includes diagnostic context
