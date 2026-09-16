import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { mockDeep } from 'jest-mock-extended';
import { JwtAuthGuard, ROLES_KEY, Roles, Public, RolesGuard } from './index';

const handler = () => undefined;
class Controller {}

/** ExecutionContext exposing both the metadata targets and the request user. */
const contextFor = (user: unknown): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('Roles decorator', () => {
  it('stores the required roles under the shared metadata key', () => {
    class Target {
      @Roles(AdminRole.OWNER, AdminRole.MANAGER)
      method() {}
    }
    expect(Reflect.getMetadata(ROLES_KEY, Target.prototype.method)).toEqual([
      AdminRole.OWNER,
      AdminRole.MANAGER,
    ]);
  });

  it('marks a handler public under the isPublic key', () => {
    class Target {
      @Public()
      method() {}
    }
    expect(Reflect.getMetadata('isPublic', Target.prototype.method)).toBe(true);
  });
});

describe('RolesGuard', () => {
  let reflector: ReturnType<typeof mockDeep<Reflector>>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = mockDeep<Reflector>();
    guard = new RolesGuard(reflector);
  });

  const requireRoles = (roles: AdminRole[] | undefined) =>
    reflector.getAllAndOverride.mockReturnValue(roles as never);

  it('admits a user holding a required role', () => {
    requireRoles([AdminRole.OWNER, AdminRole.MANAGER]);
    expect(guard.canActivate(contextFor({ role: AdminRole.MANAGER }))).toBe(
      true,
    );
  });

  it('rejects a user whose role is not required', () => {
    requireRoles([AdminRole.OWNER]);
    expect(() =>
      guard.canActivate(contextFor({ role: AdminRole.VIEWER })),
    ).toThrow(ForbiddenException);
  });

  it('explains why access was refused', () => {
    requireRoles([AdminRole.OWNER]);
    expect(() =>
      guard.canActivate(contextFor({ role: AdminRole.VIEWER })),
    ).toThrow('Insufficient role');
  });

  it('rejects a request carrying no role', () => {
    requireRoles([AdminRole.OWNER]);
    expect(() => guard.canActivate(contextFor({}))).toThrow(ForbiddenException);
  });

  it('rejects a request with no user at all', () => {
    requireRoles([AdminRole.OWNER]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });

  // An endpoint with no @Roles() is role-agnostic; the actor guard still runs.
  it('admits any role when the handler declares none', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor({ role: AdminRole.VIEWER }))).toBe(
      true,
    );
  });

  it('admits any role when @Roles() was given an empty list', () => {
    requireRoles([]);
    expect(guard.canActivate(contextFor({ role: AdminRole.VIEWER }))).toBe(
      true,
    );
  });

  // Handler metadata must win over class metadata, so a single endpoint can
  // tighten the restriction its controller declares.
  it('reads roles from the handler and the controller, handler first', () => {
    requireRoles([AdminRole.OWNER]);
    guard.canActivate(contextFor({ role: AdminRole.OWNER }));

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      handler,
      Controller,
    ]);
  });

  it.each([AdminRole.OWNER, AdminRole.MANAGER, AdminRole.VIEWER])(
    'admits %s when it is the only role required',
    (role) => {
      requireRoles([role]);
      expect(guard.canActivate(contextFor({ role }))).toBe(true);
    },
  );
});

describe('JwtAuthGuard', () => {
  let reflector: ReturnType<typeof mockDeep<Reflector>>;
  let guard: JwtAuthGuard;
  let passport: jest.SpyInstance;

  beforeEach(() => {
    reflector = mockDeep<Reflector>();
    guard = new JwtAuthGuard(reflector);
    const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as object;
    passport = jest
      .spyOn(superProto as { canActivate: () => unknown }, 'canActivate')
      .mockReturnValue(true);
  });

  afterEach(() => passport.mockRestore());

  it('skips token verification on a public handler', () => {
    reflector.getAllAndOverride.mockReturnValue(true as never);

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });

  it('verifies the token when the handler is not public', () => {
    reflector.getAllAndOverride.mockReturnValue(false as never);

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
    expect(passport).toHaveBeenCalledTimes(1);
  });

  it('verifies the token when no public metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined as never);

    void guard.canActivate(contextFor(undefined));
    expect(passport).toHaveBeenCalledTimes(1);
  });
});
