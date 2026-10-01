# SOLID Guidelines

Use this reference when a task requires architectural judgment about class
responsibilities, abstractions, interfaces, extensibility, or dependencies.

SOLID is a design tool, not a goal by itself.

Do not add complexity merely to demonstrate SOLID principles.

---

## Single Responsibility Principle

A class should have one cohesive responsibility and one primary reason to
change.

In this project:

```text
Controller
    → HTTP / transport concerns

Service
    → business/application behavior

Repository
    → persistence

Worker
    → background job consumption
```

A service may coordinate several repositories if they participate in one
cohesive business use case.

Example:

```text
OrderService.confirmOrder()
    ├── OrderRepository
    ├── InventoryRepository
    └── PaymentRepository
```

This does not violate SRP merely because several dependencies are involved.

Consider splitting a service when it owns unrelated business capabilities.

Avoid splitting solely because:

- the file is long;
- there are several methods;
- another abstraction is technically possible.

---

## Open/Closed Principle

Prefer extending stable abstractions without unnecessarily rewriting them.

Good examples:

- adding an operation to a cohesive repository interface;
- introducing another implementation for an existing abstraction when
  multiple implementations are genuinely required.

Avoid speculative extension mechanisms such as:

- strategy interfaces with only one foreseeable implementation;
- factories with no real variation;
- generic abstractions created for hypothetical future requirements.

Introduce extensibility when there is an actual requirement or established
variation.

---

## Liskov Substitution Principle

Implementations must honor the contract promised by their interface.

For repository implementations:

```text
IProductRepository
       ↓
ProductRepository
```

the concrete implementation must preserve:

- return semantics;
- error behavior expected by callers;
- ownership/scoping expectations;
- transaction behavior promised by the interface.

Do not create an implementation that technically satisfies TypeScript while
changing the meaning of the contract.

---

## Interface Segregation Principle

Prefer cohesive interfaces.

Avoid a giant repository interface containing unrelated operations simply
because all operations touch the same database.

Also avoid one interface per method.

Good boundary:

```ts
interface IProductRepository {
  findById(...);
  findBySku(...);
  create(...);
  update(...);
}
```

Potentially poor boundary:

```ts
interface IDatabaseRepository {
  findProduct(...);
  createProduct(...);
  createOrder(...);
  updateInvoice(...);
  findCustomer(...);
}
```

Interfaces should represent cohesive capabilities.

---

## Dependency Inversion Principle

High-level business logic must depend on abstractions rather than concrete
infrastructure.

Expected:

```text
Service
   ↓
Repository Interface
   ↓
DI Token
   ↓
Prisma Repository
```

Example:

```ts
constructor(
  @Inject(TOKENS.ProductRepo)
  private readonly productRepository: IProductRepository,
) {}
```

Avoid:

```ts
constructor(
  private readonly productRepository: ProductRepository,
) {}
```

and:

```ts
constructor(
  private readonly prisma: PrismaService,
) {}
```

The service should know what persistence capability it needs, not how the
database implements it.

---

## Practical SOLID Questions

Before introducing an abstraction ask:

1. What concrete problem does this solve?
2. Does it reduce coupling?
3. Does it clarify responsibility?
4. Is there actual variation requiring the abstraction?
5. Does it make testing or maintenance meaningfully easier?
6. Does the project already have an established solution?

If the abstraction primarily adds indirection without solving a concrete
problem, prefer the simpler implementation.

---

## Avoid SOLID Overengineering

Do not automatically create:

```text
Controller
Service
Manager
Handler
Coordinator
Factory
Strategy
Repository
Adapter
```

for one simple use case.

More layers do not automatically mean cleaner architecture.

Prefer the minimum set of abstractions required to maintain clear
responsibilities and dependency direction.

---

## Review Checklist

Ask:

- Does each class have a cohesive responsibility?
- Is business logic separated from transport and persistence?
- Are high-level components dependent on abstractions?
- Are interfaces cohesive?
- Can implementations honor their contracts consistently?
- Is extensibility based on real requirements?
- Has unnecessary indirection been introduced?
