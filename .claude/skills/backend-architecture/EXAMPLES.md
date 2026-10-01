# Backend Architecture Examples

Use this reference when deciding where code belongs or when reviewing an
implementation for architectural violations.

---

## 1. Controller vs Service

### Bad

Business logic inside controller:

```ts
@Post()
async create(
  @CurrentUser() user: AuthUser,
  @Body() dto: CreateProductDto,
) {
  const existing =
    await this.productRepository.findBySku(
      dto.sku,
      user.tenantId,
    );

  if (existing) {
    throw new ConflictException();
  }

  return this.productRepository.create({
    ...dto,
    tenantId: user.tenantId,
  });
}
```

### Good

Controller handles transport context:

```ts
@Post()
create(
  @CurrentUser() user: AuthUser,
  @Body() dto: CreateProductDto,
) {
  return this.productService.create(
    user.tenantId,
    dto,
  );
}
```

Service handles business behavior:

```ts
async create(
  tenantId: string,
  dto: CreateProductDto,
) {
  const existing =
    await this.productRepository.findBySku(
      dto.sku,
      tenantId,
    );

  if (existing) {
    throw new ConflictException(
      'Product SKU already exists',
    );
  }

  return this.productRepository.create({
    ...dto,
    tenantId,
  });
}
```

---

## 2. Prisma in Service

### Bad

```ts
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
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

## 3. Concrete Repository Injection

### Bad

```ts
constructor(
  private readonly productRepository:
    ProductRepository,
) {}
```

### Good

```ts
constructor(
  @Inject(TOKENS.ProductRepo)
  private readonly productRepository:
    IProductRepository,
) {}
```

---

## 4. Repository Interface

### Avoid

```ts
interface IProductRepository {
  findMany(where: Prisma.ProductWhereInput): Promise<Product[]>;
}
```

This forces the application layer to understand Prisma.

### Prefer

```ts
interface ProductFilters {
  search?: string;
  categoryId?: string;
  active?: boolean;
}

interface IProductRepository {
  findMany(tenantId: string, filters: ProductFilters): Promise<Product[]>;
}
```

---

## 5. Business Logic in Repository

### Bad

```ts
async cancelOrder(
  orderId: string,
) {
  const order =
    await this.prisma.order.findUnique(...);

  if (order.status === 'SHIPPED') {
    throw new BadRequestException(
      'Cannot cancel shipped order',
    );
  }

  await this.restoreInventory(...);
  await this.refundPayment(...);

  return this.prisma.order.update(...);
}
```

The repository is making business decisions and coordinating workflows.

### Better

Repository exposes persistence capabilities:

```ts
interface IOrderRepository {
  findById(...);
  updateStatus(...);
}
```

Service owns the workflow:

```ts
async cancelOrder(
  tenantId: string,
  orderId: string,
) {
  const order =
    await this.orderRepository.findById(
      orderId,
      tenantId,
    );

  if (order.status === OrderStatus.SHIPPED) {
    throw new BadRequestException(
      'Cannot cancel shipped order',
    );
  }

  // Coordinate the required business workflow.
}
```

Use the `prisma-repositories` skill for transaction design.

---

## 6. DTO Validation vs Business Validation

DTO:

```ts
export class CreateOrderItemDto {
  @IsInt()
  @Min(1)
  quantity: number;
}
```

This validates structure:

```text
quantity >= 1
```

Service:

```ts
if (availableStock < dto.quantity) {
  throw new BadRequestException('Insufficient stock');
}
```

This validates a business rule.

Do not query inventory from a DTO validator.

---

## 7. Cross-Repository Workflow

Valid service orchestration:

```ts
async confirmOrder(...) {
  const order =
    await this.orderRepository.findById(...);

  // validate business state

  await this.inventoryRepository...;
  await this.orderRepository...;
}
```

Using several repositories does not automatically violate SRP when all calls
belong to one cohesive business operation.

Use a transaction when the writes must succeed or fail together.

---

## 8. Worker Architecture

### Avoid

```text
BullMQ Processor
    ↓
large billing workflow
    ↓
direct Prisma queries
```

### Prefer

```text
BullMQ Processor
    ↓
BillingService
    ↓
Repository Interface
    ↓
Repository
```

The execution mechanism changes.

The application's architecture does not.

---

## 9. Premature Generic Repository

### Avoid

```ts
class GenericRepository<T> {
  find(...);
  findAll(...);
  create(...);
  update(...);
  delete(...);
}
```

when domain repositories need:

```text
findBySkuForTenant()
findActiveByStore()
countOrdersByStatus()
generateOrderNumber()
```

Generic abstractions often push persistence details back into services.

Prefer explicit domain-focused repository methods unless the project has a
real reusable generic pattern.

---

## 10. Circular Dependency

Problem:

```text
OrdersService
     ↓
InventoryService
     ↓
OrdersService
```

Do not immediately add `forwardRef()`.

First ask:

- Which service owns the workflow?
- Is one service performing behavior belonging to the other?
- Is there a smaller application capability that should be extracted?
- Is the dependency direction reversed?

Use `forwardRef()` only after confirming the circular dependency is a valid
domain relationship rather than an architecture smell.

---

## Final Placement Test

When unsure where code belongs, ask:

### Is it HTTP/transport-specific?

→ Controller

### Is it a business decision or workflow?

→ Service

### Is it database access or persistence mechanics?

→ Repository

### Is it background execution plumbing?

→ Worker/processor

### Is it database transaction/query behavior?

→ Repository + `prisma-repositories` skill

### Is it tenant/store authorization?

→ Use `multi-tenancy-security` skill
