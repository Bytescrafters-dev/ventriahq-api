import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  InventoryMovementActorType,
  InventoryMovementRefType,
  InventoryMovementType,
} from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { TOKENS } from 'src/common/constants/tokens';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { IProductRepository } from '../products/interfaces/product.repository.interface';
import { IInventoryRepository } from './interfaces/inventory.repository.interface';
import { InventoryService } from './inventory.service';

const VARIANT_ID = 'variant-1';
const ORDER_ID = 'order-1';
const ADMIN_ID = 'admin-1';

/** First argument of a mock's first call, typed. */
const argOf = <T>(m: jest.Mock, argIndex = 0): T => {
  const calls = m.mock.calls as unknown as T[][];
  return calls[0][argIndex];
};

describe('InventoryService', () => {
  let service: InventoryService;
  let inventoryRepo: DeepMockProxy<IInventoryRepository>;
  let productRepo: DeepMockProxy<IProductRepository>;
  let prisma: DeepMockProxy<PrismaService>;
  /** Stand-in transaction client, distinct from any caller-supplied one. */
  let ownTx: Record<string, string>;
  let $transaction: jest.Mock;

  const stock = (quantity: number, reserved: number) =>
    ({ variantId: VARIANT_ID, quantity, reserved }) as never;

  beforeEach(async () => {
    inventoryRepo = mockDeep<IInventoryRepository>();
    productRepo = mockDeep<IProductRepository>();
    prisma = mockDeep<PrismaService>();
    ownTx = { client: 'opened-by-service' };

    $transaction = prisma.$transaction as unknown as jest.Mock;
    $transaction.mockImplementation((fn: (client: unknown) => unknown) =>
      fn(ownTx),
    );

    inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(10, 0));

    const moduleRef = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: TOKENS.InventoryRepo, useValue: inventoryRepo },
        { provide: TOKENS.ProductRepo, useValue: productRepo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(InventoryService);
  });

  const movement = () =>
    argOf<Record<string, unknown>>(
      inventoryRepo.createMovement as unknown as jest.Mock,
    );

  describe('reserve', () => {
    const reserve = (
      qty: number,
      actorId: string | null = ADMIN_ID,
      tx?: unknown,
    ) => service.reserve(VARIANT_ID, qty, ORDER_ID, actorId, tx);

    describe('availability', () => {
      it('reserves when free stock exactly covers the request', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(10, 4));
        await reserve(6); // 10 - 4 = 6 free
        expect(inventoryRepo.incrementReserved).toHaveBeenCalledWith(
          VARIANT_ID,
          6,
          ownTx,
        );
      });

      // One more than available must fail — this boundary is the oversell line.
      it('refuses one unit beyond free stock', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(10, 4));
        productRepo.findVariantById.mockResolvedValue({
          sku: 'SKU-1',
        } as never);

        await expect(reserve(7)).rejects.toBeInstanceOf(BadRequestException);
      });

      // Availability is quantity minus what is already spoken for.
      it('counts existing reservations as unavailable', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(10, 10));
        productRepo.findVariantById.mockResolvedValue({
          sku: 'SKU-1',
        } as never);

        await expect(reserve(1)).rejects.toThrow('Insufficient stock');
      });

      it('refuses when the variant has no inventory row', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(null);
        productRepo.findVariantById.mockResolvedValue({
          sku: 'SKU-1',
        } as never);

        await expect(reserve(1)).rejects.toThrow('Insufficient stock');
      });

      it('names the variant SKU when refusing', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(0, 0));
        productRepo.findVariantById.mockResolvedValue({
          sku: 'BLUE-WIDGET-L',
        } as never);

        await expect(reserve(1)).rejects.toThrow(
          'Insufficient stock for variant BLUE-WIDGET-L',
        );
      });

      it('writes nothing when the reservation is refused', async () => {
        inventoryRepo.lockAndGetInventory.mockResolvedValue(stock(0, 0));
        productRepo.findVariantById.mockResolvedValue({ sku: 'X' } as never);

        await expect(reserve(1)).rejects.toThrow();
        expect(inventoryRepo.createMovement).not.toHaveBeenCalled();
        expect(inventoryRepo.incrementReserved).not.toHaveBeenCalled();
      });
    });

    describe('concurrency', () => {
      // Reading without the row lock would let two checkouts pass the same
      // availability check and oversell.
      it('reads the inventory row under a lock', async () => {
        await reserve(1);
        expect(inventoryRepo.lockAndGetInventory).toHaveBeenCalledWith(
          VARIANT_ID,
          ownTx,
        );
        expect(inventoryRepo.findInventory).not.toHaveBeenCalled();
      });

      it('locks inside the caller transaction when given one', async () => {
        const callerTx = { client: 'caller' };
        await reserve(1, ADMIN_ID, callerTx);

        expect(inventoryRepo.lockAndGetInventory).toHaveBeenCalledWith(
          VARIANT_ID,
          callerTx,
        );
      });
    });

    describe('ledger', () => {
      it('records a RESERVED movement against the order', async () => {
        await reserve(3);
        expect(movement()).toEqual({
          variantId: VARIANT_ID,
          type: InventoryMovementType.RESERVED,
          delta: 3,
          refType: InventoryMovementRefType.ORDER,
          refId: ORDER_ID,
          actorType: InventoryMovementActorType.ADMIN,
          actorId: ADMIN_ID,
        });
      });

      it('attributes an actorless reservation to the system', async () => {
        await reserve(3, null);
        expect(movement()).toMatchObject({
          actorType: InventoryMovementActorType.SYSTEM,
          actorId: null,
        });
      });

      // The movement row and the counter must move together or the ledger
      // stops reconciling against stock on hand.
      it('writes the movement and the counter as a pair', async () => {
        await reserve(3);
        expect(inventoryRepo.createMovement).toHaveBeenCalledTimes(1);
        expect(inventoryRepo.incrementReserved).toHaveBeenCalledTimes(1);
      });

      it('does not touch physical quantity when reserving', async () => {
        await reserve(3);
        expect(inventoryRepo.decrementQuantity).not.toHaveBeenCalled();
        expect(inventoryRepo.incrementQuantity).not.toHaveBeenCalled();
      });
    });

    describe('transaction handling', () => {
      it('opens its own transaction when none is supplied', async () => {
        await reserve(1);
        expect($transaction).toHaveBeenCalledTimes(1);
      });

      it('joins the caller transaction instead of opening another', async () => {
        const callerTx = { client: 'caller' };
        await reserve(1, ADMIN_ID, callerTx);

        expect($transaction).not.toHaveBeenCalled();
        expect(inventoryRepo.incrementReserved).toHaveBeenCalledWith(
          VARIANT_ID,
          1,
          callerTx,
        );
      });
    });
  });

  describe('unreserve', () => {
    const unreserve = (
      qty: number,
      actorId: string | null = ADMIN_ID,
      tx?: unknown,
    ) => service.unreserve(VARIANT_ID, qty, ORDER_ID, actorId, tx);

    it('records an UNRESERVED movement against the order', async () => {
      await unreserve(2);
      expect(movement()).toEqual({
        variantId: VARIANT_ID,
        type: InventoryMovementType.UNRESERVED,
        delta: 2,
        refType: InventoryMovementRefType.ORDER,
        refId: ORDER_ID,
        actorType: InventoryMovementActorType.ADMIN,
        actorId: ADMIN_ID,
      });
    });

    it('releases the reservation', async () => {
      await unreserve(2);
      expect(inventoryRepo.decrementReserved).toHaveBeenCalledWith(
        VARIANT_ID,
        2,
        ownTx,
      );
    });

    // Releasing a reservation returns stock to available; it never created or
    // destroyed physical units.
    it('leaves physical quantity untouched', async () => {
      await unreserve(2);
      expect(inventoryRepo.decrementQuantity).not.toHaveBeenCalled();
      expect(inventoryRepo.incrementQuantity).not.toHaveBeenCalled();
    });

    // No availability check: releasing is always safe, and a locked read here
    // would deadlock against the caller transaction.
    it('does not re-check availability', async () => {
      await unreserve(2);
      expect(inventoryRepo.lockAndGetInventory).not.toHaveBeenCalled();
    });

    it('attributes an actorless release to the system', async () => {
      await unreserve(2, null);
      expect(movement()).toMatchObject({
        actorType: InventoryMovementActorType.SYSTEM,
        actorId: null,
      });
    });

    it('joins the caller transaction when given one', async () => {
      const callerTx = { client: 'caller' };
      await unreserve(2, ADMIN_ID, callerTx);

      expect($transaction).not.toHaveBeenCalled();
      expect(inventoryRepo.decrementReserved).toHaveBeenCalledWith(
        VARIANT_ID,
        2,
        callerTx,
      );
    });
  });

  describe('sell', () => {
    const sell = (qty: number, tx?: unknown) =>
      service.sell(VARIANT_ID, qty, ORDER_ID, ADMIN_ID, tx);

    it('records a SALE movement against the order', async () => {
      await sell(2);
      expect(movement()).toEqual({
        variantId: VARIANT_ID,
        type: InventoryMovementType.SALE,
        delta: 2,
        refType: InventoryMovementRefType.ORDER,
        refId: ORDER_ID,
        actorType: InventoryMovementActorType.ADMIN,
        actorId: ADMIN_ID,
      });
    });

    // A sale consumes stock that was already reserved, so both counters must
    // fall. Dropping either one leaves the variant permanently mis-counted.
    it('deducts physical stock and clears the reservation together', async () => {
      await sell(2);

      expect(inventoryRepo.decrementQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        2,
        ownTx,
      );
      expect(inventoryRepo.decrementReserved).toHaveBeenCalledWith(
        VARIANT_ID,
        2,
        ownTx,
      );
    });

    it('deducts the same amount from both counters', async () => {
      await sell(5);

      const qty = inventoryRepo.decrementQuantity.mock.calls[0][1];
      const res = inventoryRepo.decrementReserved.mock.calls[0][1];
      expect(qty).toBe(res);
    });

    it('joins the caller transaction when given one', async () => {
      const callerTx = { client: 'caller' };
      await sell(2, callerTx);
      expect($transaction).not.toHaveBeenCalled();
      expect(inventoryRepo.decrementQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        2,
        callerTx,
      );
    });
  });

  describe('stockIn', () => {
    it('records a STOCK_IN movement against the stock order', async () => {
      await service.stockIn(VARIANT_ID, 25, 'stock-order-1', ADMIN_ID);

      expect(movement()).toEqual({
        variantId: VARIANT_ID,
        type: InventoryMovementType.STOCK_IN,
        delta: 25,
        refType: InventoryMovementRefType.STOCK_ORDER,
        refId: 'stock-order-1',
        actorType: InventoryMovementActorType.ADMIN,
        actorId: ADMIN_ID,
      });
    });

    it('adds the units to physical stock', async () => {
      await service.stockIn(VARIANT_ID, 25, 'stock-order-1', ADMIN_ID);
      expect(inventoryRepo.incrementQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        25,
        ownTx,
      );
    });

    // Receiving stock adds availability; it must not also mark units spoken for.
    it('does not change reservations', async () => {
      await service.stockIn(VARIANT_ID, 25, 'stock-order-1', ADMIN_ID);
      expect(inventoryRepo.incrementReserved).not.toHaveBeenCalled();
      expect(inventoryRepo.decrementReserved).not.toHaveBeenCalled();
    });

    it('joins the caller transaction when given one', async () => {
      const callerTx = { client: 'caller' };
      await service.stockIn(
        VARIANT_ID,
        25,
        'stock-order-1',
        ADMIN_ID,
        callerTx,
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('receiptIn', () => {
    it('records a RECEIPT_IN movement against the receipt', async () => {
      await service.receiptIn(VARIANT_ID, 7, 'receipt-1', ADMIN_ID);

      expect(movement()).toEqual({
        variantId: VARIANT_ID,
        type: InventoryMovementType.RECEIPT_IN,
        delta: 7,
        refType: InventoryMovementRefType.STOCK_RECEIPT,
        refId: 'receipt-1',
        actorType: InventoryMovementActorType.ADMIN,
        actorId: ADMIN_ID,
      });
    });

    it('adds the units to physical stock', async () => {
      await service.receiptIn(VARIANT_ID, 7, 'receipt-1', ADMIN_ID);
      expect(inventoryRepo.incrementQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        7,
        ownTx,
      );
    });

    it('does not change reservations', async () => {
      await service.receiptIn(VARIANT_ID, 7, 'receipt-1', ADMIN_ID);
      expect(inventoryRepo.incrementReserved).not.toHaveBeenCalled();
      expect(inventoryRepo.decrementReserved).not.toHaveBeenCalled();
    });
  });

  describe('adjust', () => {
    it('records an ADJUSTMENT movement against the adjustment', async () => {
      await service.adjust(VARIANT_ID, 4, 'adjustment-1', ADMIN_ID);

      expect(movement()).toEqual({
        variantId: VARIANT_ID,
        type: InventoryMovementType.ADJUSTMENT,
        delta: 4,
        refType: InventoryMovementRefType.STOCK_ADJUSTMENT,
        refId: 'adjustment-1',
        actorType: InventoryMovementActorType.ADMIN,
        actorId: ADMIN_ID,
      });
    });

    it('applies a positive delta as an increase', async () => {
      await service.adjust(VARIANT_ID, 4, 'adjustment-1', ADMIN_ID);
      expect(inventoryRepo.adjustQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        4,
        ownTx,
      );
    });

    // The delta is signed — a shrinkage write-off arrives as a negative number
    // and must reach the repository unchanged, not as its absolute value.
    it('passes a negative delta through unchanged', async () => {
      await service.adjust(VARIANT_ID, -3, 'adjustment-1', ADMIN_ID);

      expect(inventoryRepo.adjustQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        -3,
        ownTx,
      );
      expect(movement()).toMatchObject({ delta: -3 });
    });

    it('records the signed delta on the movement too', async () => {
      await service.adjust(VARIANT_ID, -3, 'adjustment-1', ADMIN_ID);
      const { delta } = movement() as unknown as { delta: number };
      expect(delta).toBeLessThan(0);
    });

    it('never touches reservations', async () => {
      await service.adjust(VARIANT_ID, -3, 'adjustment-1', ADMIN_ID);
      expect(inventoryRepo.incrementReserved).not.toHaveBeenCalled();
      expect(inventoryRepo.decrementReserved).not.toHaveBeenCalled();
    });

    it('joins the caller transaction when given one', async () => {
      const callerTx = { client: 'caller' };
      await service.adjust(VARIANT_ID, 4, 'adjustment-1', ADMIN_ID, callerTx);
      expect($transaction).not.toHaveBeenCalled();
      expect(inventoryRepo.adjustQuantity).toHaveBeenCalledWith(
        VARIANT_ID,
        4,
        callerTx,
      );
    });
  });

  // Every movement type must be distinct, or the ledger cannot be replayed to
  // explain how a variant reached its current stock level.
  describe('movement types are distinct across operations', () => {
    it('uses a different movement type per operation', async () => {
      const types: string[] = [];
      const capture = () =>
        (
          argOf<{ type: string }>(
            inventoryRepo.createMovement as unknown as jest.Mock,
          ) as { type: string }
        ).type;

      await service.reserve(VARIANT_ID, 1, ORDER_ID, ADMIN_ID);
      types.push(capture());
      inventoryRepo.createMovement.mockClear();

      await service.unreserve(VARIANT_ID, 1, ORDER_ID, ADMIN_ID);
      types.push(capture());
      inventoryRepo.createMovement.mockClear();

      await service.sell(VARIANT_ID, 1, ORDER_ID, ADMIN_ID);
      types.push(capture());
      inventoryRepo.createMovement.mockClear();

      await service.stockIn(VARIANT_ID, 1, 'so-1', ADMIN_ID);
      types.push(capture());
      inventoryRepo.createMovement.mockClear();

      await service.receiptIn(VARIANT_ID, 1, 'r-1', ADMIN_ID);
      types.push(capture());
      inventoryRepo.createMovement.mockClear();

      await service.adjust(VARIANT_ID, 1, 'a-1', ADMIN_ID);
      types.push(capture());

      expect(new Set(types).size).toBe(6);
    });
  });
});
