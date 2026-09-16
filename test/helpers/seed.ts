import { AdminRole, PrismaClient, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

export interface SeededTenant {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  storeId: string;
  storeSlug: string;
  productId: string;
}

/**
 * Creates a self-contained tenant: one admin, one store they own, one product.
 * Two of these give the isolation tests a clean "mine" and "theirs".
 */
export async function seedTenant(
  prisma: PrismaClient,
  key: string,
  role: AdminRole = AdminRole.OWNER,
): Promise<SeededTenant> {
  const password = 'Password123!';
  const email = `admin-${key}@example.com`;

  const tenant = await prisma.tenant.create({
    data: {
      firstName: 'Test',
      lastName: key,
      email: `tenant-${key}@example.com`,
      companyName: `Tenant ${key}`,
      status: TenantStatus.ACTIVE,
    },
  });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 4), // low cost: tests only
      role,
      tenantId: tenant.id,
    },
  });

  const store = await prisma.store.create({
    data: {
      name: `Store ${key}`,
      slug: `store-${key}`,
      defaultCurrency: 'AUD',
    },
  });

  await prisma.adminStore.create({
    data: { userId: user.id, storeId: store.id, role },
  });

  const product = await prisma.product.create({
    data: {
      storeId: store.id,
      title: `Product ${key}`,
      slug: `product-${key}`,
      active: true,
    },
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    email,
    password,
    storeId: store.id,
    storeSlug: store.slug,
    productId: product.id,
  };
}
