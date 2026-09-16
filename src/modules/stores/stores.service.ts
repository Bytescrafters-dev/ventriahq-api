import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Store } from '@prisma/client';
import { TOKENS } from 'src/common/constants/tokens';
import { IStoreRepository } from './interfaces/store.repository.interface';
import { IAdminStoreRepository } from './interfaces/admin-store.repository.interface';
import { CreateStoreDto } from './dtos/create-store.dto';
import { UpdateStoreDto } from './dtos/update-store.dto';

@Injectable()
export class StoresService {
  constructor(
    @Inject(TOKENS.StoreRepo)
    private readonly storeRepo: IStoreRepository,
    @Inject(TOKENS.AdminStoreRepo)
    private readonly adminStoreRepo: IAdminStoreRepository,
  ) {}

  async createStore(data: CreateStoreDto, ownerId: string): Promise<Store> {
    const storeData = {
      ...data,
      domain: data.domain ?? null,
      timezone: data.timezone ?? null,
      supportEmail: data.supportEmail ?? null,
      logoUrl: data.logoUrl ?? null,
    };
    return this.storeRepo.createWithOwner(storeData, ownerId);
  }

  /**
   * Resolves a store the caller's tenant owns, or throws.
   *
   * Throws NotFound rather than Forbidden on a store owned by someone else:
   * a Forbidden would confirm the id exists, letting a caller enumerate other
   * tenants' stores. A caller with no tenant owns no stores.
   */
  private async findOwnedStore(
    id: string,
    tenantId: string | null,
  ): Promise<Store> {
    const store = tenantId
      ? await this.storeRepo.findByIdForTenant(id, tenantId)
      : null;
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async getStoreById(id: string, tenantId: string | null): Promise<Store> {
    return this.findOwnedStore(id, tenantId);
  }

  async getStoreBySlug(slug: string): Promise<Store | null> {
    return this.storeRepo.findBySlug(slug);
  }

  async getAllStores(id: string): Promise<Store[]> {
    return this.adminStoreRepo.findStoresByUserId(id);
  }

  async updateStore(
    id: string,
    data: UpdateStoreDto,
    tenantId: string | null,
  ): Promise<Store> {
    await this.findOwnedStore(id, tenantId);
    return this.storeRepo.updateById(id, data);
  }

  async deleteStore(id: string, tenantId: string | null): Promise<void> {
    await this.findOwnedStore(id, tenantId);
    return this.storeRepo.deleteById(id);
  }
}
