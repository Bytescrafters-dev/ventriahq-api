# Prisma Repository Examples

Use this reference when uncertain about repository implementation,
scoping, transactions, query design, or schema changes.

---

## 1. Prisma Inside Service

### Bad

```ts
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.product.findUnique({
      where: {
        id,
      },
    });
  }
}
```

### Good

```ts
@Injectable()
export class ProductService {
  constructor(
    @Inject(TOKENS.ProductRepo)
    private readonly productRepository: IProductRepository,
  ) {}

  findById(id: string, tenantId: string) {
    return this.productRepository.findById(id, tenantId);
  }
}
```

Repository:

```ts
@Injectable()
export class ProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, tenantId: string) {
    return this.prisma.product.findFirst({
      where: {
        id,
        tenantId,
      },
    });
  }
}
```

---

## 2. Prisma Type Leakage

### Avoid

```ts
interface IProductRepository {
  findMany(where: Prisma.ProductWhereInput): Promise<Product[]>;
}
```

Service must now understand Prisma.

### Prefer

```ts
interface ProductFilters {
  search?: string;
  categoryId?: string;
}

interface IProductRepository {
  findMany(tenantId: string, filters: ProductFilters): Promise<Product[]>;
}
```

---

## 3. Unscoped Delete

### Bad

```ts
async delete(id: string) {
  return this.prisma.product.delete({
    where: {
      id,
    },
  });
}
```

A valid ID from another tenant may be dangerous.

### Better

Use tenant ownership in the repository operation.

```ts
async delete(
  id: string,
  tenantId: string,
) {
  // Use the project's appropriate scoped strategy.
}
```

Where the schema provides a suitable compound unique constraint:

```ts
where: {
  id_tenantId: {
    id,
    tenantId,
  },
}
```

---

## 4. Scope Must Apply to Reads Too

### Bad

```ts
findById(id: string) {
  return this.prisma.order.findUnique({
    where: {
      id,
    },
  });
}
```

### Better

```ts
findById(
  id: string,
  storeId: string,
) {
  return this.prisma.order.findFirst({
    where: {
      id,
      storeId,
    },
  });
}
```

The exact scope depends on the domain.

---

## 5. Transaction Propagation

### Bad

```ts
await this.prisma.$transaction(async (tx) => {
  await this.orderRepository.create(orderData, tx);

  await this.inventoryRepository.updateStock(inventoryData);
});
```

`updateStock()` may use global Prisma and escape the transaction.

### Good

```ts
await this.prisma.$transaction(async (tx) => {
  await this.orderRepository.create(orderData, tx);

  await this.inventoryRepository.updateStock(inventoryData, tx);
});
```

Both operations now use the same transaction.

---

## 6. Repository Transaction Support

```ts
async updateStock(
  data: UpdateStockData,
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? this.prisma;

  return client.inventory.update({
    where: {
      id: data.inventoryId,
    },
    data: {
      quantity: data.quantity,
    },
  });
}
```

Follow established project conventions for method signatures.

---

## 7. External Side Effect Inside Transaction

### Avoid

```ts
await this.prisma.$transaction(async (tx) => {
  await this.invoiceRepository.markPaid(
    invoiceId,
    tx,
  );

  await this.emailService.sendReceipt(...);
});
```

The email cannot be rolled back.

### Prefer

```text
DB transaction
    ↓
commit
    ↓
send/enqueue receipt
```

If reliable delivery is business-critical, design the failure behavior
explicitly.

---

## 8. Read-Modify-Write Race

### Potentially unsafe

```ts
const stock = await this.inventoryRepository.getStock(productId);

await this.inventoryRepository.updateStock(
  productId,
  stock.quantity - quantity,
);
```

Two concurrent requests may read the same stock value.

Prefer an atomic persistence strategy when inventory correctness depends on
concurrency.

---

## 9. Sequential Identifier

### Avoid

```text
SELECT highest order number
        ↓
+ 1
        ↓
INSERT order
```

Concurrent requests may produce duplicates.

Follow the existing `StoreSequence` pattern and keep sequence generation in
the same transaction as dependent record creation.

---

## 10. N+1 Query

### Avoid

```ts
const products =
  await this.productRepository.findMany(...);

for (const product of products) {
  product.stock =
    await this.inventoryRepository.findForProduct(
      product.id,
    );
}
```

### Consider

- relation loading;
- batched inventory lookup;
- grouped query;
- aggregation.

Choose based on the actual required result.

---

## 11. Search Filtering

Service input:

```ts
{
  search: 'phone',
  categoryId: '...',
}
```

Repository:

```ts
const where: Prisma.ProductWhereInput = {
  tenantId,
};

if (filters.search) {
  where.OR = [
    {
      name: {
        contains: filters.search,
        mode: 'insensitive',
      },
    },
    {
      sku: {
        contains: filters.search,
        mode: 'insensitive',
      },
    },
  ];
}
```

Mandatory tenant scope remains present regardless of optional filters.

---

## 12. Stable Pagination

Prefer:

```ts
orderBy: [
  {
    createdAt: 'desc',
  },
  {
    id: 'desc',
  },
];
```

over relying on implicit ordering.

---

## 13. Database Aggregate

### Avoid

```ts
const orders = await this.prisma.order.findMany({
  where: {
    storeId,
  },
});

const count = orders.length;
```

when only a count is required.

### Prefer

```ts
return this.prisma.order.count({
  where: {
    storeId,
  },
});
```

---

## 14. Client-Controlled Sorting

### Avoid

```ts
orderBy: {
  [dto.sortBy]: dto.direction,
}
```

### Prefer

```ts
const allowedSortFields = {
  name: 'name',
  createdAt: 'createdAt',
  price: 'price',
} as const;
```

Map approved application values to Prisma fields.

---

## 15. Schema Rename

Potential migration:

```sql
ALTER TABLE "Product"
DROP COLUMN "oldName";

ALTER TABLE "Product"
ADD COLUMN "newName" TEXT;
```

If this represents a rename, data may be lost.

Inspect and adjust migration strategy intentionally.

---

## 16. Scoped Uniqueness

Potentially wrong:

```prisma
email String @unique
```

if users only need unique email addresses within one tenant.

Possible domain model:

```prisma
@@unique([tenantId, email])
```

Use the actual business invariant.

---

## 17. Repository Boundary

Repository:

```ts
getAvailableStock(
  productId: string,
  storeId: string,
)
```

Service:

```ts
const stock = await this.inventoryRepository.getAvailableStock(
  productId,
  storeId,
);

if (stock < requestedQuantity) {
  throw new BadRequestException('Insufficient stock');
}
```
