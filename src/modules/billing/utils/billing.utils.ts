import { BillingCycle, Prisma } from '@prisma/client';

/** Number of calendar months each billing cycle advances. */
const CYCLE_MONTHS: Record<BillingCycle, number> = {
  [BillingCycle.MONTHLY]: 1,
  [BillingCycle.QUARTERLY]: 3,
  [BillingCycle.SEMI_ANNUAL]: 6,
  [BillingCycle.ANNUAL]: 12,
};

/** Last day of the UTC month that `d` falls in. */
function daysInUtcMonth(d: Date): number {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/**
 * Adds whole months, clamping to the last day of the target month rather than
 * overflowing into the next one. Naively calling setUTCMonth on a month-end
 * date overflows — Jan 31 + 1 month becomes "Feb 31", which normalises to
 * Mar 3 — and because renewals chain off the previous period end, that would
 * permanently move a tenant's billing anchor off the 31st.
 */
function addUtcMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  // Park on the 1st first so the month shift itself can never overflow.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, daysInUtcMonth(d)));
  return d;
}

export function addBillingCycle(date: Date, cycle: BillingCycle): Date {
  const months = CYCLE_MONTHS[cycle];
  // Unreachable for a mapped cycle — CYCLE_MONTHS is exhaustive over the enum
  // at compile time — but a value arriving from outside TypeScript must not
  // silently yield a zero-length billing period.
  if (months === undefined) {
    throw new Error(`Unhandled billing cycle: ${String(cycle)}`);
  }
  return addUtcMonthsClamped(date, months);
}

export function calcDueDate(periodEnd: Date, daysUntilDue: number): Date {
  const d = new Date(periodEnd);
  d.setUTCDate(d.getUTCDate() + daysUntilDue);
  return d;
}

// Atomically increments the global invoice sequence and returns the formatted
// invoice number. Must be called inside a Prisma transaction.
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const seq = await tx.billingSequence.upsert({
    where: { id: 1 },
    create: { id: 1, invoiceSeq: 1 },
    update: { invoiceSeq: { increment: 1 } },
    select: { invoiceSeq: true },
  });
  return `INV-${String(seq.invoiceSeq).padStart(6, '0')}`;
}
