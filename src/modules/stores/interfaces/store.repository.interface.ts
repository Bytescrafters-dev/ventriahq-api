import { Store, ShippingProfile } from '@prisma/client';

export interface IStoreRepository {
  create(data: Omit<Store, 'id' | 'createdAt' | 'updatedAt'>): Promise<Store>;
  createWithOwner(data: Omit<Store, 'id' | 'createdAt' | 'updatedAt'>, ownerId: string): Promise<Store>;
  findById(id: string): Promise<Store | null>;
  /**
   * Resolves a store only if it belongs to the given tenant. A store belongs to
   * a tenant when any of its AdminStore links points at a user in that tenant.
   */
  findByIdForTenant(id: string, tenantId: string): Promise<Store | null>;
  findBySlug(slug: string): Promise<Store | null>;
  findAll(): Promise<Store[]>;
  updateById(id: string, data: Partial<Omit<Store, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Store>;
  deleteById(id: string): Promise<void>;
  findShippingProfileById(profileId: string): Promise<Pick<ShippingProfile, 'id' | 'storeId'> | null>;
  findByAdminUserId(userId: string): Promise<{ id: string; name: string; slug: string }[]>;
}