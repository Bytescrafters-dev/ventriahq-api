import { Injectable } from '@nestjs/common';
import { Prisma, TenantInvoice } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import {
  IInvoiceRepository,
  InvoicesListParams,
  UpdateInvoiceData,
} from '../interfaces/invoice.repository.interface';

const PAID_BY_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const SUBSCRIPTION_SELECT = {
  select: {
    id: true,
    status: true,
    currentPeriodStart: true,
    currentPeriodEnd: true,
    planPrice: {
      select: {
        planName: true,
        billingCycle: true,
        currency: true,
        amount: true,
      },
    },
  },
} as const;

@Injectable()
export class InvoiceRepository implements IInvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(params: InvoicesListParams) {
    const { skip = 0, take = 20 } = params;
    return this.prisma.tenantInvoice.findMany({
      where: this.buildWhere(params),
      include: {
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            phone: true,
            email: true,
          },
        },
        subscription: SUBSCRIPTION_SELECT,
        paidBy: PAID_BY_SELECT,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  count(params: Omit<InvoicesListParams, 'skip' | 'take'>): Promise<number> {
    return this.prisma.tenantInvoice.count({ where: this.buildWhere(params) });
  }

  private buildWhere(params: Omit<InvoicesListParams, 'skip' | 'take'>) {
    const { status, q, createdAtFrom, createdAtTo, dueFrom, dueTo } = params;
    const like = { contains: q, mode: 'insensitive' as const };
    return {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { invoiceNumber: like },
              { notes: like },
              { tenant: { companyName: like } },
              { tenant: { firstName: like } },
              { tenant: { lastName: like } },
              { tenant: { phone: like } },
              { tenant: { email: like } },
            ],
          }
        : {}),
      ...(createdAtFrom || createdAtTo
        ? {
            createdAt: {
              ...(createdAtFrom ? { gte: createdAtFrom } : {}),
              ...(createdAtTo ? { lte: createdAtTo } : {}),
            },
          }
        : {}),
      ...(dueFrom || dueTo
        ? {
            dueDate: {
              ...(dueFrom ? { gte: dueFrom } : {}),
              ...(dueTo ? { lte: dueTo } : {}),
            },
          }
        : {}),
    };
  }

  findAllByTenant(tenantId: string): Promise<any[]> {
    return this.prisma.tenantInvoice.findMany({
      where: { tenantId },
      include: {
        subscription: SUBSCRIPTION_SELECT,
        paidBy: PAID_BY_SELECT,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<any | null> {
    return this.prisma.tenantInvoice.findUnique({
      where: { id },
      include: {
        subscription: SUBSCRIPTION_SELECT,
        paidBy: PAID_BY_SELECT,
      },
    });
  }

  update(
    id: string,
    data: UpdateInvoiceData,
    tx?: Prisma.TransactionClient,
  ): Promise<TenantInvoice> {
    const client = tx ?? this.prisma;
    return client.tenantInvoice.update({ where: { id }, data });
  }
}
