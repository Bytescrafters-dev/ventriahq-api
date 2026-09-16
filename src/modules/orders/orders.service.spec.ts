import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { TOKENS } from 'src/common/constants/tokens';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ICartRepository } from './interfaces/cart.repository.interface';
import { IOrderRepository } from './interfaces/order.repository.interface';
import { IProductRepository } from '../products/interfaces/product.repository.interface';
import { IStoreRepository } from '../stores/interfaces/store.repository.interface';
import { OrdersService } from './orders.service';
import { UpdateOrderDto } from './dtos/update-order.dto';
import { StorefrontCheckoutDto } from './dtos/storefront-checkout.dto';
import { AdminCreateOrderDto } from './dtos/admin-create-order.dto';

const ADMIN_ID = 'admin-1';
const ORDER_ID = 'order-1';

/**
 * Shape returned by OrderRepository.findById (typed `any` on the interface, so
 * only the fields updateOrder actually reads are modelled here).
 */
const makeOrder = (overrides: Partial<Record<string, any>> = {}) => ({
  id: ORDER_ID,
  storeId: 'store-1',
  currency: 'AUD',
  status: OrderStatus.PENDING,
  paymentStatus: PaymentStatus.UNPAID,
  shipping: 1000,
  subtotal: 5000,
  total: 6000,
  items: [
    { variantId: 'variant-a', quantity: 2 },
    { variantId: 'variant-b', quantity: 1 },
  ],
  ...overrides,
});

/** Everything a test needs to drive OrdersService against mocked collaborators. */
interface Harness {
  service: OrdersService;
  orderRepo: DeepMockProxy<IOrderRepository>;
  cartRepo: DeepMockProxy<ICartRepository>;
  storeRepo: DeepMockProxy<IStoreRepository>;
  productRepo: DeepMockProxy<IProductRepository>;
  inventory: DeepMockProxy<InventoryService>;
  prisma: DeepMockProxy<PrismaService>;
  /** The transaction client handed to the $transaction callback. */
  tx: Record<string, any>;
  $transaction: jest.Mock;
}

async function createHarness(): Promise<Harness> {
  const orderRepo = mockDeep<IOrderRepository>();
  const cartRepo = mockDeep<ICartRepository>();
  const storeRepo = mockDeep<IStoreRepository>();
  const productRepo = mockDeep<IProductRepository>();
  const inventory = mockDeep<InventoryService>();
  const prisma = mockDeep<PrismaService>();
  const tx = mockDeep<Record<string, any>>();

  // Run the callback inline against a stand-in client, so assertions can
  // check the transaction client was threaded through to the repositories.
  const $transaction = prisma.$transaction as unknown as jest.Mock;
  $transaction.mockImplementation((fn: (client: unknown) => unknown) => fn(tx));

  orderRepo.update.mockResolvedValue({ id: ORDER_ID } as never);
  orderRepo.replaceItems.mockResolvedValue(undefined as never);

  const moduleRef = await Test.createTestingModule({
    providers: [
      OrdersService,
      { provide: TOKENS.OrderRepo, useValue: orderRepo },
      { provide: TOKENS.CartRepo, useValue: cartRepo },
      { provide: TOKENS.StoreRepo, useValue: storeRepo },
      { provide: TOKENS.ProductRepo, useValue: productRepo },
      { provide: InventoryService, useValue: inventory },
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();

  return {
    service: moduleRef.get(OrdersService),
    orderRepo,
    cartRepo,
    storeRepo,
    productRepo,
    inventory,
    prisma,
    tx,
    $transaction,
  };
}

describe('OrdersService.updateOrder', () => {
  let service: OrdersService;
  let orderRepo: DeepMockProxy<IOrderRepository>;
  let productRepo: DeepMockProxy<IProductRepository>;
  let inventory: DeepMockProxy<InventoryService>;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: Record<string, any>;
  let $transaction: jest.Mock;

  beforeEach(async () => {
    ({ service, orderRepo, productRepo, inventory, prisma, tx, $transaction } =
      await createHarness());
  });

  const update = (dto: Partial<UpdateOrderDto>) =>
    service.updateOrder(ORDER_ID, dto as UpdateOrderDto, ADMIN_ID);

  /** Last payload passed to orderRepo.update. */
  const updatePayload = () => orderRepo.update.mock.calls[0][1];

  describe('guard clauses', () => {
    it('rejects an order that does not exist', async () => {
      orderRepo.findById.mockResolvedValue(null);
      await expect(update({ note: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([OrderStatus.DELIVERED, OrderStatus.CANCELED])(
      'refuses to update a %s order',
      async (status) => {
        orderRepo.findById.mockResolvedValue(makeOrder({ status }));
        await expect(update({ note: 'x' })).rejects.toThrow(
          `Cannot update a ${status.toLowerCase()} order`,
        );
      },
    );

    it('does not open a transaction when the guard rejects', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ status: OrderStatus.DELIVERED }),
      );
      await expect(update({ note: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('payment status rules', () => {
    it('refuses REFUNDED as a manual assignment', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await expect(
        update({ paymentStatus: PaymentStatus.REFUNDED }),
      ).rejects.toThrow('cannot be assigned manually');
    });

    it.each([PaymentStatus.UNPAID, PaymentStatus.COD])(
      'refuses %s on an order that has left PENDING',
      async (paymentStatus) => {
        orderRepo.findById.mockResolvedValue(
          makeOrder({
            status: OrderStatus.CONFIRMED,
            paymentStatus: PaymentStatus.PAID,
          }),
        );
        await expect(update({ paymentStatus })).rejects.toThrow(
          `Cannot set payment status to ${paymentStatus} on a confirmed order`,
        );
      },
    );

    it('allows UNPAID while the order is still PENDING', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.COD }),
      );
      await update({ paymentStatus: PaymentStatus.UNPAID });
      expect(updatePayload().paymentStatus).toBe(PaymentStatus.UNPAID);
    });

    it('ignores a payment status identical to the stored one', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.COD,
        }),
      );
      // COD would be rejected on a CONFIRMED order if it were treated as a change.
      await update({ paymentStatus: PaymentStatus.COD });
      expect(updatePayload()).not.toHaveProperty('paymentStatus');
    });
  });

  describe('status transition matrix', () => {
    const allowed: [OrderStatus, OrderStatus][] = [
      [OrderStatus.PENDING, OrderStatus.CONFIRMED],
      [OrderStatus.PENDING, OrderStatus.CANCELED],
      [OrderStatus.CONFIRMED, OrderStatus.SHIPPED],
      [OrderStatus.CONFIRMED, OrderStatus.CANCELED],
      [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
    ];

    const rejected: [OrderStatus, OrderStatus][] = [
      [OrderStatus.PENDING, OrderStatus.SHIPPED],
      [OrderStatus.PENDING, OrderStatus.DELIVERED],
      [OrderStatus.CONFIRMED, OrderStatus.PENDING],
      [OrderStatus.CONFIRMED, OrderStatus.DELIVERED],
      [OrderStatus.SHIPPED, OrderStatus.PENDING],
      [OrderStatus.SHIPPED, OrderStatus.CONFIRMED],
      [OrderStatus.SHIPPED, OrderStatus.CANCELED],
    ];

    it.each(allowed)('allows %s -> %s', async (from, to) => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ status: from, paymentStatus: PaymentStatus.PAID }),
      );
      await update({ status: to });
      expect(updatePayload().status).toBe(to);
    });

    it.each(rejected)('rejects %s -> %s', async (from, to) => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ status: from, paymentStatus: PaymentStatus.PAID }),
      );
      await expect(update({ status: to })).rejects.toThrow(
        `Cannot transition order from ${from} to ${to}`,
      );
    });

    it('treats a status equal to the current one as a no-op', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ status: OrderStatus.CONFIRMED }),
      );
      await update({ status: OrderStatus.CONFIRMED });
      expect(updatePayload()).not.toHaveProperty('status');
      expect(inventory.reserve).not.toHaveBeenCalled();
    });
  });

  describe('transition to CONFIRMED', () => {
    it.each([PaymentStatus.UNPAID, PaymentStatus.REFUNDED])(
      'refuses to confirm while payment is %s',
      async (paymentStatus) => {
        orderRepo.findById.mockResolvedValue(makeOrder({ paymentStatus }));
        await expect(update({ status: OrderStatus.CONFIRMED })).rejects.toThrow(
          'Order can only be confirmed when payment status is PAID or COD',
        );
      },
    );

    it.each([PaymentStatus.PAID, PaymentStatus.COD])(
      'confirms when payment is already %s',
      async (paymentStatus) => {
        orderRepo.findById.mockResolvedValue(makeOrder({ paymentStatus }));
        await update({ status: OrderStatus.CONFIRMED });
        expect(updatePayload().status).toBe(OrderStatus.CONFIRMED);
      },
    );

    // The incoming payment status is applied before the transition is checked,
    // so paying and confirming in a single request must succeed.
    it('confirms when payment is set to PAID in the same request', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.UNPAID }),
      );
      await update({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
      expect(updatePayload()).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
    });

    it('reserves stock for every line, inside the transaction', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      await update({ status: OrderStatus.CONFIRMED });

      expect(inventory.reserve).toHaveBeenCalledTimes(2);
      expect(inventory.reserve).toHaveBeenNthCalledWith(
        1,
        'variant-a',
        2,
        ORDER_ID,
        ADMIN_ID,
        tx,
      );
      expect(inventory.reserve).toHaveBeenNthCalledWith(
        2,
        'variant-b',
        1,
        ORDER_ID,
        ADMIN_ID,
        tx,
      );
    });

    it('records the confirming admin', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      await update({ status: OrderStatus.CONFIRMED });
      expect(updatePayload().confirmedById).toBe(ADMIN_ID);
    });

    it('does not reserve stock when confirmation is refused', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.UNPAID }),
      );
      await expect(update({ status: OrderStatus.CONFIRMED })).rejects.toThrow();
      expect(inventory.reserve).not.toHaveBeenCalled();
      expect(orderRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('transition to SHIPPED', () => {
    const confirmed = () =>
      makeOrder({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });

    it('sells every line, inside the transaction', async () => {
      orderRepo.findById.mockResolvedValue(confirmed());
      await update({ status: OrderStatus.SHIPPED });

      expect(inventory.sell).toHaveBeenCalledTimes(2);
      expect(inventory.sell).toHaveBeenNthCalledWith(
        1,
        'variant-a',
        2,
        ORDER_ID,
        ADMIN_ID,
        tx,
      );
    });

    it('does not reserve again when shipping', async () => {
      orderRepo.findById.mockResolvedValue(confirmed());
      await update({ status: OrderStatus.SHIPPED });
      expect(inventory.reserve).not.toHaveBeenCalled();
    });
  });

  describe('transition to DELIVERED', () => {
    const shipped = (paymentStatus: PaymentStatus) =>
      makeOrder({ status: OrderStatus.SHIPPED, paymentStatus });

    it('settles a COD order as PAID on delivery', async () => {
      orderRepo.findById.mockResolvedValue(shipped(PaymentStatus.COD));
      await update({ status: OrderStatus.DELIVERED });
      expect(updatePayload()).toMatchObject({
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
      });
    });

    it('leaves an already PAID order untouched', async () => {
      orderRepo.findById.mockResolvedValue(shipped(PaymentStatus.PAID));
      await update({ status: OrderStatus.DELIVERED });
      expect(updatePayload()).not.toHaveProperty('paymentStatus');
    });

    it('moves no stock on delivery', async () => {
      orderRepo.findById.mockResolvedValue(shipped(PaymentStatus.PAID));
      await update({ status: OrderStatus.DELIVERED });
      expect(inventory.reserve).not.toHaveBeenCalled();
      expect(inventory.sell).not.toHaveBeenCalled();
      expect(inventory.unreserve).not.toHaveBeenCalled();
    });
  });

  describe('transition to CANCELED', () => {
    it('releases reserved stock when canceling a CONFIRMED order', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.COD,
        }),
      );
      await update({ status: OrderStatus.CANCELED });

      expect(inventory.unreserve).toHaveBeenCalledTimes(2);
      expect(inventory.unreserve).toHaveBeenNthCalledWith(
        1,
        'variant-a',
        2,
        ORDER_ID,
        ADMIN_ID,
        tx,
      );
    });

    // Nothing was reserved while the order sat in PENDING, so releasing here
    // would credit stock that was never taken.
    it('releases nothing when canceling a PENDING order', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ status: OrderStatus.PENDING }),
      );
      await update({ status: OrderStatus.CANCELED });
      expect(inventory.unreserve).not.toHaveBeenCalled();
    });

    it('marks a paid order REFUNDED', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      await update({ status: OrderStatus.CANCELED });
      expect(updatePayload()).toMatchObject({
        status: OrderStatus.CANCELED,
        paymentStatus: PaymentStatus.REFUNDED,
      });
    });

    it('does not refund an unpaid order', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.UNPAID }),
      );
      await update({ status: OrderStatus.CANCELED });
      expect(updatePayload()).not.toHaveProperty('paymentStatus');
    });
  });

  describe('replacing line items', () => {
    /** Stubs the lookups buildVariantOrderItems performs per incoming item. */
    const stubVariant = (variantId: string, unitPrice: number) => {
      (
        prisma.productVariant.findFirst as unknown as jest.Mock
      ).mockResolvedValue({
        id: variantId,
        sku: `SKU-${variantId}`,
        product: { id: 'product-1', title: 'Widget' },
        optionValues: [
          { optionValue: { value: 'Red', option: { name: 'Colour' } } },
        ],
      });
      productRepo.resolveActivePriceForProductVariant.mockResolvedValue({
        amount: unitPrice,
      } as never);
    };

    it('refuses to replace items once the order has left PENDING', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        }),
      );
      await expect(
        update({ items: [{ variantId: 'variant-c', quantity: 1 }] }),
      ).rejects.toThrow('Items can only be updated on Pending orders');
      expect(orderRepo.replaceItems).not.toHaveBeenCalled();
    });

    it('recalculates the subtotal from server-side prices', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      stubVariant('variant-c', 2500);

      await update({ items: [{ variantId: 'variant-c', quantity: 3 }] });

      expect(updatePayload().subtotal).toBe(7500);
    });

    it('carries the existing shipping cost into the new total', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder({ shipping: 1000 }));
      stubVariant('variant-c', 2500);

      await update({ items: [{ variantId: 'variant-c', quantity: 3 }] });

      expect(updatePayload().total).toBe(8500); // 7500 subtotal + 1000 shipping
    });

    // A client-supplied price must never reach the order.
    it('ignores any price sent by the client', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      stubVariant('variant-c', 2500);

      await update({
        items: [{ variantId: 'variant-c', quantity: 1, unitPrice: 1 } as never],
      });

      expect(updatePayload().subtotal).toBe(2500);
    });

    it('rejects a variant that belongs to another store', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      (
        prisma.productVariant.findFirst as unknown as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        update({ items: [{ variantId: 'variant-x', quantity: 1 }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes the variant lookup to the order store', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder({ storeId: 'store-1' }));
      stubVariant('variant-c', 2500);

      await update({ items: [{ variantId: 'variant-c', quantity: 1 }] });

      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'variant-c', product: { storeId: 'store-1' } },
        }),
      );
    });

    it('rejects a variant with no active price', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      stubVariant('variant-c', 2500);
      productRepo.resolveActivePriceForProductVariant.mockResolvedValue(
        null as never,
      );

      await expect(
        update({ items: [{ variantId: 'variant-c', quantity: 1 }] }),
      ).rejects.toThrow('No active price for variant variant-c');
    });

    it('reserves the replacement items, not the ones being replaced', async () => {
      orderRepo.findById.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      stubVariant('variant-c', 2500);

      await update({
        items: [{ variantId: 'variant-c', quantity: 4 }],
        status: OrderStatus.CONFIRMED,
      });

      expect(inventory.reserve).toHaveBeenCalledTimes(1);
      expect(inventory.reserve).toHaveBeenCalledWith(
        'variant-c',
        4,
        ORDER_ID,
        ADMIN_ID,
        tx,
      );
    });

    it('leaves items alone when the dto sends an empty array', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await update({ items: [] });
      expect(orderRepo.replaceItems).not.toHaveBeenCalled();
      expect(updatePayload()).not.toHaveProperty('subtotal');
    });
  });

  describe('scalar fields', () => {
    it('applies every provided scalar', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await update({
        customerName: 'Ada',
        customerPhone: '0400000000',
        note: 'leave at door',
        shippingAddress1: '1 Test St',
        shippingCity: 'Melbourne',
        shippingPostalCode: '3000',
        shippingCountry: 'AU',
      });

      expect(updatePayload()).toMatchObject({
        customerName: 'Ada',
        customerPhone: '0400000000',
        note: 'leave at door',
        shippingAddress1: '1 Test St',
        shippingCity: 'Melbourne',
        shippingPostalCode: '3000',
        shippingCountry: 'AU',
      });
    });

    it('omits fields the dto did not mention', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await update({ note: 'only this' });

      expect(updatePayload()).toEqual({ note: 'only this' });
    });

    // `undefined` means "not supplied"; null is a deliberate clear.
    it('clears a field explicitly set to null', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await update({ note: null as never });

      expect(updatePayload()).toEqual({ note: null });
    });
  });

  describe('transaction handling', () => {
    it('performs the update inside a single transaction', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      await update({ note: 'x' });

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(orderRepo.update).toHaveBeenCalledWith(
        ORDER_ID,
        expect.anything(),
        tx,
      );
    });

    it('propagates a repository failure to the caller', async () => {
      orderRepo.findById.mockResolvedValue(makeOrder());
      orderRepo.update.mockRejectedValue(new Error('db down') as never);

      await expect(update({ note: 'x' })).rejects.toThrow('db down');
    });
  });
});

describe('OrdersService.checkout', () => {
  const STORE_ID = 'store-1';
  const STORE_SLUG = 'my-store';
  const CART_ID = 'cart-1';
  const STORE_USER_ID = 'store-user-1';

  let service: OrdersService;
  let orderRepo: DeepMockProxy<IOrderRepository>;
  let cartRepo: DeepMockProxy<ICartRepository>;
  let storeRepo: DeepMockProxy<IStoreRepository>;
  let productRepo: DeepMockProxy<IProductRepository>;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: Record<string, any>;
  let $transaction: jest.Mock;
  /** Cart teardown stubs on the transaction client, kept typed for assertions. */
  let deleteCartItems: jest.Mock;
  let deleteCart: jest.Mock;

  const makeStore = (overrides: Record<string, any> = {}) => ({
    id: STORE_ID,
    slug: STORE_SLUG,
    defaultCurrency: 'AUD',
    ...overrides,
  });

  /**
   * CartItem persists its own unitPrice, so every fixture carries a stale one.
   * Checkout must ignore it and re-resolve the price server-side — a cart row
   * is the last price the customer saw, not an authority on what to charge.
   */
  const STALE_CART_PRICE = 1;

  const makeCartItem = (overrides: Record<string, any> = {}) => ({
    productId: 'product-a',
    variantId: 'variant-a',
    quantity: 2,
    unitPrice: STALE_CART_PRICE,
    product: { title: 'Widget' },
    variant: {
      sku: 'SKU-A',
      optionValues: [
        { optionValue: { value: 'Red', option: { name: 'Colour' } } },
        { optionValue: { value: 'L', option: { name: 'Size' } } },
      ],
    },
    ...overrides,
  });

  const makeCart = (overrides: Record<string, any> = {}) => ({
    id: CART_ID,
    storeId: STORE_ID,
    items: [makeCartItem()],
    ...overrides,
  });

  /** Prices keyed by variant, so a test can price each line differently. */
  const priceVariants = (prices: Record<string, number>) => {
    productRepo.resolveActivePriceForProductVariant.mockImplementation(((
      variantId: string,
    ) =>
      Promise.resolve(
        prices[variantId] === undefined ? null : { amount: prices[variantId] },
      )) as never);
  };

  beforeEach(async () => {
    ({
      service,
      orderRepo,
      cartRepo,
      storeRepo,
      productRepo,
      prisma,
      tx,
      $transaction,
    } = await createHarness());

    storeRepo.findBySlug.mockResolvedValue(makeStore() as never);
    cartRepo.findById.mockResolvedValue(makeCart() as never);
    priceVariants({ 'variant-a': 2500 });
    orderRepo.generateOrderNumber.mockResolvedValue('ORD-0001');
    orderRepo.create.mockResolvedValue({ id: 'order-new' } as never);
    deleteCartItems = jest.fn().mockResolvedValue({ count: 1 });
    deleteCart = jest.fn().mockResolvedValue({});
    tx.cartItem = { deleteMany: deleteCartItems };
    tx.cart = { delete: deleteCart };
  });

  const checkout = (
    dto: Partial<StorefrontCheckoutDto> = {},
    storeUserId?: string,
  ) =>
    service.checkout(
      {
        cartId: CART_ID,
        paymentStatus: 'UNPAID',
        ...dto,
      } as StorefrontCheckoutDto,
      STORE_SLUG,
      storeUserId,
    );

  /** Payload passed to orderRepo.create. */
  const createPayload = () => orderRepo.create.mock.calls[0][0];
  const createdItems = () => orderRepo.create.mock.calls[0][1];

  describe('store and cart guards', () => {
    it('rejects an unknown store slug', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(checkout()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a cart that does not exist', async () => {
      cartRepo.findById.mockResolvedValue(null);
      await expect(checkout()).rejects.toThrow('Cart is empty');
    });

    it('rejects a cart with no items', async () => {
      cartRepo.findById.mockResolvedValue(makeCart({ items: [] }) as never);
      await expect(checkout()).rejects.toThrow('Cart is empty');
    });

    // Without this check a customer could check out another store's cart.
    it('rejects a cart belonging to a different store', async () => {
      cartRepo.findById.mockResolvedValue(
        makeCart({ storeId: 'store-other' }) as never,
      );
      await expect(checkout()).rejects.toThrow(
        'Cart does not belong to this store',
      );
    });

    it('creates no order when a guard rejects', async () => {
      cartRepo.findById.mockResolvedValue(null);
      await expect(checkout()).rejects.toThrow();
      expect($transaction).not.toHaveBeenCalled();
      expect(orderRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('pricing', () => {
    it('prices each line from the backend, not the stale cart price', async () => {
      await checkout();
      expect(createdItems()[0].unitPrice).toBe(2500);
      expect(createdItems()[0].unitPrice).not.toBe(STALE_CART_PRICE);
    });

    it('ignores the stale cart price when computing the subtotal', async () => {
      await checkout();
      // 2 x 2500 from the price list, not 2 x STALE_CART_PRICE.
      expect(createPayload().subtotal).toBe(5000);
    });

    it('resolves prices in the store default currency', async () => {
      storeRepo.findBySlug.mockResolvedValue(
        makeStore({ defaultCurrency: 'NZD' }) as never,
      );
      await checkout();
      expect(
        productRepo.resolveActivePriceForProductVariant,
      ).toHaveBeenCalledWith('variant-a', 'NZD');
    });

    it('sums the subtotal across lines and quantities', async () => {
      cartRepo.findById.mockResolvedValue(
        makeCart({
          items: [
            makeCartItem({ variantId: 'variant-a', quantity: 2 }),
            makeCartItem({ variantId: 'variant-b', quantity: 3 }),
          ],
        }) as never,
      );
      priceVariants({ 'variant-a': 2500, 'variant-b': 1000 });

      await checkout();

      expect(createPayload().subtotal).toBe(8000); // 2*2500 + 3*1000
    });

    it('rejects a variant with no active price', async () => {
      priceVariants({});
      await expect(checkout()).rejects.toThrow(
        'No active price for variant variant-a',
      );
    });

    it('records the order currency from the store', async () => {
      storeRepo.findBySlug.mockResolvedValue(
        makeStore({ defaultCurrency: 'NZD' }) as never,
      );
      await checkout();
      expect(createPayload().currency).toBe('NZD');
    });

    it('opens the order with no discount or tax', async () => {
      await checkout();
      expect(createPayload()).toMatchObject({ discount: 0, tax: 0 });
    });
  });

  describe('shipping cost', () => {
    it('charges nothing when no shipping option is chosen', async () => {
      await checkout();
      expect(createPayload().shipping).toBe(0);
      expect(createPayload().total).toBe(5000);
    });

    it('adds the shipping option amount to the total', async () => {
      (
        prisma.shippingOption.findUnique as unknown as jest.Mock
      ).mockResolvedValue({ amount: 1500 });

      await checkout({ shippingOptionId: 'ship-1' });

      expect(createPayload()).toMatchObject({
        shipping: 1500,
        subtotal: 5000,
        total: 6500,
      });
    });

    it('rejects an unknown shipping option', async () => {
      (
        prisma.shippingOption.findUnique as unknown as jest.Mock
      ).mockResolvedValue(null);

      await expect(checkout({ shippingOptionId: 'nope' })).rejects.toThrow(
        'Invalid shipping option',
      );
    });
  });

  describe('shipping address', () => {
    const savedAddress = {
      address1: '1 Saved St',
      address2: null,
      city: 'Perth',
      state: 'WA',
      postalCode: '6000',
      country: 'AU',
    };

    it('uses the inline fields when no saved address is referenced', async () => {
      await checkout({
        shippingAddress1: '2 Inline Rd',
        shippingCity: 'Sydney',
        shippingPostalCode: '2000',
        shippingCountry: 'AU',
      });

      expect(createPayload()).toMatchObject({
        shippingAddress1: '2 Inline Rd',
        shippingCity: 'Sydney',
        shippingPostalCode: '2000',
        shippingCountry: 'AU',
      });
    });

    it('nulls inline fields that were not supplied', async () => {
      await checkout({ shippingAddress1: '2 Inline Rd' });
      expect(createPayload()).toMatchObject({
        shippingAddress2: null,
        shippingState: null,
      });
    });

    it('prefers a saved address over inline fields', async () => {
      (prisma.address.findUnique as unknown as jest.Mock).mockResolvedValue(
        savedAddress,
      );

      await checkout({
        shippingAddressId: 'addr-1',
        shippingAddress1: '2 Inline Rd',
        shippingCity: 'Sydney',
      });

      expect(createPayload()).toMatchObject({
        shippingAddress1: '1 Saved St',
        shippingCity: 'Perth',
        shippingState: 'WA',
      });
    });

    it('rejects a saved address that does not exist', async () => {
      (prisma.address.findUnique as unknown as jest.Mock).mockResolvedValue(
        null,
      );
      await expect(
        checkout({ shippingAddressId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('order creation', () => {
    it('always opens the order as PENDING', async () => {
      await checkout({ paymentStatus: 'COD' });
      expect(createPayload().status).toBe(OrderStatus.PENDING);
    });

    it('carries the requested payment status', async () => {
      await checkout({ paymentStatus: 'COD' });
      expect(createPayload().paymentStatus).toBe('COD');
    });

    it('attributes the order to a signed-in customer', async () => {
      await checkout({}, STORE_USER_ID);
      expect(createPayload().storeUserId).toBe(STORE_USER_ID);
    });

    it('leaves the customer null for a guest checkout', async () => {
      await checkout();
      expect(createPayload().storeUserId).toBeNull();
    });

    it('takes the order number from the store sequence, inside the transaction', async () => {
      await checkout();
      expect(orderRepo.generateOrderNumber).toHaveBeenCalledWith(STORE_ID, tx);
      expect(createPayload().orderNumber).toBe('ORD-0001');
    });

    it('describes the variant from its option values', async () => {
      await checkout();
      expect(createdItems()[0]).toMatchObject({
        sku: 'SKU-A',
        productTitle: 'Widget',
        variantTitle: 'Colour: Red / Size: L',
        quantity: 2,
      });
    });

    it('leaves the variant title unset when the variant has no options', async () => {
      cartRepo.findById.mockResolvedValue(
        makeCart({
          items: [
            makeCartItem({ variant: { sku: 'SKU-A', optionValues: [] } }),
          ],
        }) as never,
      );
      await checkout();
      expect(createdItems()[0].variantTitle).toBeUndefined();
    });
  });

  describe('cart teardown', () => {
    it('clears the cart in the same transaction that creates the order', async () => {
      await checkout();

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        tx,
      );
      expect(deleteCartItems).toHaveBeenCalledWith({
        where: { cartId: CART_ID },
      });
      expect(deleteCart).toHaveBeenCalledWith({ where: { id: CART_ID } });
    });

    it('leaves the cart intact when order creation fails', async () => {
      orderRepo.create.mockRejectedValue(new Error('insert failed') as never);

      await expect(checkout()).rejects.toThrow('insert failed');
      expect(deleteCartItems).not.toHaveBeenCalled();
      expect(deleteCart).not.toHaveBeenCalled();
    });
  });
});

describe('OrdersService.adminCreateOrder', () => {
  const STORE_ID = 'store-1';
  const NEW_ORDER_ID = 'order-new';

  let service: OrdersService;
  let orderRepo: DeepMockProxy<IOrderRepository>;
  let storeRepo: DeepMockProxy<IStoreRepository>;
  let productRepo: DeepMockProxy<IProductRepository>;
  let inventory: DeepMockProxy<InventoryService>;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: Record<string, any>;
  let $transaction: jest.Mock;

  const makeVariant = (
    variantId: string,
    overrides: Record<string, any> = {},
  ) => ({
    id: variantId,
    sku: `SKU-${variantId}`,
    product: { id: `product-${variantId}`, title: `Title ${variantId}` },
    optionValues: [
      { optionValue: { value: 'Red', option: { name: 'Colour' } } },
    ],
    ...overrides,
  });

  /** Resolves productVariant.findFirst against a variantId -> variant map. */
  const stubVariants = (variants: Record<string, unknown>) => {
    (
      prisma.productVariant.findFirst as unknown as jest.Mock
    ).mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(variants[args.where.id] ?? null),
    );
  };

  const priceVariants = (prices: Record<string, number>) => {
    productRepo.resolveActivePriceForProductVariant.mockImplementation(((
      variantId: string,
    ) =>
      Promise.resolve(
        prices[variantId] === undefined ? null : { amount: prices[variantId] },
      )) as never);
  };

  beforeEach(async () => {
    ({
      service,
      orderRepo,
      storeRepo,
      productRepo,
      inventory,
      prisma,
      tx,
      $transaction,
    } = await createHarness());

    storeRepo.findById.mockResolvedValue({
      id: STORE_ID,
      defaultCurrency: 'AUD',
    } as never);
    stubVariants({ 'variant-a': makeVariant('variant-a') });
    priceVariants({ 'variant-a': 2500 });
    orderRepo.generateOrderNumber.mockResolvedValue('ORD-0007');
    orderRepo.create.mockResolvedValue({ id: NEW_ORDER_ID } as never);
    inventory.reserve.mockResolvedValue(undefined as never);
  });

  const create = (dto: Partial<AdminCreateOrderDto> = {}) =>
    service.adminCreateOrder(
      {
        paymentStatus: PaymentStatus.UNPAID,
        items: [{ variantId: 'variant-a', quantity: 2 }],
        ...dto,
      } as AdminCreateOrderDto,
      STORE_ID,
      ADMIN_ID,
    );

  const createPayload = () => orderRepo.create.mock.calls[0][0];
  const createdItems = () => orderRepo.create.mock.calls[0][1];

  describe('store guard', () => {
    it('rejects an unknown store', async () => {
      storeRepo.findById.mockResolvedValue(null);
      await expect(create()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates nothing when the store is unknown', async () => {
      storeRepo.findById.mockResolvedValue(null);
      await expect(create()).rejects.toThrow();
      expect($transaction).not.toHaveBeenCalled();
      expect(orderRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('line items', () => {
    // An admin of one tenant must not be able to add another store's variant.
    it('scopes the variant lookup to the target store', async () => {
      await create();
      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'variant-a', product: { storeId: STORE_ID } },
        }),
      );
    });

    it('rejects a variant that belongs to another store', async () => {
      stubVariants({});
      await expect(create()).rejects.toThrow(
        'Variant variant-a not found in this store',
      );
    });

    it('rejects a variant with no active price', async () => {
      priceVariants({});
      await expect(create()).rejects.toThrow(
        'No active price for variant variant-a',
      );
    });

    it('prices lines from the price list in the store currency', async () => {
      await create();
      expect(
        productRepo.resolveActivePriceForProductVariant,
      ).toHaveBeenCalledWith('variant-a', 'AUD');
      expect(createdItems()[0].unitPrice).toBe(2500);
    });

    it('sums the subtotal across lines and quantities', async () => {
      stubVariants({
        'variant-a': makeVariant('variant-a'),
        'variant-b': makeVariant('variant-b'),
      });
      priceVariants({ 'variant-a': 2500, 'variant-b': 1000 });

      await create({
        items: [
          { variantId: 'variant-a', quantity: 2 },
          { variantId: 'variant-b', quantity: 3 },
        ],
      });

      expect(createPayload().subtotal).toBe(8000);
      expect(createdItems()).toHaveLength(2);
    });

    it('describes the variant from its option values', async () => {
      await create();
      expect(createdItems()[0]).toMatchObject({
        sku: 'SKU-variant-a',
        productTitle: 'Title variant-a',
        variantTitle: 'Colour: Red',
        quantity: 2,
      });
    });

    it('leaves the variant title unset when the variant has no options', async () => {
      stubVariants({
        'variant-a': makeVariant('variant-a', { optionValues: [] }),
      });
      await create();
      expect(createdItems()[0].variantTitle).toBeUndefined();
    });
  });

  describe('totals', () => {
    it('charges no shipping when no option is chosen', async () => {
      await create();
      expect(createPayload()).toMatchObject({
        subtotal: 5000,
        shipping: 0,
        total: 5000,
      });
    });

    it('adds the shipping option amount to the total', async () => {
      (
        prisma.shippingOption.findUnique as unknown as jest.Mock
      ).mockResolvedValue({ amount: 1500 });

      await create({ shippingOptionId: 'ship-1' });

      expect(createPayload()).toMatchObject({
        shipping: 1500,
        total: 6500,
        shippingOptionId: 'ship-1',
      });
    });

    it('rejects an unknown shipping option', async () => {
      (
        prisma.shippingOption.findUnique as unknown as jest.Mock
      ).mockResolvedValue(null);
      await expect(create({ shippingOptionId: 'nope' })).rejects.toThrow(
        'Invalid shipping option',
      );
    });

    it('opens the order with no discount or tax', async () => {
      await create();
      expect(createPayload()).toMatchObject({ discount: 0, tax: 0 });
    });
  });

  describe('confirm-on-create', () => {
    it.each([PaymentStatus.PAID, PaymentStatus.COD])(
      'opens a %s order as CONFIRMED and reserves stock',
      async (paymentStatus) => {
        await create({ paymentStatus });

        expect(createPayload()).toMatchObject({
          status: OrderStatus.CONFIRMED,
          paymentStatus,
          confirmedById: ADMIN_ID,
        });
        expect(inventory.reserve).toHaveBeenCalledTimes(1);
        expect(inventory.reserve).toHaveBeenCalledWith(
          'variant-a',
          2,
          NEW_ORDER_ID,
          ADMIN_ID,
          tx,
        );
      },
    );

    it('opens an UNPAID order as PENDING without reserving stock', async () => {
      await create({ paymentStatus: PaymentStatus.UNPAID });

      expect(createPayload()).toMatchObject({
        status: OrderStatus.PENDING,
        confirmedById: null,
      });
      expect(inventory.reserve).not.toHaveBeenCalled();
    });

    it('reserves every line of a multi-line confirmed order', async () => {
      stubVariants({
        'variant-a': makeVariant('variant-a'),
        'variant-b': makeVariant('variant-b'),
      });
      priceVariants({ 'variant-a': 2500, 'variant-b': 1000 });

      await create({
        paymentStatus: PaymentStatus.PAID,
        items: [
          { variantId: 'variant-a', quantity: 2 },
          { variantId: 'variant-b', quantity: 3 },
        ],
      });

      expect(inventory.reserve).toHaveBeenCalledTimes(2);
      expect(inventory.reserve).toHaveBeenNthCalledWith(
        2,
        'variant-b',
        3,
        NEW_ORDER_ID,
        ADMIN_ID,
        tx,
      );
    });

    it('propagates an out-of-stock failure from the reservation', async () => {
      inventory.reserve.mockRejectedValue(
        new BadRequestException(
          'Insufficient stock for variant SKU-variant-a',
        ) as never,
      );

      await expect(
        create({ paymentStatus: PaymentStatus.PAID }),
      ).rejects.toThrow('Insufficient stock');
    });

    // updateOrder refuses REFUNDED as a manual assignment, but this path has no
    // such check — @IsEnum(PaymentStatus) on the DTO admits every member, so an
    // order can be opened already refunded. Documents current behaviour.
    it('accepts REFUNDED on creation, unlike updateOrder', async () => {
      await create({ paymentStatus: PaymentStatus.REFUNDED });

      expect(createPayload()).toMatchObject({
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.REFUNDED,
        confirmedById: null,
      });
      expect(inventory.reserve).not.toHaveBeenCalled();
    });
  });

  describe('attribution and optional fields', () => {
    it('records the creating admin', async () => {
      await create();
      expect(createPayload().createdById).toBe(ADMIN_ID);
    });

    it('links the order to a store user when supplied', async () => {
      await create({ storeUserId: 'store-user-9' });
      expect(createPayload().storeUserId).toBe('store-user-9');
    });

    it('leaves the store user null for a walk-in order', async () => {
      await create();
      expect(createPayload().storeUserId).toBeNull();
    });

    it('carries the supplied customer and address fields', async () => {
      await create({
        customerName: 'Ada',
        customerPhone: '0400000000',
        shippingAddress1: '1 Test St',
        shippingCity: 'Melbourne',
        shippingPostalCode: '3000',
        shippingCountry: 'AU',
        note: 'gift wrap',
      });

      expect(createPayload()).toMatchObject({
        customerName: 'Ada',
        customerPhone: '0400000000',
        shippingAddress1: '1 Test St',
        shippingCity: 'Melbourne',
        shippingPostalCode: '3000',
        shippingCountry: 'AU',
        note: 'gift wrap',
      });
    });

    it('nulls optional fields that were not supplied', async () => {
      await create();
      expect(createPayload()).toMatchObject({
        customerName: null,
        customerPhone: null,
        note: null,
        shippingAddress1: null,
        shippingAddress2: null,
        shippingCity: null,
        shippingState: null,
        shippingPostalCode: null,
        shippingCountry: null,
        shippingOptionId: null,
      });
    });

    it('records the store currency on the order', async () => {
      storeRepo.findById.mockResolvedValue({
        id: STORE_ID,
        defaultCurrency: 'NZD',
      } as never);
      await create();
      expect(createPayload().currency).toBe('NZD');
    });
  });

  describe('transaction handling', () => {
    it('numbers and creates the order inside one transaction', async () => {
      await create();

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(orderRepo.generateOrderNumber).toHaveBeenCalledWith(STORE_ID, tx);
      expect(createPayload().orderNumber).toBe('ORD-0007');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        tx,
      );
    });

    it('returns the created order', async () => {
      await expect(create()).resolves.toMatchObject({ id: NEW_ORDER_ID });
    });
  });
});
