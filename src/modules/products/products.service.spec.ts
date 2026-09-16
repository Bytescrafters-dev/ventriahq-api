import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { TOKENS } from 'src/common/constants/tokens';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { ICategoryRepository } from '../categories/interfaces/category.repository.interface';
import { IStoreRepository } from '../stores/interfaces/store.repository.interface';
import { UploadsService } from '../uploads/uploads.service';
import { CreateProductDto } from './dtos/create-product.dto';
import { CreateVariantsDto } from './dtos/create-variants.dto';
import { UpdateProductDto } from './dtos/update-product.dto';
import { IProductRepository } from './interfaces/product.repository.interface';
import { ProductsService } from './products.service';

const STORE_ID = 'store-1';
const PRODUCT_ID = 'product-1';

/** The Prisma delegates createVariantsBulk touches inside $transaction. */
interface TxStub {
  productVariant: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
  productVariantPrice: { create: jest.Mock; deleteMany: jest.Mock };
  variantInventory: { create: jest.Mock; upsert: jest.Mock };
  productVariantOptionValue: { create: jest.Mock; deleteMany: jest.Mock };
  productOption: { create: jest.Mock };
  productOptionValue: { create: jest.Mock };
}

/** Nth argument of a mock's first call, typed. */
const argOf = <T>(m: jest.Mock, argIndex = 0): T => {
  const calls = m.mock.calls as unknown as T[][];
  return calls[0][argIndex];
};

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: DeepMockProxy<IProductRepository>;
  let storeRepo: DeepMockProxy<IStoreRepository>;
  let categoryRepo: DeepMockProxy<ICategoryRepository>;
  let prisma: DeepMockProxy<PrismaService>;
  let uploads: DeepMockProxy<UploadsService>;
  let tx: TxStub;
  let $transaction: jest.Mock;

  beforeEach(async () => {
    productRepo = mockDeep<IProductRepository>();
    storeRepo = mockDeep<IStoreRepository>();
    categoryRepo = mockDeep<ICategoryRepository>();
    prisma = mockDeep<PrismaService>();
    uploads = mockDeep<UploadsService>();

    tx = {
      productVariant: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { sku: string } }) =>
            Promise.resolve({ id: `variant-${data.sku}`, ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve({ id: where.id }),
          ),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productVariantPrice: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      variantInventory: {
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      productVariantOptionValue: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productOption: {
        create: jest.fn().mockResolvedValue({ id: 'opt-new' }),
      },
      productOptionValue: { create: jest.fn().mockResolvedValue({}) },
    };

    $transaction = prisma.$transaction as unknown as jest.Mock;
    $transaction.mockImplementation((fn: (client: unknown) => unknown) =>
      fn(tx),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: TOKENS.ProductRepo, useValue: productRepo },
        { provide: TOKENS.StoreRepo, useValue: storeRepo },
        { provide: TOKENS.CategoryRepo, useValue: categoryRepo },
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    }).compile();

    service = moduleRef.get(ProductsService);
  });

  describe('createProduct', () => {
    const dto = (overrides: Partial<CreateProductDto> = {}) =>
      ({
        storeId: STORE_ID,
        title: 'Blue Widget',
        ...overrides,
      }) as CreateProductDto;

    beforeEach(() => {
      storeRepo.findById.mockResolvedValue({ id: STORE_ID } as never);
      productRepo.findBySlug.mockResolvedValue(null);
      productRepo.create.mockResolvedValue({ id: PRODUCT_ID } as never);
    });

    const createPayload = () =>
      argOf<Record<string, unknown>>(
        productRepo.create as unknown as jest.Mock,
      );

    it('rejects an unknown store', async () => {
      storeRepo.findById.mockResolvedValue(null);
      await expect(service.createProduct(dto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    describe('category validation', () => {
      it('rejects a category that does not exist', async () => {
        categoryRepo.findById.mockResolvedValue(null);
        await expect(
          service.createProduct(dto({ categoryId: 'cat-1' })),
        ).rejects.toThrow('Category not found.');
      });

      // Cross-store assignment would expose one store's taxonomy to another.
      it('rejects a category owned by another store', async () => {
        categoryRepo.findById.mockResolvedValue({
          id: 'cat-1',
          storeId: 'store-other',
        } as never);
        await expect(
          service.createProduct(dto({ categoryId: 'cat-1' })),
        ).rejects.toThrow('Category must belong to the same store.');
      });

      it('accepts a category from the same store', async () => {
        categoryRepo.findById.mockResolvedValue({
          id: 'cat-1',
          storeId: STORE_ID,
        } as never);
        await service.createProduct(dto({ categoryId: 'cat-1' }));
        expect(createPayload().categoryId).toBe('cat-1');
      });

      it('skips the lookup when no category is given', async () => {
        await service.createProduct(dto());
        expect(categoryRepo.findById).not.toHaveBeenCalled();
        expect(createPayload().categoryId).toBeNull();
      });
    });

    describe('shipping profile validation', () => {
      it('rejects a profile that does not exist', async () => {
        storeRepo.findShippingProfileById.mockResolvedValue(null as never);
        await expect(
          service.createProduct(dto({ profileId: 'prof-1' })),
        ).rejects.toThrow('Shipping profile not found.');
      });

      it('rejects a profile owned by another store', async () => {
        storeRepo.findShippingProfileById.mockResolvedValue({
          id: 'prof-1',
          storeId: 'store-other',
        } as never);
        await expect(
          service.createProduct(dto({ profileId: 'prof-1' })),
        ).rejects.toThrow('Shipping profile must belong to the same store.');
      });

      it('accepts a profile from the same store', async () => {
        storeRepo.findShippingProfileById.mockResolvedValue({
          id: 'prof-1',
          storeId: STORE_ID,
        } as never);
        await service.createProduct(dto({ profileId: 'prof-1' }));
        expect(createPayload().profileId).toBe('prof-1');
      });
    });

    describe('slug generation', () => {
      it.each([
        ['Blue Widget', 'blue-widget'],
        ['  Padded  Title  ', 'padded-title'],
        ["Ada's Widget", 'adas-widget'],
        ['Widget -- Deluxe', 'widget-deluxe'],
        ['---Leading and trailing---', 'leading-and-trailing'],
        ['Sym&*(bols', 'sym-bols'],
        ['MiXeD CaSe', 'mixed-case'],
        ['Widget 2000', 'widget-2000'],
      ])('derives %s into %s', async (title, expected) => {
        await service.createProduct(dto({ title }));
        expect(createPayload().slug).toBe(expected);
      });

      it('prefers an explicit slug over the title', async () => {
        await service.createProduct(
          dto({ title: 'Blue Widget', slug: 'custom-slug' }),
        );
        expect(createPayload().slug).toBe('custom-slug');
      });

      it('normalises an explicit slug too', async () => {
        await service.createProduct(dto({ slug: 'Custom Slug!' }));
        expect(createPayload().slug).toBe('custom-slug');
      });

      it('appends a suffix when the slug is taken', async () => {
        productRepo.findBySlug
          .mockResolvedValueOnce({ id: 'other' } as never)
          .mockResolvedValueOnce(null);

        await service.createProduct(dto());
        expect(createPayload().slug).toBe('blue-widget-2');
      });

      it('keeps incrementing until it finds a free slug', async () => {
        productRepo.findBySlug
          .mockResolvedValueOnce({ id: 'a' } as never)
          .mockResolvedValueOnce({ id: 'b' } as never)
          .mockResolvedValueOnce({ id: 'c' } as never)
          .mockResolvedValueOnce(null);

        await service.createProduct(dto());
        expect(createPayload().slug).toBe('blue-widget-4');
      });

      // Uniqueness is per store, so two stores may both have "blue-widget".
      it('checks slug availability within the target store only', async () => {
        await service.createProduct(dto());
        expect(productRepo.findBySlug).toHaveBeenCalledWith(
          STORE_ID,
          'blue-widget',
        );
      });
    });

    describe('defaults', () => {
      it('creates products active unless told otherwise', async () => {
        await service.createProduct(dto());
        expect(createPayload().active).toBe(true);
      });

      it('honours an explicit inactive flag', async () => {
        await service.createProduct(dto({ active: false }));
        expect(createPayload().active).toBe(false);
      });

      it('nulls a missing description', async () => {
        await service.createProduct(dto());
        expect(createPayload().description).toBeNull();
      });

      it('carries the description through when supplied', async () => {
        await service.createProduct(dto({ description: 'A widget' }));
        expect(createPayload().description).toBe('A widget');
      });
    });
  });

  describe('updateProduct', () => {
    const existing = {
      id: PRODUCT_ID,
      storeId: STORE_ID,
      slug: 'blue-widget',
    };

    const dto = (overrides: Partial<UpdateProductDto> = {}) =>
      overrides as UpdateProductDto;

    beforeEach(() => {
      productRepo.findById.mockResolvedValue(existing as never);
      productRepo.findBySlug.mockResolvedValue(null);
      productRepo.update.mockResolvedValue({ id: PRODUCT_ID } as never);
    });

    const updatePayload = () =>
      argOf<Record<string, unknown>>(
        productRepo.update as unknown as jest.Mock,
        1, // update(id, data) — the payload is the second argument
      );

    it('rejects a product that does not exist', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(
        service.updateProduct(PRODUCT_ID, dto({ title: 'x' })),
      ).rejects.toThrow('Product not found.');
    });

    // Validation is against the product's own store, not a store id in the dto.
    it('rejects a category owned by another store', async () => {
      categoryRepo.findById.mockResolvedValue({
        id: 'cat-1',
        storeId: 'store-other',
      } as never);
      await expect(
        service.updateProduct(PRODUCT_ID, dto({ categoryId: 'cat-1' })),
      ).rejects.toThrow('Category must belong to the same store.');
    });

    it('rejects a shipping profile owned by another store', async () => {
      storeRepo.findShippingProfileById.mockResolvedValue({
        id: 'prof-1',
        storeId: 'store-other',
      } as never);
      await expect(
        service.updateProduct(PRODUCT_ID, dto({ profileId: 'prof-1' })),
      ).rejects.toThrow('Shipping profile must belong to the same store.');
    });

    it('leaves the slug alone when it is unchanged', async () => {
      await service.updateProduct(PRODUCT_ID, dto({ slug: 'blue-widget' }));

      expect(productRepo.findBySlug).not.toHaveBeenCalled();
      expect(updatePayload().slug).toBe('blue-widget');
    });

    it('re-slugs and de-duplicates a changed slug', async () => {
      productRepo.findBySlug
        .mockResolvedValueOnce({ id: 'other' } as never)
        .mockResolvedValueOnce(null);

      await service.updateProduct(PRODUCT_ID, dto({ slug: 'Red Widget' }));

      expect(updatePayload().slug).toBe('red-widget-2');
    });

    it('checks the new slug against the product own store', async () => {
      await service.updateProduct(PRODUCT_ID, dto({ slug: 'red-widget' }));
      expect(productRepo.findBySlug).toHaveBeenCalledWith(
        STORE_ID,
        'red-widget',
      );
    });

    it('leaves the slug undefined when the dto omits it', async () => {
      await service.updateProduct(PRODUCT_ID, dto({ title: 'New title' }));
      expect(updatePayload().slug).toBeUndefined();
    });

    // Undefined fields are forwarded as undefined so the repository can treat
    // them as "not supplied" rather than "set to null".
    it('forwards only what the dto carried', async () => {
      await service.updateProduct(PRODUCT_ID, dto({ title: 'New title' }));

      expect(updatePayload()).toEqual({
        title: 'New title',
        slug: undefined,
        description: undefined,
        active: undefined,
        categoryId: undefined,
        profileId: undefined,
      });
    });
  });

  describe('createVariantsBulk', () => {
    const variant = (overrides: Record<string, any> = {}) => ({
      sku: 'SKU-1',
      barcode: null,
      title: 'Small',
      weightGrams: 100,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
      active: true,
      optionValueIds: [] as string[],
      prices: [{ currency: 'AUD', amount: 2500 }],
      inventory: { lowStockThreshold: 5 },
      ...overrides,
    });

    const dto = (variants: Record<string, any>[]) =>
      ({ variants }) as CreateVariantsDto;

    beforeEach(() => {
      productRepo.findById.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: STORE_ID,
      } as never);
      productRepo.findVariantsBySkus.mockResolvedValue([]);
      productRepo.findOptionsByProductId.mockResolvedValue([]);
      productRepo.findOptionValuesByIds.mockResolvedValue([]);
    });

    /** Gives the product one option with two usable values. */
    const withOptions = () => {
      productRepo.findOptionsByProductId.mockResolvedValue([
        { id: 'opt-1', productId: PRODUCT_ID },
      ] as never);
      productRepo.findOptionValuesByIds.mockResolvedValue([
        { id: 'ov-1', option: { productId: PRODUCT_ID } },
        { id: 'ov-2', option: { productId: PRODUCT_ID } },
      ] as never);
    };

    it('rejects an unknown product', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(
        service.createVariantsBulk(PRODUCT_ID, dto([variant()])),
      ).rejects.toThrow('Product not found');
    });

    describe('SKU validation', () => {
      it('rejects duplicate SKUs inside the batch', async () => {
        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([variant({ sku: 'DUP' }), variant({ sku: 'DUP' })]),
          ),
        ).rejects.toThrow('Duplicate SKUs in batch: DUP');
      });

      it('names every duplicated SKU', async () => {
        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([
              variant({ sku: 'A' }),
              variant({ sku: 'A' }),
              variant({ sku: 'B' }),
              variant({ sku: 'B' }),
            ]),
          ),
        ).rejects.toThrow('Duplicate SKUs in batch: A, B');
      });

      it('rejects SKUs already present in the database', async () => {
        productRepo.findVariantsBySkus.mockResolvedValue([
          { sku: 'SKU-1' },
        ] as never);
        await expect(
          service.createVariantsBulk(PRODUCT_ID, dto([variant()])),
        ).rejects.toThrow('SKUs already exist: SKU-1');
      });

      it('creates nothing when a SKU clashes', async () => {
        productRepo.findVariantsBySkus.mockResolvedValue([
          { sku: 'SKU-1' },
        ] as never);
        await expect(
          service.createVariantsBulk(PRODUCT_ID, dto([variant()])),
        ).rejects.toThrow();
        expect($transaction).not.toHaveBeenCalled();
      });
    });

    describe('a product with no options', () => {
      it('accepts a single variant carrying no option values', async () => {
        const created = await service.createVariantsBulk(
          PRODUCT_ID,
          dto([variant()]),
        );
        expect(created).toHaveLength(1);
      });

      it('refuses more than one variant', async () => {
        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([variant({ sku: 'A' }), variant({ sku: 'B' })]),
          ),
        ).rejects.toThrow(
          'A product with no options can only have one variant',
        );
      });

      it('refuses a variant that carries option values', async () => {
        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([variant({ optionValueIds: ['ov-1'] })]),
          ),
        ).rejects.toThrow(
          'Cannot assign option values to a product that has no options',
        );
      });
    });

    describe('a product with options', () => {
      beforeEach(() => {
        productRepo.findOptionsByProductId.mockResolvedValue([
          { id: 'opt-1', productId: PRODUCT_ID },
        ] as never);
        productRepo.findOptionValuesByIds.mockResolvedValue([
          { id: 'ov-1', option: { productId: PRODUCT_ID } },
          { id: 'ov-2', option: { productId: PRODUCT_ID } },
        ] as never);
      });

      it('requires every variant to carry option values', async () => {
        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([
              variant({ sku: 'A', optionValueIds: ['ov-1'] }),
              variant({ sku: 'B', optionValueIds: [] }),
            ]),
          ),
        ).rejects.toThrow(
          'All variants must have option values for a product with options',
        );
      });

      // Option values belonging to a different product must not be attachable.
      it('rejects option values belonging to another product', async () => {
        productRepo.findOptionValuesByIds.mockResolvedValue([
          { id: 'ov-9', option: { productId: 'other-product' } },
        ] as never);

        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([variant({ optionValueIds: ['ov-9'] })]),
          ),
        ).rejects.toThrow('Invalid option value IDs: ov-9');
      });

      it('rejects option value ids that do not exist at all', async () => {
        productRepo.findOptionValuesByIds.mockResolvedValue([] as never);

        await expect(
          service.createVariantsBulk(
            PRODUCT_ID,
            dto([variant({ optionValueIds: ['ghost'] })]),
          ),
        ).rejects.toThrow('Invalid option value IDs: ghost');
      });

      it('de-duplicates option value ids before looking them up', async () => {
        await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({ sku: 'A', optionValueIds: ['ov-1', 'ov-2'] }),
            variant({ sku: 'B', optionValueIds: ['ov-1'] }),
          ]),
        );

        expect(productRepo.findOptionValuesByIds).toHaveBeenCalledWith([
          'ov-1',
          'ov-2',
        ]);
      });

      it('accepts variants whose option values belong to the product', async () => {
        const created = await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({ sku: 'A', optionValueIds: ['ov-1'] }),
            variant({ sku: 'B', optionValueIds: ['ov-2'] }),
          ]),
        );
        expect(created).toHaveLength(2);
      });
    });

    describe('what gets written', () => {
      it('creates the variant against the product', async () => {
        await service.createVariantsBulk(PRODUCT_ID, dto([variant()]));

        const { data } = argOf<{ data: Record<string, unknown> }>(
          tx.productVariant.create,
        );
        expect(data).toMatchObject({
          productId: PRODUCT_ID,
          sku: 'SKU-1',
          title: 'Small',
          active: true,
        });
      });

      it('creates a price row per supplied price', async () => {
        await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({
              prices: [
                { currency: 'AUD', amount: 2500 },
                { currency: 'NZD', amount: 2700 },
              ],
            }),
          ]),
        );

        expect(tx.productVariantPrice.create).toHaveBeenCalledTimes(2);
      });

      it('defaults validFrom to now when the price omits it', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));
        await service.createVariantsBulk(PRODUCT_ID, dto([variant()]));
        jest.useRealTimers();

        const { data } = argOf<{ data: { validFrom: Date } }>(
          tx.productVariantPrice.create,
        );
        expect(data.validFrom).toEqual(new Date('2026-05-01T00:00:00Z'));
      });

      it('honours an explicit validFrom', async () => {
        const validFrom = new Date('2026-01-01T00:00:00Z');
        await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({ prices: [{ currency: 'AUD', amount: 1, validFrom }] }),
          ]),
        );

        const { data } = argOf<{ data: { validFrom: Date } }>(
          tx.productVariantPrice.create,
        );
        expect(data.validFrom).toBe(validFrom);
      });

      // Stock must start at zero — inventory arrives through movements, never
      // as part of variant creation.
      it('opens inventory at zero with the requested threshold', async () => {
        await service.createVariantsBulk(PRODUCT_ID, dto([variant()]));

        const { data } = argOf<{ data: Record<string, unknown> }>(
          tx.variantInventory.create,
        );
        expect(data).toMatchObject({
          quantity: 0,
          reserved: 0,
          lowStockThreshold: 5,
        });
      });

      it('maps each option value onto the new variant', async () => {
        productRepo.findOptionsByProductId.mockResolvedValue([
          { id: 'opt-1' },
        ] as never);
        productRepo.findOptionValuesByIds.mockResolvedValue([
          { id: 'ov-1', option: { productId: PRODUCT_ID } },
          { id: 'ov-2', option: { productId: PRODUCT_ID } },
        ] as never);

        await service.createVariantsBulk(
          PRODUCT_ID,
          dto([variant({ optionValueIds: ['ov-1', 'ov-2'] })]),
        );

        expect(tx.productVariantOptionValue.create).toHaveBeenCalledTimes(2);
      });

      it('writes every variant in one transaction', async () => {
        withOptions();
        await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({ sku: 'A', optionValueIds: ['ov-1'] }),
            variant({ sku: 'B', optionValueIds: ['ov-2'] }),
          ]),
        );

        expect($transaction).toHaveBeenCalledTimes(1);
        expect(tx.productVariant.create).toHaveBeenCalledTimes(2);
      });

      it('returns the created variants', async () => {
        withOptions();
        const created = await service.createVariantsBulk(
          PRODUCT_ID,
          dto([
            variant({ sku: 'A', optionValueIds: ['ov-1'] }),
            variant({ sku: 'B', optionValueIds: ['ov-2'] }),
          ]),
        );

        expect(created.map((v: { sku: string }) => v.sku)).toEqual(['A', 'B']);
      });
    });
  });

  describe('getBySlug', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');

    const price = (overrides: Record<string, any> = {}) => ({
      currency: 'AUD',
      amount: 2500,
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: null,
      ...overrides,
    });

    const variantRow = (overrides: Record<string, any> = {}) => ({
      id: 'variant-1',
      sku: 'SKU-1',
      prices: [price()],
      inventory: { quantity: 10, reserved: 3 },
      optionValues: [
        { optionValue: { value: 'Red', option: { name: 'Colour' } } },
      ],
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
      storeRepo.findBySlug.mockResolvedValue({
        id: STORE_ID,
        defaultCurrency: 'AUD',
      } as never);
      productRepo.findBySlug.mockResolvedValue({
        id: PRODUCT_ID,
        title: 'Blue Widget',
        description: 'desc',
      } as never);
      productRepo.findImagesByProductId.mockResolvedValue([] as never);
      productRepo.findOptionsByProductIdWithValues.mockResolvedValue(
        [] as never,
      );
      productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
        variantRow(),
      ] as never);
    });

    afterEach(() => jest.useRealTimers());

    const get = (currency?: string) =>
      service.getBySlug('my-store', 'blue-widget', currency);

    it('rejects an unknown store', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(get()).rejects.toThrow('Store not found slug');
    });

    it('rejects an unknown product', async () => {
      productRepo.findBySlug.mockResolvedValue(null);
      await expect(get()).rejects.toThrow('Product not found');
    });

    it('looks the product up within the resolved store', async () => {
      await get();
      expect(productRepo.findBySlug).toHaveBeenCalledWith(
        STORE_ID,
        'blue-widget',
      );
    });

    describe('price resolution', () => {
      it('uses the store default currency when none is requested', async () => {
        const result = await get();
        expect(result.variants[0].price).toBe(2500);
      });

      it('uses the requested currency when given', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({
            prices: [
              price({ currency: 'AUD', amount: 2500 }),
              price({ currency: 'NZD', amount: 2700 }),
            ],
          }),
        ] as never);

        const result = await get('NZD');
        expect(result.variants[0].price).toBe(2700);
      });

      it('returns null when no price exists in that currency', async () => {
        const result = await get('USD');
        expect(result.variants[0].price).toBeNull();
      });

      it('ignores a price whose validity has expired', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({
            prices: [price({ validTo: new Date('2026-05-01T00:00:00Z') })],
          }),
        ] as never);

        const result = await get();
        expect(result.variants[0].price).toBeNull();
      });

      it('keeps a price whose validTo is still in the future', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({
            prices: [price({ validTo: new Date('2026-07-01T00:00:00Z') })],
          }),
        ] as never);

        const result = await get();
        expect(result.variants[0].price).toBe(2500);
      });

      // Scheduled price changes: the most recently started price wins.
      it('picks the latest price that has already started', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({
            prices: [
              price({ amount: 1000, validFrom: new Date('2026-01-01Z') }),
              price({ amount: 3000, validFrom: new Date('2026-06-01Z') }),
              price({ amount: 2000, validFrom: new Date('2026-03-01Z') }),
            ],
          }),
        ] as never);

        const result = await get();
        expect(result.variants[0].price).toBe(3000);
      });
    });

    describe('availability', () => {
      it('reports stock net of reservations', async () => {
        const result = await get();
        expect(result.variants[0].inStock).toBe(7); // 10 - 3
      });

      it('treats a variant with no inventory row as out of stock', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({ inventory: null }),
        ] as never);

        const result = await get();
        expect(result.variants[0].inStock).toBe(0);
      });

      it('can report negative availability when oversold', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({ inventory: { quantity: 2, reserved: 5 } }),
        ] as never);

        const result = await get();
        expect(result.variants[0].inStock).toBe(-3);
      });
    });

    describe('shape', () => {
      it('maps option values by option name', async () => {
        productRepo.findVariantsByProductIdWithRelations.mockResolvedValue([
          variantRow({
            optionValues: [
              { optionValue: { value: 'Red', option: { name: 'Colour' } } },
              { optionValue: { value: 'L', option: { name: 'Size' } } },
            ],
          }),
        ] as never);

        const result = await get();
        expect(result.variants[0].optionValueMap).toEqual({
          Colour: 'Red',
          Size: 'L',
        });
      });

      it('orders option values by position', async () => {
        productRepo.findOptionsByProductIdWithValues.mockResolvedValue([
          {
            id: 'opt-1',
            name: 'Size',
            values: [
              { id: 'v3', value: 'L', position: 3 },
              { id: 'v1', value: 'S', position: 1 },
              { id: 'v2', value: 'M', position: 2 },
            ],
          },
        ] as never);

        const result = await get();
        const options = result.options as { values: { value: string }[] }[];
        expect(options[0].values.map((v) => v.value)).toEqual(['S', 'M', 'L']);
      });

      // The storefront payload must not leak internal fields such as storeId.
      it('returns only the public product fields', async () => {
        const result = await get();
        expect(Object.keys(result).sort()).toEqual([
          'description',
          'id',
          'images',
          'options',
          'title',
          'variants',
        ]);
      });
    });
  });

  describe('option management', () => {
    beforeEach(() => {
      productRepo.findById.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: STORE_ID,
      } as never);
    });

    describe('addOption', () => {
      it('creates the option with its values in order', async () => {
        await service.addOption(PRODUCT_ID, {
          name: 'Size',
          values: ['S', 'M', 'L'],
        } as never);

        expect(tx.productOption.create).toHaveBeenCalledWith({
          data: { productId: PRODUCT_ID, name: 'Size', position: 0 },
        });
        expect(tx.productOptionValue.create).toHaveBeenCalledTimes(3);

        const second = argOf<{ data: { value: string; position: number } }>(
          tx.productOptionValue.create,
          0,
        );
        expect(second.data).toEqual({
          optionId: 'opt-new',
          value: 'S',
          position: 0,
        });
      });

      it('honours an explicit position', async () => {
        await service.addOption(PRODUCT_ID, {
          name: 'Size',
          position: 4,
          values: [],
        } as never);

        const { data } = argOf<{ data: { position: number } }>(
          tx.productOption.create,
        );
        expect(data.position).toBe(4);
      });

      it('tolerates an option with no values', async () => {
        await service.addOption(PRODUCT_ID, { name: 'Size' } as never);
        expect(tx.productOptionValue.create).not.toHaveBeenCalled();
      });
    });

    describe('deleteProductOptionById', () => {
      beforeEach(() => {
        productRepo.findOptionByProductAndId.mockResolvedValue({
          id: 'opt-1',
        } as never);
        productRepo.countVariantsByOptionId.mockResolvedValue(0);
      });

      it('rejects an unknown product', async () => {
        productRepo.findById.mockResolvedValue(null);
        await expect(
          service.deleteProductOptionById(PRODUCT_ID, 'opt-1'),
        ).rejects.toThrow('Product not found');
      });

      it('rejects an option that is not on this product', async () => {
        productRepo.findOptionByProductAndId.mockResolvedValue(null as never);
        await expect(
          service.deleteProductOptionById(PRODUCT_ID, 'opt-1'),
        ).rejects.toThrow('Option not found');
      });

      // Deleting an option in use would orphan the variants built from it.
      it('refuses while variants still use the option', async () => {
        productRepo.countVariantsByOptionId.mockResolvedValue(2);
        await expect(
          service.deleteProductOptionById(PRODUCT_ID, 'opt-1'),
        ).rejects.toThrow(
          'Cannot delete option that is used by existing variants',
        );
        expect(productRepo.deleteOptionById).not.toHaveBeenCalled();
      });

      it('deletes an option no variant uses', async () => {
        await service.deleteProductOptionById(PRODUCT_ID, 'opt-1');
        expect(productRepo.deleteOptionById).toHaveBeenCalledWith('opt-1');
      });
    });
  });

  describe('listing', () => {
    beforeEach(() => {
      storeRepo.findBySlug.mockResolvedValue({ id: STORE_ID } as never);
      productRepo.list.mockResolvedValue([] as never);
      productRepo.count.mockResolvedValue(0);
    });

    it('rejects an unknown store', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(service.getAllProducts('nope', {})).rejects.toThrow(
        'Store not found slug',
      );
    });

    it('defaults to the first page of ten', async () => {
      const result = await service.getAllProducts('my-store', {});

      expect(result).toMatchObject({ page: 1, limit: 10 });
      expect(productRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('translates page and limit into a skip', async () => {
      await service.getAllProducts('my-store', { page: 3, limit: 25 });
      expect(productRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 25 }),
      );
    });

    it('scopes the query to the resolved store', async () => {
      await service.getAllProducts('my-store', {});
      expect(productRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: STORE_ID }),
      );
      expect(productRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: STORE_ID }),
      );
    });

    it('searches on title when given', async () => {
      await service.getAllProducts('my-store', { title: 'widget' });
      expect(productRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'widget' }),
      );
    });

    it('falls back to slug when no title is given', async () => {
      await service.getAllProducts('my-store', { slug: 'blue-widget' });
      expect(productRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'blue-widget' }),
      );
    });

    it('rejects an unknown store when searching', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(service.searchAllProducts('nope', 'x')).rejects.toThrow(
        'Store not found slug',
      );
    });

    it('caps search results at twenty', async () => {
      productRepo.searchProductsAndVariants.mockResolvedValue([] as never);
      await service.searchAllProducts('my-store', 'widget');

      expect(productRepo.searchProductsAndVariants).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: STORE_ID, q: 'widget', take: 20 }),
      );
    });
  });

  describe('updateVariant', () => {
    const VARIANT_ID = 'variant-1';

    beforeEach(() => {
      productRepo.findById.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: STORE_ID,
      } as never);
      productRepo.findVariantById.mockResolvedValue({
        id: VARIANT_ID,
        productId: PRODUCT_ID,
      } as never);
    });

    const update = (dto: Record<string, any>) =>
      service.updateVariant(PRODUCT_ID, VARIANT_ID, dto as never);

    it('rejects an unknown product', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(update({ sku: 'X' })).rejects.toThrow('Product not found');
    });

    it('rejects a variant that does not exist', async () => {
      productRepo.findVariantById.mockResolvedValue(null as never);
      await expect(update({ sku: 'X' })).rejects.toThrow('Variant not found');
    });

    // Prevents editing another product's variant by guessing its id.
    it('rejects a variant belonging to another product', async () => {
      productRepo.findVariantById.mockResolvedValue({
        id: VARIANT_ID,
        productId: 'other-product',
      } as never);
      await expect(update({ sku: 'X' })).rejects.toThrow('Variant not found');
    });

    it('applies only the fields the dto carried', async () => {
      await update({ sku: 'NEW-SKU', active: false });

      const { data } = argOf<{ data: Record<string, unknown> }>(
        tx.productVariant.update,
      );
      expect(data).toEqual({ sku: 'NEW-SKU', active: false });
    });

    it('distinguishes a null from an omitted field', async () => {
      await update({ barcode: null });

      const { data } = argOf<{ data: Record<string, unknown> }>(
        tx.productVariant.update,
      );
      expect(data).toEqual({ barcode: null });
    });

    it('writes nothing extra when the dto is empty', async () => {
      await update({});

      const { data } = argOf<{ data: Record<string, unknown> }>(
        tx.productVariant.update,
      );
      expect(data).toEqual({});
    });

    describe('option values', () => {
      it('replaces the existing set wholesale', async () => {
        await update({ optionValueIds: ['ov-1', 'ov-2'] });

        expect(tx.productVariantOptionValue.deleteMany).toHaveBeenCalledWith({
          where: { variantId: VARIANT_ID },
        });
        expect(tx.productVariantOptionValue.create).toHaveBeenCalledTimes(2);
      });

      it('clears them when given an empty array', async () => {
        await update({ optionValueIds: [] });

        expect(tx.productVariantOptionValue.deleteMany).toHaveBeenCalled();
        expect(tx.productVariantOptionValue.create).not.toHaveBeenCalled();
      });

      it('leaves them untouched when the dto omits them', async () => {
        await update({ sku: 'X' });
        expect(tx.productVariantOptionValue.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe('inventory', () => {
      it('upserts the supplied inventory', async () => {
        await update({ inventory: { lowStockThreshold: 9 } });

        expect(tx.variantInventory.upsert).toHaveBeenCalledWith({
          where: { variantId: VARIANT_ID },
          update: { lowStockThreshold: 9 },
          create: { variantId: VARIANT_ID, lowStockThreshold: 9 },
        });
      });

      it('leaves inventory alone when the dto omits it', async () => {
        await update({ sku: 'X' });
        expect(tx.variantInventory.upsert).not.toHaveBeenCalled();
      });
    });

    describe('prices', () => {
      it('replaces the whole price list', async () => {
        await update({
          prices: [
            { currency: 'AUD', amount: 1000 },
            { currency: 'NZD', amount: 1100 },
          ],
        });

        expect(tx.productVariantPrice.deleteMany).toHaveBeenCalledWith({
          where: { variantId: VARIANT_ID },
        });
        expect(tx.productVariantPrice.create).toHaveBeenCalledTimes(2);
      });

      it('defaults validFrom to now', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));
        await update({ prices: [{ currency: 'AUD', amount: 1000 }] });
        jest.useRealTimers();

        const { data } = argOf<{ data: { validFrom: Date } }>(
          tx.productVariantPrice.create,
        );
        expect(data.validFrom).toEqual(new Date('2026-05-01T00:00:00Z'));
      });

      // Removing every price makes the variant unbuyable — checkout rejects a
      // variant with no active price.
      it('can strip every price', async () => {
        await update({ prices: [] });

        expect(tx.productVariantPrice.deleteMany).toHaveBeenCalled();
        expect(tx.productVariantPrice.create).not.toHaveBeenCalled();
      });

      it('leaves prices alone when the dto omits them', async () => {
        await update({ sku: 'X' });
        expect(tx.productVariantPrice.deleteMany).not.toHaveBeenCalled();
      });
    });

    it('does all of it in one transaction', async () => {
      await update({
        sku: 'X',
        prices: [],
        inventory: { lowStockThreshold: 1 },
      });
      expect($transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteVariant', () => {
    const VARIANT_ID = 'variant-1';

    beforeEach(() => {
      productRepo.findById.mockResolvedValue({ id: PRODUCT_ID } as never);
      productRepo.findVariantById.mockResolvedValue({
        id: VARIANT_ID,
        productId: PRODUCT_ID,
      } as never);
    });

    it('rejects an unknown product', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(
        service.deleteVariant(PRODUCT_ID, VARIANT_ID),
      ).rejects.toThrow('Product not found');
    });

    it('rejects a variant belonging to another product', async () => {
      productRepo.findVariantById.mockResolvedValue({
        id: VARIANT_ID,
        productId: 'other',
      } as never);
      await expect(
        service.deleteVariant(PRODUCT_ID, VARIANT_ID),
      ).rejects.toThrow('Variant not found');
    });

    it('never deletes when ownership fails', async () => {
      productRepo.findVariantById.mockResolvedValue({
        id: VARIANT_ID,
        productId: 'other',
      } as never);
      await expect(
        service.deleteVariant(PRODUCT_ID, VARIANT_ID),
      ).rejects.toThrow();
      expect(productRepo.deleteVariant).not.toHaveBeenCalled();
    });

    it('deletes a variant that belongs to the product', async () => {
      await service.deleteVariant(PRODUCT_ID, VARIANT_ID);
      expect(productRepo.deleteVariant).toHaveBeenCalledWith(VARIANT_ID);
    });
  });

  describe('bulkUpdateVariants', () => {
    beforeEach(() => {
      productRepo.findById.mockResolvedValue({ id: PRODUCT_ID } as never);
    });

    it('rejects an unknown product', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(
        service.bulkUpdateVariants(PRODUCT_ID, [{ sku: 'A' } as never]),
      ).rejects.toThrow('Product not found');
    });

    it('skips entries with no SKU', async () => {
      await service.bulkUpdateVariants(PRODUCT_ID, [{} as never]);
      expect(tx.productVariant.findFirst).not.toHaveBeenCalled();
    });

    // The lookup is scoped by productId, so a SKU from another product is a
    // miss rather than a cross-product write.
    it('looks each SKU up within the product', async () => {
      await service.bulkUpdateVariants(PRODUCT_ID, [{ sku: 'A' } as never]);

      expect(tx.productVariant.findFirst).toHaveBeenCalledWith({
        where: { sku: 'A', productId: PRODUCT_ID },
      });
    });

    it('silently skips a SKU that does not exist on the product', async () => {
      tx.productVariant.findFirst.mockResolvedValue(null);

      const result = await service.bulkUpdateVariants(PRODUCT_ID, [
        { sku: 'ghost' } as never,
      ]);

      expect(tx.productVariant.update).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('updates the variants it matched', async () => {
      tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-a' });

      const result = await service.bulkUpdateVariants(PRODUCT_ID, [
        { sku: 'A', title: 'Small', active: false } as never,
      ]);

      const { where } = argOf<{ where: { id: string } }>(
        tx.productVariant.update,
      );
      expect(where.id).toBe('variant-a');
      expect(result).toHaveLength(1);
    });

    it('processes every entry in one transaction', async () => {
      tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-a' });

      await service.bulkUpdateVariants(PRODUCT_ID, [
        { sku: 'A' } as never,
        { sku: 'B' } as never,
      ]);

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(tx.productVariant.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('images', () => {
    const IMAGE_ID = 'image-1';

    const image = (overrides: Record<string, any> = {}) => ({
      id: IMAGE_ID,
      productId: PRODUCT_ID,
      storageKey: 'products/img-1.jpg',
      isPrimary: false,
      ...overrides,
    });

    beforeEach(() => {
      productRepo.findById.mockResolvedValue({ id: PRODUCT_ID } as never);
      productRepo.findImageById.mockResolvedValue(image() as never);
      productRepo.addImage.mockResolvedValue({ id: IMAGE_ID } as never);
      uploads.deleteFile.mockResolvedValue(undefined as never);
    });

    describe('addProductImage', () => {
      const data = { storageKey: 'k', url: 'https://cdn/x.jpg' };

      it('rejects an unknown product', async () => {
        productRepo.findById.mockResolvedValue(null);
        await expect(service.addProductImage(PRODUCT_ID, data)).rejects.toThrow(
          'Product not found',
        );
      });

      it('stores a ready image with defaults filled in', async () => {
        await service.addProductImage(PRODUCT_ID, data);

        const payload = argOf<Record<string, unknown>>(
          productRepo.addImage as unknown as jest.Mock,
        );
        expect(payload).toMatchObject({
          productId: PRODUCT_ID,
          status: 'READY',
          isPrimary: false,
          sortOrder: 0,
          alt: null,
        });
      });

      // Demoting the current primary before inserting keeps exactly one.
      it('demotes the existing primary when adding a new one', async () => {
        await service.addProductImage(PRODUCT_ID, { ...data, isPrimary: true });
        expect(productRepo.setPrimaryImage).toHaveBeenCalledWith(
          PRODUCT_ID,
          '',
        );
      });

      it('leaves the primary alone for a non-primary image', async () => {
        await service.addProductImage(PRODUCT_ID, data);
        expect(productRepo.setPrimaryImage).not.toHaveBeenCalled();
      });
    });

    describe('createPendingImage', () => {
      it('stores the image as pending with no metadata yet', async () => {
        await service.createPendingImage(PRODUCT_ID, {
          storageKey: 'k',
          url: 'https://cdn/x.jpg',
        });

        const payload = argOf<Record<string, unknown>>(
          productRepo.addImage as unknown as jest.Mock,
        );
        expect(payload).toMatchObject({
          status: 'PENDING',
          width: null,
          height: null,
          mimeType: null,
          bytes: null,
          checksum: null,
        });
      });

      it('rejects an unknown product', async () => {
        productRepo.findById.mockResolvedValue(null);
        await expect(
          service.createPendingImage(PRODUCT_ID, { storageKey: 'k', url: 'u' }),
        ).rejects.toThrow('Product not found');
      });
    });

    describe('deleteProductImage', () => {
      it('rejects an image belonging to another product', async () => {
        productRepo.findImageById.mockResolvedValue(
          image({ productId: 'other' }) as never,
        );
        await expect(
          service.deleteProductImage(PRODUCT_ID, IMAGE_ID),
        ).rejects.toThrow('Image not found');
        expect(productRepo.deleteImage).not.toHaveBeenCalled();
      });

      it('removes the file from storage and the row from the database', async () => {
        await service.deleteProductImage(PRODUCT_ID, IMAGE_ID);

        expect(uploads.deleteFile).toHaveBeenCalledWith('products/img-1.jpg');
        expect(productRepo.deleteImage).toHaveBeenCalledWith(IMAGE_ID);
      });

      // An orphaned S3 object is preferable to an undeletable product image.
      it('still deletes the row when storage deletion fails', async () => {
        uploads.deleteFile.mockRejectedValue(new Error('S3 down') as never);
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(
          service.deleteProductImage(PRODUCT_ID, IMAGE_ID),
        ).resolves.toMatchObject({ success: true });
        expect(productRepo.deleteImage).toHaveBeenCalledWith(IMAGE_ID);
      });

      it('promotes the next image when the primary was deleted', async () => {
        productRepo.findImageById.mockResolvedValue(
          image({ isPrimary: true }) as never,
        );
        productRepo.findNextPrimaryImage.mockResolvedValue({
          id: 'image-2',
        } as never);

        await service.deleteProductImage(PRODUCT_ID, IMAGE_ID);

        expect(productRepo.setPrimaryImage).toHaveBeenCalledWith(
          PRODUCT_ID,
          'image-2',
        );
      });

      it('promotes nothing when no images remain', async () => {
        productRepo.findImageById.mockResolvedValue(
          image({ isPrimary: true }) as never,
        );
        productRepo.findNextPrimaryImage.mockResolvedValue(null);

        await service.deleteProductImage(PRODUCT_ID, IMAGE_ID);
        expect(productRepo.setPrimaryImage).not.toHaveBeenCalled();
      });

      it('does not reshuffle when a non-primary image is deleted', async () => {
        await service.deleteProductImage(PRODUCT_ID, IMAGE_ID);
        expect(productRepo.findNextPrimaryImage).not.toHaveBeenCalled();
      });
    });

    describe('updateProductImage', () => {
      it('rejects an image belonging to another product', async () => {
        productRepo.findImageById.mockResolvedValue(
          image({ productId: 'other' }) as never,
        );
        await expect(
          service.updateProductImage(PRODUCT_ID, IMAGE_ID, {} as never),
        ).rejects.toThrow('Image not found');
      });

      it('applies only the supplied fields', async () => {
        await service.updateProductImage(PRODUCT_ID, IMAGE_ID, {
          alt: 'A widget',
        } as never);

        const payload = argOf<Record<string, unknown>>(
          productRepo.updateImage as unknown as jest.Mock,
          1,
        );
        expect(payload).toEqual({ alt: 'A widget' });
      });

      it('makes the image primary before updating it', async () => {
        await service.updateProductImage(PRODUCT_ID, IMAGE_ID, {
          isPrimary: true,
        } as never);

        expect(productRepo.setPrimaryImage).toHaveBeenCalledWith(
          PRODUCT_ID,
          IMAGE_ID,
        );
      });

      it('does not touch the primary when demoting to false', async () => {
        await service.updateProductImage(PRODUCT_ID, IMAGE_ID, {
          isPrimary: false,
        } as never);

        expect(productRepo.setPrimaryImage).not.toHaveBeenCalled();
      });
    });

    describe('reorderProductImages', () => {
      it('rejects the whole reorder if any image is not on the product', async () => {
        productRepo.findImageById
          .mockResolvedValueOnce(image() as never)
          .mockResolvedValueOnce(image({ productId: 'other' }) as never);

        await expect(
          service.reorderProductImages(PRODUCT_ID, [
            { id: 'image-1', sortOrder: 0 },
            { id: 'image-2', sortOrder: 1 },
          ]),
        ).rejects.toThrow('Image image-2 not found');

        expect(productRepo.updateImageSortOrders).not.toHaveBeenCalled();
      });

      it('applies the new order once every image checks out', async () => {
        const orders = [
          { id: 'image-1', sortOrder: 1 },
          { id: 'image-2', sortOrder: 0 },
        ];
        await service.reorderProductImages(PRODUCT_ID, orders);

        expect(productRepo.updateImageSortOrders).toHaveBeenCalledWith(orders);
      });
    });

    describe('getProductImages', () => {
      it('rejects an unknown product', async () => {
        productRepo.findById.mockResolvedValue(null);
        await expect(service.getProductImages(PRODUCT_ID)).rejects.toThrow(
          'Product not found',
        );
      });

      it('returns the product images', async () => {
        productRepo.findImagesByProductId.mockResolvedValue([image()] as never);
        await expect(
          service.getProductImages(PRODUCT_ID),
        ).resolves.toHaveLength(1);
      });
    });
  });

  describe('deleteProduct', () => {
    beforeEach(() => {
      productRepo.findById.mockResolvedValue({ id: PRODUCT_ID } as never);
      productRepo.findImagesByProductId.mockResolvedValue([] as never);
      uploads.deleteFile.mockResolvedValue(undefined as never);
    });

    it('rejects an unknown product', async () => {
      productRepo.findById.mockResolvedValue(null);
      await expect(service.deleteProduct(PRODUCT_ID)).rejects.toThrow(
        'Product not found',
      );
    });

    it('removes every image from storage before deleting the product', async () => {
      productRepo.findImagesByProductId.mockResolvedValue([
        { storageKey: 'a.jpg' },
        { storageKey: 'b.jpg' },
      ] as never);

      await service.deleteProduct(PRODUCT_ID);

      expect(uploads.deleteFile).toHaveBeenCalledTimes(2);
      expect(productRepo.remove).toHaveBeenCalledWith(PRODUCT_ID);
    });

    // A storage failure must not strand the product row.
    it('deletes the product even when a storage delete fails', async () => {
      productRepo.findImagesByProductId.mockResolvedValue([
        { storageKey: 'a.jpg' },
      ] as never);
      uploads.deleteFile.mockRejectedValue(new Error('S3 down') as never);
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.deleteProduct(PRODUCT_ID)).resolves.toMatchObject({
        message: 'Product deleted successfully',
      });
      expect(productRepo.remove).toHaveBeenCalledWith(PRODUCT_ID);
    });
  });
});
