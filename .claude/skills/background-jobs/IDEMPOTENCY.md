# Idempotency and Duplicate Execution

Use this reference when:

- jobs can be scheduled repeatedly;
- duplicate enqueueing is possible;
- processors perform state transitions;
- external side effects may occur;
- workers may crash after partial success;
- jobs may be replayed manually.

---

## Core Assumption

Assume a job can execute more than once.

Causes include:

- retries
- worker crash
- manual replay
- queue redelivery
- deployment interruption
- unknown external timeout outcome

Do not design around:

```text
"This job will only run once."
```

---

## Deterministic Job IDs

A deterministic `jobId` prevents some duplicate queue entries.

Example:

```ts
jobId: `trial-expiry_${subscriptionId}`;
```

A job ID should describe one logical operation.

Good:

```text
trial-expiry_<subscriptionId>

invoice-reminder_<invoiceId>_<dueDate>
```

Poor:

```text
<subscriptionId>
```

when several different job types can exist for that subscription.

---

## Job ID Is Not Full Idempotency

Even with a deterministic ID:

```text
job starts
   ↓
side effect happens
   ↓
worker crashes
   ↓
job retries
```

The second execution can still repeat the side effect.

Therefore processor logic must also be idempotent.

---

## Reload Current State

Do not rely solely on job payload state.

Example:

```text
enqueue:
subscription = TRIAL

later:
processor executes

current state may now be ACTIVE
```

Reload from durable storage before performing state transitions.

---

## Idempotent State Transitions

Before applying a transition, verify it is still required.

Example:

```ts
if (subscription.status !== SubscriptionStatus.TRIAL) {
  return;
}
```

If a transition has already completed, a safe no-op is often appropriate.

Example:

```text
job: suspend tenant

tenant already SUSPENDED
    ↓
return successfully
```

only when that behavior matches business rules.

---

## Avoid Repeating Side Effects

An already-completed state must not automatically re-trigger:

- email
- payment charge
- notification
- inventory adjustment
- upload
- external API operation

Separate:

```text
state already achieved
```

from:

```text
side effect still required
```

carefully.

---

## External Idempotency

For irreversible external operations, use provider-level idempotency when
available.

Example:

```text
invoice-charge_<invoiceId>
```

Use a stable key for the same logical operation.

Do not generate a new random key on each retry.

---

## Email Idempotency

Duplicate customer communications may be harmful.

Possible protections:

- deterministic job ID
- sent-at timestamp
- notification record
- state-transition marker
- provider idempotency
- another durable duplicate-prevention mechanism

Do not assume queue uniqueness guarantees exactly-once email delivery.

---

## Snapshot vs Current State

For jobs such as email, decide whether behavior should use:

```text
state at enqueue time
```

or:

```text
latest state at processing time
```

Both may be correct.

Make the decision explicit.

If snapshot semantics are required, include only the necessary immutable
payload.

If current-state semantics are required, pass identifiers and reload.

---

## Obsolete Jobs

A job may become irrelevant.

Example:

```text
overdue reminder queued
      ↓
invoice paid
      ↓
job executes
```

Processor should recognize the new state and safely stop.

Obsolete work should not be treated as failure when no action is required.

---

## User-Initiated Jobs

Authorization should normally happen before enqueue.

Processor still verifies resource integrity where required.

Example:

```text
Admin requests export
      ↓
authorize tenant/store
      ↓
enqueue resource IDs
      ↓
worker verifies expected ownership before processing
```

---

## Multi-Tenant Idempotency

A job identifier should not accidentally collide across tenant boundaries.

Where resource IDs are not globally unique, include appropriate scope.

Example:

```text
invoice-reminder_<tenantId>_<invoiceId>_<dueDate>
```

if required by the data model.

Do not allow idempotency logic itself to create cross-tenant behavior.

---

## Duplicate-Execution Thought Experiment

For every processor ask:

> What happens if this exact job executes twice in parallel?

Then ask:

> What happens if the first execution finishes the external side effect but
> crashes before BullMQ acknowledges success?

If the answer includes duplicate billing, duplicate stock updates, duplicate
email, or invalid state, stronger idempotency is required.

---

## Idempotency Checklist

- deterministic `jobId` where duplicate enqueueing is possible
- job ID represents one logical operation
- processor reloads current state
- repeated execution is safe
- already-completed transition becomes safe no-op where appropriate
- external side effects have duplicate protection
- obsolete jobs are skipped safely
- tenant/store identity is preserved
- durable state, not process memory, records important progress
