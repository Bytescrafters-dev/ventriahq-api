import { JwtStrategy } from './jwt.strategy';

/**
 * validate() turns a verified JWT payload into the `user` object every guard in
 * the app reads. The `type` claim it copies is the only thing separating
 * super_admin, admin and store_user requests, so the mapping is load-bearing.
 */
describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    strategy = new JwtStrategy();
  });

  const adminPayload = {
    sub: 'user-1',
    type: 'admin',
    role: 'OWNER',
    storeId: 'store-1',
    tenantId: 'tenant-1',
  };

  it('copies the identity and actor type from the payload', async () => {
    await expect(strategy.validate(adminPayload)).resolves.toEqual({
      sub: 'user-1',
      type: 'admin',
      role: 'OWNER',
      storeId: 'store-1',
      tenantId: 'tenant-1',
    });
  });

  it.each(['super_admin', 'admin', 'store_user'])(
    'preserves the %s actor type verbatim',
    async (type) => {
      const user = await strategy.validate({ sub: 'x', type });
      expect(user.type).toBe(type);
    },
  );

  it('defaults a missing tenantId to null', async () => {
    const user = await strategy.validate({ sub: 'x', type: 'store_user' });
    expect(user.tenantId).toBeNull();
  });

  // Documents an asymmetry: tenantId is coalesced to null, the rest are not.
  it('leaves other missing claims undefined rather than null', async () => {
    const user = await strategy.validate({ sub: 'x', type: 'store_user' });
    expect(user.role).toBeUndefined();
    expect(user.storeId).toBeUndefined();
  });

  // A forged or stale token must not be able to smuggle extra fields onto
  // `req.user` — validate allowlists claims rather than spreading the payload.
  it('drops claims outside the allowlist', async () => {
    const user = await strategy.validate({
      ...adminPayload,
      isSuperAdmin: true,
      permissions: ['*'],
    });

    expect(user).not.toHaveProperty('isSuperAdmin');
    expect(user).not.toHaveProperty('permissions');
    expect(Object.keys(user).sort()).toEqual([
      'role',
      'storeId',
      'sub',
      'tenantId',
      'type',
    ]);
  });

  it('does not invent an actor type when the claim is absent', async () => {
    const user = await strategy.validate({ sub: 'x' });
    expect(user.type).toBeUndefined();
  });
});
