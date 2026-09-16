import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { TOKENS } from 'src/common/constants/tokens';
import { CartService } from '../orders/cart.service';
import { IStoreRepository } from '../stores/interfaces/store.repository.interface';
import { IStoreUserRepository } from '../store-users/interfaces/store-user.repository.interface';
import { ITenantRepository } from '../tenants/interfaces/tenant.repository.interface';
import { IUserRepository } from '../users/interfaces/user.repository.interface';
import { AuthService } from './auth.service';
import { IRefreshTokenRepository } from './interfaces/refresh-token.repository.interface';
import { IStoreUserRefreshTokenRepository } from './interfaces/store-user-refresh-token.repository.interface';

// Real bcrypt would add ~300ms per hash; the cost factor is asserted instead.
jest.mock('bcryptjs');
const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;

const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';
const STORE_ID = 'store-1';
const STORE_SLUG = 'my-store';

/** Nth argument of a mock's first call, typed. */
const argOf = <T>(m: jest.Mock, argIndex = 0): T => {
  const calls = m.mock.calls as unknown as T[][];
  return calls[0][argIndex];
};

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: DeepMockProxy<IUserRepository>;
  let refreshTokenRepo: DeepMockProxy<IRefreshTokenRepository>;
  let storeUserRepo: DeepMockProxy<IStoreUserRepository>;
  let storeUserRefreshTokenRepo: DeepMockProxy<IStoreUserRefreshTokenRepository>;
  let storeRepo: DeepMockProxy<IStoreRepository>;
  let tenantRepo: DeepMockProxy<ITenantRepository>;
  let cartService: DeepMockProxy<CartService>;
  let jwt: DeepMockProxy<JwtService>;

  const adminUser = (overrides: Record<string, unknown> = {}) => ({
    id: USER_ID,
    email: 'admin@example.com',
    passwordHash: 'stored-hash',
    role: 'OWNER',
    status: 'ACTIVE',
    tenantId: TENANT_ID,
    mustChangePassword: false,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    userRepo = mockDeep<IUserRepository>();
    refreshTokenRepo = mockDeep<IRefreshTokenRepository>();
    storeUserRepo = mockDeep<IStoreUserRepository>();
    storeUserRefreshTokenRepo = mockDeep<IStoreUserRefreshTokenRepository>();
    storeRepo = mockDeep<IStoreRepository>();
    tenantRepo = mockDeep<ITenantRepository>();
    cartService = mockDeep<CartService>();
    jwt = mockDeep<JwtService>();

    bcryptMock.compare.mockResolvedValue(true as never);
    bcryptMock.hash.mockResolvedValue('new-hash' as never);

    storeRepo.findByAdminUserId.mockResolvedValue([] as never);
    tenantRepo.findStatusById.mockResolvedValue({
      status: TenantStatus.ACTIVE,
    } as never);
    jwt.signAsync.mockImplementation(((payload: { type?: string }) =>
      Promise.resolve(
        payload.type ? 'access-token' : 'refresh-token',
      )) as never);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: TOKENS.UserRepo, useValue: userRepo },
        { provide: TOKENS.RefreshTokenRepo, useValue: refreshTokenRepo },
        { provide: TOKENS.StoreUserRepo, useValue: storeUserRepo },
        {
          provide: TOKENS.StoreUserRefreshTokenRepo,
          useValue: storeUserRefreshTokenRepo,
        },
        { provide: TOKENS.StoreRepo, useValue: storeRepo },
        { provide: TOKENS.TenantRepo, useValue: tenantRepo },
        { provide: JwtService, useValue: jwt },
        { provide: CartService, useValue: cartService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  /** Payload of the nth jwt.signAsync call. */
  const signedPayload = (call: number) => {
    const calls = jwt.signAsync.mock.calls as unknown as Record<
      string,
      unknown
    >[][];
    return calls[call][0];
  };

  describe('adminLogin', () => {
    beforeEach(() => {
      userRepo.findByEmail.mockResolvedValue(adminUser() as never);
    });

    const login = () => service.adminLogin('admin@example.com', 'correct');

    it('rejects an unknown email', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a deactivated account', async () => {
      userRepo.findByEmail.mockResolvedValue(
        adminUser({ status: 'INACTIVE' }) as never,
      );
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // A deactivated account must not even reach the password comparison.
    it('does not verify the password of a deactivated account', async () => {
      userRepo.findByEmail.mockResolvedValue(
        adminUser({ status: 'INACTIVE' }) as never,
      );
      await expect(login()).rejects.toThrow();
      expect(bcryptMock.compare).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      bcryptMock.compare.mockResolvedValue(false as never);
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('compares the supplied password against the stored hash', async () => {
      await login();
      expect(bcryptMock.compare).toHaveBeenCalledWith('correct', 'stored-hash');
    });

    it('issues no refresh token when the password is wrong', async () => {
      bcryptMock.compare.mockResolvedValue(false as never);
      await expect(login()).rejects.toThrow();
      expect(refreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('returns both tokens and the password-change flag', async () => {
      userRepo.findByEmail.mockResolvedValue(
        adminUser({ mustChangePassword: true }) as never,
      );

      await expect(login()).resolves.toEqual({
        access: 'access-token',
        refresh: 'refresh-token',
        mustChangePassword: true,
      });
    });

    describe('token contents', () => {
      it('stamps the admin actor type and role on the access token', async () => {
        await login();
        expect(signedPayload(0)).toMatchObject({
          sub: USER_ID,
          type: 'admin',
          role: 'OWNER',
          tenantId: TENANT_ID,
        });
      });

      it('embeds the stores the admin can reach', async () => {
        storeRepo.findByAdminUserId.mockResolvedValue([
          { id: STORE_ID, name: 'My Store', slug: STORE_SLUG },
        ] as never);

        await login();
        expect(signedPayload(0).stores).toEqual([
          { id: STORE_ID, name: 'My Store', slug: STORE_SLUG },
        ]);
      });

      // The refresh token carries no role or store claims — only identity and
      // the jti used to revoke it.
      it('keeps the refresh token minimal', async () => {
        await login();
        expect(Object.keys(signedPayload(1)).sort()).toEqual(['jti', 'sub']);
      });

      it('persists the refresh token id it just signed', async () => {
        await login();

        const stored = argOf<{ userId: string; tokenId: string }>(
          refreshTokenRepo.create as unknown as jest.Mock,
        );
        expect(stored.userId).toBe(USER_ID);
        expect(signedPayload(1).jti).toBe(stored.tokenId);
      });

      it('issues a different token id on every login', async () => {
        await login();
        const first = signedPayload(1).jti;
        jest.clearAllMocks();
        bcryptMock.compare.mockResolvedValue(true as never);
        jwt.signAsync.mockResolvedValue('t' as never);
        userRepo.findByEmail.mockResolvedValue(adminUser() as never);
        storeRepo.findByAdminUserId.mockResolvedValue([] as never);
        tenantRepo.findStatusById.mockResolvedValue({
          status: TenantStatus.ACTIVE,
        } as never);

        await login();
        expect(signedPayload(1).jti).not.toBe(first);
      });
    });

    describe('tenant status gate', () => {
      it.each([
        TenantStatus.PENDING,
        TenantStatus.SUSPENDED,
        TenantStatus.CANCELED,
      ])('refuses login while the tenant is %s', async (status) => {
        tenantRepo.findStatusById.mockResolvedValue({ status } as never);
        await expect(login()).rejects.toThrow('currently inactive');
      });

      it('allows login for an active tenant', async () => {
        await expect(login()).resolves.toMatchObject({
          access: 'access-token',
        });
      });

      it('refuses login when the tenant record is missing', async () => {
        tenantRepo.findStatusById.mockResolvedValue(null as never);
        await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
      });

      // Platform-level admins carry no tenant, so the gate is skipped.
      it('skips the check for a user with no tenant', async () => {
        userRepo.findByEmail.mockResolvedValue(
          adminUser({ tenantId: null }) as never,
        );

        await expect(login()).resolves.toMatchObject({
          access: 'access-token',
        });
        expect(tenantRepo.findStatusById).not.toHaveBeenCalled();
      });

      it('issues no token to a suspended tenant', async () => {
        tenantRepo.findStatusById.mockResolvedValue({
          status: TenantStatus.SUSPENDED,
        } as never);

        await expect(login()).rejects.toThrow();
        expect(refreshTokenRepo.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('adminRefresh', () => {
    beforeEach(() => {
      jwt.verifyAsync.mockResolvedValue({
        sub: USER_ID,
        jti: 'jti-1',
      } as never);
      refreshTokenRepo.findByTokenId.mockResolvedValue({
        tokenId: 'jti-1',
        revokedAt: null,
      } as never);
      userRepo.findById.mockResolvedValue(adminUser() as never);
    });

    const refresh = () => service.adminRefresh('a.refresh.token');

    it('rejects a token that fails verification', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(refresh()).rejects.toThrow('invalid signature');
    });

    it('rejects a token id it has never issued', async () => {
      refreshTokenRepo.findByTokenId.mockResolvedValue(null);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // Revocation is what makes logout and the billing suspension sweep work.
    it('rejects a revoked token', async () => {
      refreshTokenRepo.findByTokenId.mockResolvedValue({
        tokenId: 'jti-1',
        revokedAt: new Date(),
      } as never);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose user no longer exists', async () => {
      userRepo.findById.mockResolvedValue(null);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses to refresh into a suspended tenant', async () => {
      tenantRepo.findStatusById.mockResolvedValue({
        status: TenantStatus.SUSPENDED,
      } as never);
      await expect(refresh()).rejects.toThrow('currently inactive');
    });

    it('issues a fresh pair for a valid token', async () => {
      await expect(refresh()).resolves.toEqual({
        access: 'access-token',
        refresh: 'refresh-token',
      });
    });

    it('re-reads the role rather than trusting the old token', async () => {
      userRepo.findById.mockResolvedValue(
        adminUser({ role: 'VIEWER' }) as never,
      );
      await refresh();
      expect(signedPayload(0).role).toBe('VIEWER');
    });

    // KNOWN GAP: the presented refresh token is not revoked when a new one is
    // issued, so an intercepted token stays usable until it expires. Rotating
    // would revoke the old jti here.
    it('leaves the presented refresh token usable (no rotation)', async () => {
      await refresh();
      expect(refreshTokenRepo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    beforeEach(() => {
      userRepo.findById.mockResolvedValue(adminUser() as never);
    });

    const change = () => service.changePassword(USER_ID, 'old-pw', 'new-pw');

    it('rejects an unknown user', async () => {
      userRepo.findById.mockResolvedValue(null);
      await expect(change()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an incorrect current password', async () => {
      bcryptMock.compare.mockResolvedValue(false as never);
      await expect(change()).rejects.toThrow('Current password is incorrect');
    });

    it('does not write a new hash when the current password is wrong', async () => {
      bcryptMock.compare.mockResolvedValue(false as never);
      await expect(change()).rejects.toThrow();
      expect(userRepo.updatePassword).not.toHaveBeenCalled();
    });

    it('hashes the new password with a cost factor of 12', async () => {
      await change();
      expect(bcryptMock.hash).toHaveBeenCalledWith('new-pw', 12);
    });

    it('stores the hash, never the password itself', async () => {
      await change();
      expect(userRepo.updatePassword).toHaveBeenCalledWith(USER_ID, 'new-hash');
    });

    it('issues a fresh token pair', async () => {
      await expect(change()).resolves.toEqual({
        access: 'access-token',
        refresh: 'refresh-token',
      });
    });

    // KNOWN GAP: existing refresh tokens survive a password change, so sessions
    // opened with the old password stay alive. Changing a password is the usual
    // remedy for a compromised account, which makes this worth revisiting.
    it('leaves other sessions alive (no revocation sweep)', async () => {
      await change();
      expect(refreshTokenRepo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('adminRevoke', () => {
    it('revokes the token id carried by the refresh token', async () => {
      jwt.verifyAsync.mockResolvedValue({ jti: 'jti-9' } as never);

      await expect(service.adminRevoke('a.token')).resolves.toEqual({
        ok: true,
      });
      expect(refreshTokenRepo.revoke).toHaveBeenCalledWith('jti-9');
    });

    it('revokes nothing when the token does not verify', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
      await expect(service.adminRevoke('a.token')).rejects.toThrow();
      expect(refreshTokenRepo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('storeUserLogin', () => {
    const STORE_USER_ID = 'store-user-1';

    beforeEach(() => {
      storeRepo.findBySlug.mockResolvedValue({ id: STORE_ID } as never);
      storeUserRepo.findByStoreAndEmail.mockResolvedValue({
        id: STORE_USER_ID,
        storeId: STORE_ID,
        passwordHash: 'customer-hash',
      } as never);
    });

    const login = (merge?: { sessionId: string }) =>
      service.storeUserLogin(
        'customer@example.com',
        'correct',
        STORE_SLUG,
        merge,
      );

    it('rejects an unknown store', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(login()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an email not registered at this store', async () => {
      storeUserRepo.findByStoreAndEmail.mockResolvedValue(null);
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      bcryptMock.compare.mockResolvedValue(false as never);
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // Customers are scoped per store: the same address at two stores is two
    // separate accounts, so the lookup must be keyed on both.
    it('looks the customer up within the store', async () => {
      await login();
      expect(storeUserRepo.findByStoreAndEmail).toHaveBeenCalledWith(
        STORE_ID,
        'customer@example.com',
      );
    });

    it('scopes the access token to the store', async () => {
      await login();
      expect(signedPayload(0)).toMatchObject({
        sub: STORE_USER_ID,
        type: 'store_user',
        storeId: STORE_ID,
      });
    });

    it('grants no admin role or store list to a customer', async () => {
      await login();
      expect(signedPayload(0)).not.toHaveProperty('role');
      expect(signedPayload(0)).not.toHaveProperty('stores');
    });

    it('persists the customer refresh token id', async () => {
      await login();

      const stored = argOf<{ storeUserId: string; tokenId: string }>(
        storeUserRefreshTokenRepo.create as unknown as jest.Mock,
      );
      expect(stored.storeUserId).toBe(STORE_USER_ID);
      expect(signedPayload(1).jti).toBe(stored.tokenId);
    });

    describe('guest cart merging', () => {
      it('merges the guest cart when a session id is supplied', async () => {
        await login({ sessionId: 'sid-1' });
        expect(cartService.mergeOnLogin).toHaveBeenCalledWith(
          'sid-1',
          STORE_USER_ID,
          STORE_ID,
        );
      });

      it('merges nothing without a session id', async () => {
        await login();
        expect(cartService.mergeOnLogin).not.toHaveBeenCalled();
      });

      it('does not merge a cart into a failed login', async () => {
        bcryptMock.compare.mockResolvedValue(false as never);
        await expect(login({ sessionId: 'sid-1' })).rejects.toThrow();
        expect(cartService.mergeOnLogin).not.toHaveBeenCalled();
      });
    });

    // Documents an asymmetry with adminLogin: customers of a suspended tenant
    // are not gated here. The billing sweep revokes their refresh tokens
    // instead, so they lose access at refresh rather than at login.
    it('does not consult tenant status for a customer', async () => {
      await login();
      expect(tenantRepo.findStatusById).not.toHaveBeenCalled();
    });
  });

  describe('storeUserSignup', () => {
    const data = { email: 'new@example.com', password: 'pw', firstName: 'Ada' };

    beforeEach(() => {
      storeRepo.findBySlug.mockResolvedValue({ id: STORE_ID } as never);
      storeUserRepo.findByStoreAndEmail.mockResolvedValue(null);
      storeUserRepo.create.mockResolvedValue({
        id: 'store-user-new',
        storeId: STORE_ID,
      } as never);
    });

    const signup = () => service.storeUserSignup(STORE_SLUG, data);

    it('rejects an unknown store', async () => {
      storeRepo.findBySlug.mockResolvedValue(null);
      await expect(signup()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an email already registered at this store', async () => {
      storeUserRepo.findByStoreAndEmail.mockResolvedValue({
        id: 'existing',
      } as never);
      await expect(signup()).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates no account when the email is taken', async () => {
      storeUserRepo.findByStoreAndEmail.mockResolvedValue({
        id: 'existing',
      } as never);
      await expect(signup()).rejects.toThrow();
      expect(storeUserRepo.create).not.toHaveBeenCalled();
    });

    // Uniqueness is per store, so the same address may register at two stores.
    it('checks uniqueness within the store only', async () => {
      await signup();
      expect(storeUserRepo.findByStoreAndEmail).toHaveBeenCalledWith(
        STORE_ID,
        'new@example.com',
      );
    });

    it('hashes the password with a cost factor of 12', async () => {
      await signup();
      expect(bcryptMock.hash).toHaveBeenCalledWith('pw', 12);
    });

    it('stores the hash and never the raw password', async () => {
      await signup();

      const created = argOf<Record<string, unknown>>(
        storeUserRepo.create as unknown as jest.Mock,
      );
      expect(created).toMatchObject({
        storeId: STORE_ID,
        email: 'new@example.com',
        passwordHash: 'new-hash',
      });
      expect(created).not.toHaveProperty('password');
    });

    it('signs the new customer straight in', async () => {
      await expect(signup()).resolves.toEqual({
        access: 'access-token',
        refresh: 'refresh-token',
      });
    });
  });

  describe('storeUserRefresh', () => {
    beforeEach(() => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'store-user-1',
        jti: 'jti-1',
      } as never);
      storeUserRefreshTokenRepo.findByTokenId.mockResolvedValue({
        tokenId: 'jti-1',
        revokedAt: null,
      } as never);
      storeUserRepo.findById.mockResolvedValue({
        id: 'store-user-1',
        storeId: STORE_ID,
      } as never);
    });

    const refresh = () => service.storeUserRefresh('a.token');

    it('rejects a token that fails verification', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(refresh()).rejects.toThrow('invalid signature');
    });

    it('rejects a token id it has never issued', async () => {
      storeUserRefreshTokenRepo.findByTokenId.mockResolvedValue(null);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // This is the path the billing suspension sweep closes off.
    it('rejects a revoked token', async () => {
      storeUserRefreshTokenRepo.findByTokenId.mockResolvedValue({
        tokenId: 'jti-1',
        revokedAt: new Date(),
      } as never);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose customer no longer exists', async () => {
      storeUserRepo.findById.mockResolvedValue(null);
      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // The store comes from the stored customer, not from the presented token,
    // so a tampered token cannot move a customer to another store.
    it('takes the store from the customer record', async () => {
      storeUserRepo.findById.mockResolvedValue({
        id: 'store-user-1',
        storeId: 'store-real',
      } as never);

      await refresh();
      expect(signedPayload(0).storeId).toBe('store-real');
    });

    it('issues a fresh pair for a valid token', async () => {
      await expect(refresh()).resolves.toEqual({
        access: 'access-token',
        refresh: 'refresh-token',
      });
    });
  });

  describe('storeUserRevoke', () => {
    it('revokes the token id carried by the refresh token', async () => {
      jwt.verifyAsync.mockResolvedValue({ jti: 'jti-9' } as never);

      await expect(service.storeUserRevoke('a.token')).resolves.toEqual({
        ok: true,
      });
      expect(storeUserRefreshTokenRepo.revoke).toHaveBeenCalledWith('jti-9');
    });

    it('revokes nothing when the token does not verify', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
      await expect(service.storeUserRevoke('a.token')).rejects.toThrow();
      expect(storeUserRefreshTokenRepo.revoke).not.toHaveBeenCalled();
    });

    // Customer and admin tokens live in separate tables; revoking one must not
    // reach into the other.
    it('does not touch the admin token store', async () => {
      jwt.verifyAsync.mockResolvedValue({ jti: 'jti-9' } as never);
      await service.storeUserRevoke('a.token');
      expect(refreshTokenRepo.revoke).not.toHaveBeenCalled();
    });
  });
});
