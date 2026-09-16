import { INestApplication } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { bearer, loginAdmin } from './helpers/auth';
import { SeededTenant, seedTenant } from './helpers/seed';
import { createTestApp, truncateAll } from './helpers/test-app';

/**
 * These are the checks no unit test can make: the guards are really attached to
 * the routes, and the queries behind them are really scoped to the caller's
 * tenant. Everything here goes over HTTP against a real Postgres.
 */
describe('tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alpha: SeededTenant;
  let beta: SeededTenant;
  let alphaToken: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    alpha = await seedTenant(prisma, 'alpha');
    beta = await seedTenant(prisma, 'beta');
    alphaToken = await loginAdmin(app, alpha.email, alpha.password);
  });

  const http = () => request(app.getHttpServer());

  describe('authentication is actually required', () => {
    it.each([
      ['post', '/products'],
      ['delete', '/products/some-id'],
      ['get', '/stores'],
      ['post', '/stores'],
    ])('%s %s rejects an anonymous request', async (method, path) => {
      const res = await http()[method as 'get'](path).send({});
      expect(res.status).toBe(401);
    });

    it('rejects a syntactically valid but unsigned token', async () => {
      const res = await http().get('/stores').set(bearer('not.a.real.token'));
      expect(res.status).toBe(401);
    });
  });

  describe('actor separation', () => {
    it('refuses a store-user token on an admin route', async () => {
      await prisma.storeUser.create({
        data: {
          storeId: alpha.storeId,
          email: 'customer@example.com',
          passwordHash: await import('bcryptjs').then((b) =>
            b.hash('Password123!', 4),
          ),
        },
      });

      const login = await http()
        .post(`/auth/store/${alpha.storeSlug}/login`)
        .send({ email: 'customer@example.com', password: 'Password123!' });

      const customerToken = (login.body as { access: string }).access;
      expect(customerToken).toBeDefined();

      const res = await http().get('/stores').set(bearer(customerToken));
      expect(res.status).toBe(403);
    });
  });

  describe('store access across tenants', () => {
    it('lists only the stores the admin actually owns', async () => {
      const res = await http().get('/stores').set(bearer(alphaToken));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((s) => s.id);
      expect(ids).toContain(alpha.storeId);
      expect(ids).not.toContain(beta.storeId);
    });

    it('reads a store its own tenant owns', async () => {
      const res = await http()
        .get(`/stores/${alpha.storeId}`)
        .set(bearer(alphaToken));

      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(alpha.storeId);
    });

    // 404 rather than 403: a 403 would confirm the id exists, letting a caller
    // enumerate other tenants' stores.
    it('cannot read another tenant store by id', async () => {
      const res = await http()
        .get(`/stores/${beta.storeId}`)
        .set(bearer(alphaToken));

      expect(res.status).toBe(404);
    });

    it('cannot rename another tenant store', async () => {
      const res = await http()
        .patch(`/stores/${beta.storeId}`)
        .set(bearer(alphaToken))
        .send({ name: 'Taken over by alpha' });

      expect(res.status).toBe(404);

      const after = await prisma.store.findUnique({
        where: { id: beta.storeId },
      });
      expect(after?.name).toBe('Store beta');
    });

    it('cannot delete another tenant store', async () => {
      const res = await http()
        .delete(`/stores/${beta.storeId}`)
        .set(bearer(alphaToken));

      expect(res.status).toBe(404);
      await expect(
        prisma.store.findUnique({ where: { id: beta.storeId } }),
      ).resolves.not.toBeNull();
    });

    it('can rename a store its own tenant owns', async () => {
      const res = await http()
        .patch(`/stores/${alpha.storeId}`)
        .set(bearer(alphaToken))
        .send({ name: 'Renamed by owner' });

      expect(res.status).toBe(200);

      const after = await prisma.store.findUnique({
        where: { id: alpha.storeId },
      });
      expect(after?.name).toBe('Renamed by owner');
    });
  });

  describe('role restrictions', () => {
    it('lets an OWNER create a store', async () => {
      const res = await http()
        .post('/stores')
        .set(bearer(alphaToken))
        .send({ name: 'New Store', slug: 'new-store', defaultCurrency: 'AUD' });

      expect([200, 201]).toContain(res.status);
    });

    it('refuses store creation to a VIEWER', async () => {
      const viewer = await seedTenant(prisma, 'viewer', AdminRole.VIEWER);
      const viewerToken = await loginAdmin(app, viewer.email, viewer.password);

      const res = await http()
        .post('/stores')
        .set(bearer(viewerToken))
        .send({ name: 'Nope', slug: 'nope', defaultCurrency: 'AUD' });

      expect(res.status).toBe(403);
    });

    it('refuses a VIEWER renaming a store they can see', async () => {
      const viewer = await seedTenant(prisma, 'viewer2', AdminRole.VIEWER);
      const viewerToken = await loginAdmin(app, viewer.email, viewer.password);

      const res = await http()
        .patch(`/stores/${viewer.storeId}`)
        .set(bearer(viewerToken))
        .send({ name: 'Renamed by a viewer' });

      expect(res.status).toBe(403);
    });

    it('lets a MANAGER rename a store but not delete it', async () => {
      const manager = await seedTenant(prisma, 'manager', AdminRole.MANAGER);
      const token = await loginAdmin(app, manager.email, manager.password);

      await expect(
        http()
          .patch(`/stores/${manager.storeId}`)
          .set(bearer(token))
          .send({ name: 'Renamed by manager' })
          .then((r) => r.status),
      ).resolves.toBe(200);

      const del = await http()
        .delete(`/stores/${manager.storeId}`)
        .set(bearer(token));
      expect(del.status).toBe(403);
    });
  });

  describe('product routes', () => {
    it('refuses product creation without a token', async () => {
      const res = await http().post('/products').send({
        storeId: alpha.storeId,
        title: 'Sneaky',
      });
      expect(res.status).toBe(401);
    });

    // KNOWN GAP: GET /products/:id carries no guard, so full product detail
    // (including storeId) is readable by anyone who knows or guesses an id.
    it('DEFECT: serves product detail to anonymous callers', async () => {
      const res = await http().get(`/products/${beta.productId}`);

      expect(res.status).toBe(200);
      expect((res.body as { storeId: string }).storeId).toBe(beta.storeId);
    });
  });

  describe('suspended tenants', () => {
    it('refuses login once the tenant is suspended', async () => {
      await prisma.tenant.update({
        where: { id: alpha.tenantId },
        data: { status: 'SUSPENDED' },
      });

      const res = await http()
        .post('/auth/admin/login')
        .send({ email: alpha.email, password: alpha.password });

      expect(res.status).toBe(401);
    });
  });
});
