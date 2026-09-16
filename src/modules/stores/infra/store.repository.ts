import { Injectable } from '@nestjs/common';
import { Store, ShippingProfile } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { IStoreRepository } from '../interfaces/store.repository.interface';

@Injectable()
export class StoreRepository implements IStoreRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Omit<Store, 'id' | 'createdAt' | 'updatedAt'>): Promise<Store> {
    return this.prisma.store.create({ data });
  }

  async createWithOwner(
    data: Omit<Store, 'id' | 'createdAt' | 'updatedAt'>,
    ownerId: string,
  ): Promise<Store> {
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({ data });
      await tx.adminStore.create({
        data: { userId: ownerId, storeId: store.id, role: 'OWNER' },
      });
      return store;
    });
  }

  async findById(id: string): Promise<Store | null> {
    return this.prisma.store.findUnique({ where: { id } });
  }

  async findByIdForTenant(id: string, tenantId: string): Promise<Store | null> {
    return this.prisma.store.findFirst({
      where: { id, adminStores: { some: { user: { tenantId } } } },
    });
  }

  async findBySlug(slug: string): Promise<Store | null> {
    return this.prisma.store.findUnique({ where: { slug } });
  }

  async findAll(): Promise<Store[]> {
    return this.prisma.store.findMany();
  }

  async updateById(id: string, data: Partial<Omit<Store, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Store> {
    return this.prisma.store.update({ where: { id }, data });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.store.delete({ where: { id } });
  }

  async findShippingProfileById(profileId: string): Promise<Pick<ShippingProfile, 'id' | 'storeId'> | null> {
    return this.prisma.shippingProfile.findUnique({
      where: { id: profileId },
      select: { id: true, storeId: true },
    });
  }

  async findByAdminUserId(userId: string): Promise<{ id: string; name: string; slug: string }[]> {
    const rows = await this.prisma.adminStore.findMany({
      where: { userId },
      select: { store: { select: { id: true, name: true, slug: true } } },
    });
    return rows.map((r) => r.store);
  }
}