// Pin the timezone before Jest forks its workers, so they inherit TZ=UTC from
// birth. Billing period maths (addBillingCycle, calcDueDate) uses local-time
// Date mutators, so an unpinned TZ makes results depend on the developer's
// machine and drift under DST. Setting this in `setupFiles` is too late —
// the test environment has already bound Date by then.
export default function globalSetup(): void {
  process.env.TZ = 'UTC';
}
