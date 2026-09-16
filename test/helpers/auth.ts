import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** Logs in through the real auth endpoint and returns the access token. */
export async function loginAdmin(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/admin/login')
    .send({ email, password });

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `admin login failed (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return (res.body as { access: string }).access;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
