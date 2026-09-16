import { Logger } from '@nestjs/common';
import { BillingCycle } from '@prisma/client';
import { Job } from 'bullmq';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { JOBS } from 'src/common/queues/queues.constants';
import { BillingProcessor } from './billing.processor';

const SUB_ID = 'sub-1';
const TENANT_ID = 'tenant-1';
const INVOICE_ID = 'invoice-1';
/** Fixed clock so period/due dates are exact. TZ is pinned to UTC globally. */
const NOW = new Date('2026-03-15T00:00:00.000Z');

/** The Prisma delegates this processor touches inside $transaction. */
interface TxStub {
  billingSequence: { upsert: jest.Mock };
  tenantSubscription: { updateMany: jest.Mock; update: jest.Mock };
  tenantInvoice: { updateMany: jest.Mock; create: jest.Mock };
  tenant: { update: jest.Mock };
  refreshToken: { updateMany: jest.Mock };
  storeUserRefreshToken: { updateMany: jest.Mock };
  adminStore: { findMany: jest.Mock };
}

/** First argument of a mock's first call, typed. */
const argOf = <T>(m: jest.Mock): T => {
  const calls = m.mock.calls as unknown as T[][];
  return calls[0][0];
};

describe('BillingProcessor', () => {
  let processor: BillingProcessor;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: TxStub;
  let $transaction: jest.Mock;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const makeSubscription = (overrides: Record<string, any> = {}) => ({
    id: SUB_ID,
    tenantId: TENANT_ID,
    status: 'TRIAL',
    cancelAtPeriodEnd: false,
    daysUntilDue: 3,
    currentPeriodEnd: null,
    planPrice: {
      planName: 'Pro',
      billingCycle: BillingCycle.MONTHLY,
      amount: 4900,
      currency: 'AUD',
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    prisma = mockDeep<PrismaService>();
    tx = {
      // nextInvoiceNumber() is the real helper, so give it a sequence to read.
      billingSequence: {
        upsert: jest.fn().mockResolvedValue({ invoiceSeq: 42 }),
      },
      tenantSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      tenantInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      tenant: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storeUserRefreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      adminStore: { findMany: jest.fn().mockResolvedValue([]) },
    };
    $transaction = prisma.$transaction as unknown as jest.Mock;
    $transaction.mockImplementation((fn: (client: unknown) => unknown) =>
      fn(tx),
    );

    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    processor = new BillingProcessor(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  const job = (name: string, data: unknown, id = 'job-1') =>
    ({ name, data, id }) as unknown as Job;

  describe('job dispatch', () => {
    it('routes a trial-expiry job to the trial handler', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(null as never);
      await processor.process(
        job(JOBS.TRIAL_EXPIRY, { subscriptionId: SUB_ID }),
      );

      expect(prisma.tenantSubscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SUB_ID } }),
      );
    });

    it('routes a period-end job to the period handler', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(null as never);
      await processor.process(job(JOBS.PERIOD_END, { subscriptionId: SUB_ID }));

      expect(prisma.tenantSubscription.findUnique).toHaveBeenCalledTimes(1);
    });

    it('routes an overdue-invoice job to the invoice handler', async () => {
      prisma.tenantInvoice.findUnique.mockResolvedValue(null as never);
      await processor.process(
        job(JOBS.OVERDUE_INVOICE, { invoiceId: INVOICE_ID }),
      );

      expect(prisma.tenantInvoice.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: INVOICE_ID } }),
      );
    });

    it('warns and does nothing for an unrecognised job name', async () => {
      await processor.process(job('not-a-billing-job', {}));

      expect(warn).toHaveBeenCalledWith(
        'Unknown billing job: not-a-billing-job',
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('failure reporting', () => {
    it('logs the job name, id and error message', () => {
      processor.onFailed(
        job(JOBS.PERIOD_END, {}, 'job-77'),
        new Error('connection reset'),
      );

      expect(error).toHaveBeenCalledWith(
        'Billing job period-end [job-77] failed: connection reset',
      );
    });
  });

  describe('trial expiry', () => {
    const run = () =>
      processor.process(job(JOBS.TRIAL_EXPIRY, { subscriptionId: SUB_ID }));

    it('does nothing when the subscription has been deleted', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(null as never);
      await run();
      expect($transaction).not.toHaveBeenCalled();
    });

    it('activates the subscription for exactly one billing cycle', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(
        makeSubscription() as never,
      );
      await run();

      expect(tx.tenantSubscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: 'TRIAL' },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: NOW,
          currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
        },
      });
    });

    it.each([
      [BillingCycle.QUARTERLY, '2026-06-15T00:00:00.000Z'],
      [BillingCycle.SEMI_ANNUAL, '2026-09-15T00:00:00.000Z'],
      [BillingCycle.ANNUAL, '2027-03-15T00:00:00.000Z'],
    ])('honours a %s plan cycle', async (billingCycle, expected) => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(
        makeSubscription({
          planPrice: {
            planName: 'Pro',
            billingCycle,
            amount: 4900,
            currency: 'AUD',
          },
        }) as never,
      );
      await run();

      const { data } = argOf<{ data: { currentPeriodEnd: Date } }>(
        tx.tenantSubscription.updateMany,
      );
      expect(data.currentPeriodEnd).toEqual(new Date(expected));
    });

    // The status filter is what makes the job safe to re-run.
    it('only activates a subscription still in TRIAL', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(
        makeSubscription() as never,
      );
      await run();

      const { where } = argOf<{ where: { status: string } }>(
        tx.tenantSubscription.updateMany,
      );
      expect(where.status).toBe('TRIAL');
    });

    it('promotes the tenant onto the plan', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(
        makeSubscription() as never,
      );
      await run();

      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
        data: { currentPlanName: 'Pro', status: 'ACTIVE', trialEndsAt: null },
      });
    });

    it('raises the first invoice, due after the period ends', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(
        makeSubscription() as never,
      );
      await run();

      expect(tx.tenantInvoice.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          subscriptionId: SUB_ID,
          invoiceNumber: 'INV-000042',
          amount: 4900,
          currency: 'AUD',
          dueDate: new Date('2026-04-18T00:00:00.000Z'), // periodEnd + 3 days
        },
      });
    });

    describe('when the subscription already left TRIAL', () => {
      beforeEach(() => {
        prisma.tenantSubscription.findUnique.mockResolvedValue(
          makeSubscription() as never,
        );
        tx.tenantSubscription.updateMany.mockResolvedValue({ count: 0 });
      });

      it('raises no invoice', async () => {
        await run();
        expect(tx.tenantInvoice.create).not.toHaveBeenCalled();
      });

      it('leaves the tenant untouched', async () => {
        await run();
        expect(tx.tenant.update).not.toHaveBeenCalled();
      });

      // KNOWN DEFECT: `return` exits the $transaction callback, not the method,
      // so the success line below it runs regardless. The log claims the trial
      // was activated when nothing was written.
      it('still logs success (misleading)', async () => {
        await run();
        expect(log).toHaveBeenCalledWith(
          `Activated trial subscription ${SUB_ID}`,
        );
      });
    });
  });

  describe('period end', () => {
    const run = () =>
      processor.process(job(JOBS.PERIOD_END, { subscriptionId: SUB_ID }));

    const active = (overrides: Record<string, any> = {}) =>
      makeSubscription({
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-03-15T00:00:00.000Z'),
        ...overrides,
      });

    it('does nothing when the subscription has been deleted', async () => {
      prisma.tenantSubscription.findUnique.mockResolvedValue(null as never);
      await run();
      expect($transaction).not.toHaveBeenCalled();
    });

    describe('when cancellation was requested', () => {
      beforeEach(() => {
        prisma.tenantSubscription.findUnique.mockResolvedValue(
          active({ cancelAtPeriodEnd: true }) as never,
        );
      });

      it('ends the subscription', async () => {
        await run();
        expect(tx.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: SUB_ID },
          data: { status: 'CANCELED', endedAt: NOW },
        });
      });

      it('cancels the tenant', async () => {
        await run();
        expect(tx.tenant.update).toHaveBeenCalledWith({
          where: { id: TENANT_ID },
          data: { status: 'CANCELED' },
        });
      });

      // Billing a subscription the customer already cancelled is the expensive
      // mistake here, so the early return must happen before invoicing.
      it('raises no further invoice', async () => {
        await run();
        expect(tx.tenantInvoice.create).not.toHaveBeenCalled();
        expect(prisma.tenantInvoice.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('when an invoice is already outstanding', () => {
      beforeEach(() => {
        prisma.tenantSubscription.findUnique.mockResolvedValue(
          active() as never,
        );
        prisma.tenantInvoice.findFirst.mockResolvedValue({
          id: 'existing',
        } as never);
      });

      it('does not stack a second invoice', async () => {
        await run();
        expect(tx.tenantInvoice.create).not.toHaveBeenCalled();
        expect($transaction).not.toHaveBeenCalled();
      });

      it('looks for outstanding invoices on this subscription only', async () => {
        await run();
        expect(prisma.tenantInvoice.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { subscriptionId: SUB_ID, status: 'PENDING' },
          }),
        );
      });
    });

    describe('renewal', () => {
      beforeEach(() => {
        prisma.tenantSubscription.findUnique.mockResolvedValue(
          active() as never,
        );
        prisma.tenantInvoice.findFirst.mockResolvedValue(null as never);
      });

      // The new period starts where the old one ended, not at "now", so periods
      // stay contiguous even if the job runs late.
      it('starts the new period where the previous one ended', async () => {
        await run();
        expect(tx.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: SUB_ID },
          data: {
            currentPeriodStart: new Date('2026-03-15T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
          },
        });
      });

      it('leaves no gap when the job runs days late', async () => {
        jest.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));
        await run();

        const { data } = argOf<{ data: { currentPeriodStart: Date } }>(
          tx.tenantSubscription.update,
        );
        expect(data.currentPeriodStart).toEqual(
          new Date('2026-03-15T00:00:00.000Z'),
        );
      });

      it('raises the renewal invoice against the new period', async () => {
        await run();
        expect(tx.tenantInvoice.create).toHaveBeenCalledWith({
          data: {
            tenantId: TENANT_ID,
            subscriptionId: SUB_ID,
            invoiceNumber: 'INV-000042',
            amount: 4900,
            currency: 'AUD',
            dueDate: new Date('2026-04-18T00:00:00.000Z'),
          },
        });
      });
    });
  });

  describe('overdue invoice', () => {
    const run = () =>
      processor.process(job(JOBS.OVERDUE_INVOICE, { invoiceId: INVOICE_ID }));

    const overdueInvoice = {
      id: INVOICE_ID,
      tenantId: TENANT_ID,
      subscriptionId: SUB_ID,
    };

    beforeEach(() => {
      prisma.tenantInvoice.findUnique.mockResolvedValue(
        overdueInvoice as never,
      );
    });

    it('does nothing when the invoice has been deleted', async () => {
      prisma.tenantInvoice.findUnique.mockResolvedValue(null as never);
      await run();
      expect($transaction).not.toHaveBeenCalled();
    });

    it('marks the invoice past due, but only while it is still pending', async () => {
      await run();
      expect(tx.tenantInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: INVOICE_ID, status: 'PENDING' },
        data: { status: 'PAST_DUE' },
      });
    });

    it('marks an active subscription past due', async () => {
      await run();
      expect(tx.tenantSubscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: 'ACTIVE' },
        data: { status: 'PAST_DUE' },
      });
    });

    it('suspends the tenant', async () => {
      await run();
      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
        data: { status: 'SUSPENDED' },
      });
    });

    it('revokes the tenant staff sessions that are still live', async () => {
      await run();
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { user: { tenantId: TENANT_ID }, revokedAt: null },
        data: { revokedAt: NOW },
      });
    });

    // The blast radius of this handler: it logs out every customer of every
    // store the tenant owns. The store list must be scoped to that tenant.
    it('scopes the store lookup to the suspended tenant', async () => {
      await run();
      expect(tx.adminStore.findMany).toHaveBeenCalledWith({
        where: { user: { tenantId: TENANT_ID } },
        select: { storeId: true },
      });
    });

    it('revokes customer sessions only for that tenant stores', async () => {
      tx.adminStore.findMany.mockResolvedValue([
        { storeId: 'store-a' },
        { storeId: 'store-b' },
      ]);
      await run();

      expect(tx.storeUserRefreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          storeUser: { storeId: { in: ['store-a', 'store-b'] } },
          revokedAt: null,
        },
        data: { revokedAt: NOW },
      });
    });

    it('revokes no customer sessions when the tenant owns no stores', async () => {
      tx.adminStore.findMany.mockResolvedValue([]);
      await run();

      const { where } = argOf<{
        where: { storeUser: { storeId: { in: string[] } } };
      }>(tx.storeUserRefreshToken.updateMany);
      expect(where.storeUser.storeId.in).toEqual([]);
    });

    describe('when the invoice was already settled', () => {
      beforeEach(() => {
        tx.tenantInvoice.updateMany.mockResolvedValue({ count: 0 });
      });

      it('does not suspend the tenant', async () => {
        await run();
        expect(tx.tenant.update).not.toHaveBeenCalled();
      });

      it('does not revoke any sessions', async () => {
        await run();
        expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(tx.storeUserRefreshToken.updateMany).not.toHaveBeenCalled();
      });

      // KNOWN DEFECT, same shape as trial expiry: the guard returns from the
      // $transaction callback, so the success line still runs.
      it('still logs success (misleading)', async () => {
        await run();
        expect(log).toHaveBeenCalledWith(
          `Processed overdue invoice ${INVOICE_ID}`,
        );
      });
    });
  });
});
