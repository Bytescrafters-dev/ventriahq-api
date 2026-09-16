import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { OptionalStoreUserGuard } from './optional-store-user.guard';
import { StoreUserGuard } from './store-user.guard';
import { SuperAdminGuard } from './super-admin.guard';

type Actor = 'super_admin' | 'admin' | 'store_user';
const ACTORS: Actor[] = ['super_admin', 'admin', 'store_user'];

/** Minimal ExecutionContext exposing the request the guards read `user` from. */
const contextFor = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

/**
 * Each guard extends AuthGuard('jwt') and awaits `super.canActivate` before
 * checking the actor type. Stubbing the inherited method isolates the type
 * check from passport's token verification.
 */
const stubPassport = (
  GuardClass: new () => CanActivate,
  impl: () => unknown = () => Promise.resolve(true),
) => {
  const superProto = Object.getPrototypeOf(GuardClass.prototype) as object;
  return jest
    .spyOn(superProto as { canActivate: () => unknown }, 'canActivate')
    .mockImplementation(impl);
};

describe.each([
  ['AdminGuard', AdminGuard, 'admin'],
  ['StoreUserGuard', StoreUserGuard, 'store_user'],
  ['SuperAdminGuard', SuperAdminGuard, 'super_admin'],
] as [string, new () => CanActivate, Actor][])(
  '%s',
  (_name, GuardClass, allowedType) => {
    let guard: CanActivate;
    let passport: jest.SpyInstance;

    beforeEach(() => {
      guard = new GuardClass();
      passport = stubPassport(GuardClass);
    });

    afterEach(() => passport.mockRestore());

    it(`admits a ${allowedType} token`, async () => {
      await expect(
        guard.canActivate(contextFor({ sub: 'u1', type: allowedType })),
      ).resolves.toBe(true);
    });

    // The core of the multi-actor model: holding a valid token for one actor
    // type must not open another actor's endpoints.
    it.each(ACTORS.filter((t) => t !== allowedType))(
      'rejects a %s token',
      async (otherType) => {
        await expect(
          guard.canActivate(contextFor({ sub: 'u1', type: otherType })),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('rejects a request with no user attached', async () => {
      await expect(
        guard.canActivate(contextFor(undefined)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a token carrying no actor type', async () => {
      await expect(
        guard.canActivate(contextFor({ sub: 'u1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('verifies the token before checking the actor type', async () => {
      await guard.canActivate(contextFor({ sub: 'u1', type: allowedType }));
      expect(passport).toHaveBeenCalledTimes(1);
    });

    // An invalid token must stay a 401, not be masked as a 403.
    it('propagates a token verification failure unchanged', async () => {
      passport.mockRejectedValue(new UnauthorizedException());
      await expect(
        guard.canActivate(contextFor({ sub: 'u1', type: allowedType })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  },
);

describe('OptionalStoreUserGuard', () => {
  const guard = new OptionalStoreUserGuard();

  it('returns the customer for a store_user token', () => {
    const user = { sub: 'su1', type: 'store_user' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('treats an anonymous request as a guest', () => {
    expect(guard.handleRequest(null, undefined)).toBeNull();
  });

  // An admin browsing the storefront is a guest here, not a customer — this is
  // what stops an admin token from acting on a customer's cart.
  it.each(['admin', 'super_admin'])(
    'treats a %s token as a guest rather than a customer',
    (type) => {
      expect(guard.handleRequest(null, { sub: 'u1', type })).toBeNull();
    },
  );

  // Deliberate: the endpoint works for anonymous visitors, so a bad token
  // degrades to guest instead of returning 401.
  it('degrades to a guest when token verification errored', () => {
    expect(
      guard.handleRequest(new UnauthorizedException(), undefined),
    ).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    expect(() => {
      guard.handleRequest(new Error('boom'), { type: 'admin' });
    }).not.toThrow();
  });
});
