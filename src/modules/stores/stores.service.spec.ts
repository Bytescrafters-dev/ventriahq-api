import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { TOKENS } from 'src/common/constants/tokens';
import { IAdminStoreRepository } from './interfaces/admin-store.repository.interface';
import { IStoreRepository } from './interfaces/store.repository.interface';
import { StoresService } from './stores.service';
import { UpdateStoreDto } from './dtos/update-store.dto';

const STORE_ID = 'store-1';
const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

describe('StoresService', () => {
  let service: StoresService;
  let storeRepo: DeepMockProxy<IStoreRepository>;
  let adminStoreRepo: DeepMockProxy<IAdminStoreRepository>;

  beforeEach(async () => {
    storeRepo = mockDeep<IStoreRepository>();
    adminStoreRepo = mockDeep<IAdminStoreRepository>();

    storeRepo.findByIdForTenant.mockResolvedValue({ id: STORE_ID } as never);
    storeRepo.updateById.mockResolvedValue({ id: STORE_ID } as never);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: TOKENS.StoreRepo, useValue: storeRepo },
        { provide: TOKENS.AdminStoreRepo, useValue: adminStoreRepo },
      ],
    }).compile();

    service = moduleRef.get(StoresService);
  });

  describe('tenant scoping', () => {
    // Every id-addressed operation must resolve the store through the
    // tenant-scoped lookup, never the unscoped findById.
    it.each([
      ['getStoreById', () => service.getStoreById(STORE_ID, TENANT_ID)],
      [
        'updateStore',
        () => service.updateStore(STORE_ID, {} as UpdateStoreDto, TENANT_ID),
      ],
      ['deleteStore', () => service.deleteStore(STORE_ID, TENANT_ID)],
    ])('%s resolves the store within the caller tenant', async (_n, call) => {
      await call();

      expect(storeRepo.findByIdForTenant).toHaveBeenCalledWith(
        STORE_ID,
        TENANT_ID,
      );
      expect(storeRepo.findById).not.toHaveBeenCalled();
    });

    it.each([
      ['getStoreById', () => service.getStoreById(STORE_ID, TENANT_ID)],
      [
        'updateStore',
        () => service.updateStore(STORE_ID, {} as UpdateStoreDto, TENANT_ID),
      ],
      ['deleteStore', () => service.deleteStore(STORE_ID, TENANT_ID)],
    ])('%s rejects a store another tenant owns', async (_n, call) => {
      storeRepo.findByIdForTenant.mockResolvedValue(null);
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    });

    // A caller with no tenant owns no stores, and must not fall through to an
    // unscoped lookup.
    it.each([
      ['getStoreById', () => service.getStoreById(STORE_ID, null)],
      [
        'updateStore',
        () => service.updateStore(STORE_ID, {} as UpdateStoreDto, null),
      ],
      ['deleteStore', () => service.deleteStore(STORE_ID, null)],
    ])('%s rejects a caller with no tenant', async (_n, call) => {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(storeRepo.findByIdForTenant).not.toHaveBeenCalled();
      expect(storeRepo.findById).not.toHaveBeenCalled();
    });
  });

  describe('writes are gated on ownership', () => {
    it('does not update a store the tenant does not own', async () => {
      storeRepo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateStore(
          STORE_ID,
          { name: 'x' } as UpdateStoreDto,
          TENANT_ID,
        ),
      ).rejects.toThrow();
      expect(storeRepo.updateById).not.toHaveBeenCalled();
    });

    it('does not delete a store the tenant does not own', async () => {
      storeRepo.findByIdForTenant.mockResolvedValue(null);

      await expect(service.deleteStore(STORE_ID, TENANT_ID)).rejects.toThrow();
      expect(storeRepo.deleteById).not.toHaveBeenCalled();
    });

    it('updates a store the tenant owns', async () => {
      await service.updateStore(
        STORE_ID,
        { name: 'New name' } as UpdateStoreDto,
        TENANT_ID,
      );
      expect(storeRepo.updateById).toHaveBeenCalledWith(STORE_ID, {
        name: 'New name',
      });
    });

    it('deletes a store the tenant owns', async () => {
      await service.deleteStore(STORE_ID, TENANT_ID);
      expect(storeRepo.deleteById).toHaveBeenCalledWith(STORE_ID);
    });
  });

  describe('listing', () => {
    it('lists only the stores linked to the calling admin', async () => {
      adminStoreRepo.findStoresByUserId.mockResolvedValue([] as never);
      await service.getAllStores(USER_ID);

      expect(adminStoreRepo.findStoresByUserId).toHaveBeenCalledWith(USER_ID);
      expect(storeRepo.findAll).not.toHaveBeenCalled();
    });
  });
});
