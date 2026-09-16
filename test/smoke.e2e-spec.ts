import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAll } from './helpers/test-app';
import { PrismaService } from 'src/common/prisma/prisma.service';

describe('e2e harness', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('points at the test database, not dev', () => {
    expect(process.env.DATABASE_URL).toContain('5433');
    expect(process.env.DATABASE_URL).toContain('ventriahq_test');
  });

  it('boots the real AppModule and serves a route', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('can truncate every table', async () => {
    await expect(truncateAll(prisma)).resolves.toBeUndefined();
  });
});
