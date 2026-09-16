import { BillingCycle, Prisma } from '@prisma/client';
import {
  addBillingCycle,
  calcDueDate,
  nextInvoiceNumber,
} from './billing.utils';

/** Reads better than `new Date(...)` inline, and keeps every case in UTC. */
const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

describe('addBillingCycle', () => {
  it('advances MONTHLY by one month', () => {
    expect(
      iso(addBillingCycle(at('2026-03-15T00:00:00Z'), BillingCycle.MONTHLY)),
    ).toBe('2026-04-15T00:00:00.000Z');
  });

  it('advances QUARTERLY by three months', () => {
    expect(
      iso(addBillingCycle(at('2026-03-15T00:00:00Z'), BillingCycle.QUARTERLY)),
    ).toBe('2026-06-15T00:00:00.000Z');
  });

  it('advances SEMI_ANNUAL by six months', () => {
    expect(
      iso(
        addBillingCycle(at('2026-03-15T00:00:00Z'), BillingCycle.SEMI_ANNUAL),
      ),
    ).toBe('2026-09-15T00:00:00.000Z');
  });

  it('advances ANNUAL by one year', () => {
    expect(
      iso(addBillingCycle(at('2026-03-15T00:00:00Z'), BillingCycle.ANNUAL)),
    ).toBe('2027-03-15T00:00:00.000Z');
  });

  it('rolls the year over when the cycle crosses December', () => {
    expect(
      iso(addBillingCycle(at('2026-11-10T00:00:00Z'), BillingCycle.QUARTERLY)),
    ).toBe('2027-02-10T00:00:00.000Z');
  });

  it('preserves the time of day', () => {
    expect(
      iso(
        addBillingCycle(at('2026-03-15T13:45:30.123Z'), BillingCycle.MONTHLY),
      ),
    ).toBe('2026-04-15T13:45:30.123Z');
  });

  it('does not mutate the date it was given', () => {
    const input = at('2026-03-15T00:00:00Z');
    addBillingCycle(input, BillingCycle.ANNUAL);
    expect(iso(input)).toBe('2026-03-15T00:00:00.000Z');
  });

  // The switch has no `default` branch, so a BillingCycle member added to the
  // Prisma schema without a case here would silently return the period start
  // unchanged — an invoice with a zero-length billing period.
  it('handles every BillingCycle member', () => {
    const start = at('2026-03-15T00:00:00Z');
    for (const cycle of Object.values(BillingCycle)) {
      expect(addBillingCycle(start, cycle).getTime()).toBeGreaterThan(
        start.getTime(),
      );
    }
  });

  describe('end-of-month anchors', () => {
    it('clamps Jan 31 to the last day of February', () => {
      expect(
        iso(addBillingCycle(at('2026-01-31T00:00:00Z'), BillingCycle.MONTHLY)),
      ).toBe('2026-02-28T00:00:00.000Z');
    });

    it('clamps Jan 31 to Feb 29 in a leap year', () => {
      expect(
        iso(addBillingCycle(at('2028-01-31T00:00:00Z'), BillingCycle.MONTHLY)),
      ).toBe('2028-02-29T00:00:00.000Z');
    });

    it('clamps Jan 31 to Apr 30 across a quarter ending in a 30-day month', () => {
      expect(
        iso(
          addBillingCycle(at('2026-01-31T00:00:00Z'), BillingCycle.QUARTERLY),
        ),
      ).toBe('2026-04-30T00:00:00.000Z');
    });

    it('clamps Aug 31 + SEMI_ANNUAL to the last day of February', () => {
      expect(
        iso(
          addBillingCycle(at('2026-08-31T00:00:00Z'), BillingCycle.SEMI_ANNUAL),
        ),
      ).toBe('2027-02-28T00:00:00.000Z');
    });

    it('clamps a Feb 29 leap day to Feb 28 on an ANNUAL cycle', () => {
      expect(
        iso(addBillingCycle(at('2024-02-29T00:00:00Z'), BillingCycle.ANNUAL)),
      ).toBe('2025-02-28T00:00:00.000Z');
    });

    it('leaves a 30-day month end untouched when the target month is longer', () => {
      expect(
        iso(addBillingCycle(at('2026-04-30T00:00:00Z'), BillingCycle.MONTHLY)),
      ).toBe('2026-05-30T00:00:00.000Z');
    });

    it('preserves the time of day when clamping', () => {
      expect(
        iso(
          addBillingCycle(at('2026-01-31T13:45:30.123Z'), BillingCycle.MONTHLY),
        ),
      ).toBe('2026-02-28T13:45:30.123Z');
    });

    it('never overflows into the month after the target month', () => {
      // Every month end, every cycle length: the result must stay in the month
      // the cycle actually lands on.
      for (let month = 0; month < 12; month++) {
        const monthEnd = new Date(Date.UTC(2026, month + 1, 0));
        for (const cycle of Object.values(BillingCycle)) {
          const result = addBillingCycle(monthEnd, cycle);
          const expectedMonth = new Date(Date.UTC(2026, month + 1, 0));
          expectedMonth.setUTCDate(1);
          expectedMonth.setUTCMonth(
            expectedMonth.getUTCMonth() +
              { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 }[cycle],
          );
          expect(result.getUTCMonth()).toBe(expectedMonth.getUTCMonth());
          expect(result.getUTCFullYear()).toBe(expectedMonth.getUTCFullYear());
        }
      }
    });

    // Clamping is one-way: the shortened date carries into the next renewal,
    // because BillingProcessor chains from `sub.currentPeriodEnd` and nothing
    // records the day the tenant originally signed up on. Far milder than the
    // old overflow (which skipped February outright and moved the anchor to
    // the 3rd), but a tenant who signs up on the 31st settles on the 28th.
    // Fixing this properly needs a persisted anchor day on TenantSubscription.
    it('ratchets the anchor down to the shortest month seen when renewals chain', () => {
      let period = at('2026-01-31T00:00:00Z');
      const anchors: number[] = [];
      for (let i = 0; i < 3; i++) {
        period = addBillingCycle(period, BillingCycle.MONTHLY);
        anchors.push(period.getUTCDate());
      }
      expect(anchors).toEqual([28, 28, 28]);
    });
  });
});

describe('calcDueDate', () => {
  it('adds the schema default of 3 days to the period end', () => {
    expect(iso(calcDueDate(at('2026-04-15T00:00:00Z'), 3))).toBe(
      '2026-04-18T00:00:00.000Z',
    );
  });

  it('treats 0 days as due on the period end itself', () => {
    expect(iso(calcDueDate(at('2026-04-15T00:00:00Z'), 0))).toBe(
      '2026-04-15T00:00:00.000Z',
    );
  });

  it('carries across a month boundary', () => {
    expect(iso(calcDueDate(at('2026-04-29T00:00:00Z'), 5))).toBe(
      '2026-05-04T00:00:00.000Z',
    );
  });

  it('carries across a year boundary', () => {
    expect(iso(calcDueDate(at('2026-12-30T00:00:00Z'), 7))).toBe(
      '2027-01-06T00:00:00.000Z',
    );
  });

  it('lands on Feb 29 in a leap year', () => {
    expect(iso(calcDueDate(at('2024-02-27T00:00:00Z'), 2))).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('preserves the time of day', () => {
    expect(iso(calcDueDate(at('2026-04-15T09:30:00Z'), 3))).toBe(
      '2026-04-18T09:30:00.000Z',
    );
  });

  it('does not mutate the date it was given', () => {
    const input = at('2026-04-15T00:00:00Z');
    calcDueDate(input, 10);
    expect(iso(input)).toBe('2026-04-15T00:00:00.000Z');
  });
});

describe('nextInvoiceNumber', () => {
  /** Minimal stand-in for the one table this helper touches. */
  const txWithSeq = (invoiceSeq: number) => {
    const upsert = jest.fn().mockResolvedValue({ invoiceSeq });
    const tx = {
      billingSequence: { upsert },
    } as unknown as Prisma.TransactionClient;
    return { tx, upsert };
  };

  it('formats the sequence padded to six digits', async () => {
    const { tx } = txWithSeq(42);
    await expect(nextInvoiceNumber(tx)).resolves.toBe('INV-000042');
  });

  it('formats the very first invoice as INV-000001', async () => {
    const { tx } = txWithSeq(1);
    await expect(nextInvoiceNumber(tx)).resolves.toBe('INV-000001');
  });

  it('does not truncate once the sequence outgrows six digits', async () => {
    const { tx } = txWithSeq(1234567);
    await expect(nextInvoiceNumber(tx)).resolves.toBe('INV-1234567');
  });

  it('atomically increments the singleton row rather than reading then writing', async () => {
    const { tx, upsert } = txWithSeq(7);
    await nextInvoiceNumber(tx);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, invoiceSeq: 1 },
      update: { invoiceSeq: { increment: 1 } },
      select: { invoiceSeq: true },
    });
  });

  it('uses the transaction client it is handed', async () => {
    const { tx, upsert } = txWithSeq(7);
    await nextInvoiceNumber(tx);
    expect(upsert.mock.instances[0]).toBe(tx.billingSequence);
  });
});
