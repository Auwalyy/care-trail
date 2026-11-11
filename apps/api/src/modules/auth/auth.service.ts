import mongoose, { type Types } from 'mongoose';
import { ROLE_PERMISSIONS, type AuthClient, type AuthenticatedUser, type LoginResponse } from '@caretrail/shared-types';
import type { LoginInput, ResetPasswordInput } from '@caretrail/validation';
import type { Env } from '../../config/env.js';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import type { Logger } from '../../utils/logger.js';
import type { AuditService } from '../audit/audit.service.js';
import { toUserDto } from '../users/user.mapper.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import type { AccessTokenService } from './access-token.service.js';
import type { PasswordHasher } from './password-hasher.js';
import type { PasswordLinkNotifier } from './password-link-notifier.js';
import { LINK_TTL_MS, type PasswordLinkService } from './password-link.service.js';
import type { SessionService } from './session.service.js';

export interface IssuedSession {
  response: LoginResponse;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthServiceDeps {
  env: Pick<Env, 'LOGIN_MAX_FAILED_ATTEMPTS' | 'LOGIN_LOCKOUT_MINUTES'>;
  logger: Logger;
  audit: AuditService;
  hasher: PasswordHasher;
  accessTokens: AccessTokenService;
  sessions: SessionService;
  links: PasswordLinkService;
  notifier: PasswordLinkNotifier;
  now?: () => Date;
}

const INVALID_CREDENTIALS = 'Email or password is incorrect. Too many failed attempts pause sign-in for a while.';

export function toAuthenticatedUser(user: UserDoc): AuthenticatedUser {
  return { ...toUserDto(user), permissions: [...ROLE_PERMISSIONS[user.role]] };
}

export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<IssuedSession> {
    const { audit, hasher, env } = this.deps;
    const now = this.now();
    const user = await UserModel.findOne({ email: input.email }).select('+passwordHash').lean<UserDoc>();

    if (!user) {
      await hasher.verifyDummy(input.password);
      await audit.record({ action: 'auth.login', outcome: 'failure', metadata: { reason: 'unknown_account' } }, ctx);
      throw AppError.unauthenticated(INVALID_CREDENTIALS);
    }

    const actor = { id: user._id, role: user.role, organisationId: user.organisationId ?? null };
    const fail = async (reason: string) => {
      await audit.record({ action: 'auth.login', outcome: 'failure', actor, entityType: 'user', entityId: user._id, metadata: { reason } }, ctx);
      throw AppError.unauthenticated(INVALID_CREDENTIALS);
    };

    if (user.lockedUntil && user.lockedUntil > now) {
      await hasher.verifyDummy(input.password);
      return fail('locked');
    }
    if (user.status !== 'active' || !user.passwordHash) {
      await hasher.verifyDummy(input.password);
      return fail(user.status === 'active' ? 'no_password' : user.status);
    }

    if (!(await hasher.verify(user.passwordHash, input.password))) {
      const updated = await UserModel.findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedLoginCount: 1 } },
        { returnDocument: 'after' },
      ).lean<UserDoc>();
      if (updated && updated.failedLoginCount >= env.LOGIN_MAX_FAILED_ATTEMPTS) {
        await UserModel.updateOne(
          { _id: user._id },
          { $set: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + env.LOGIN_LOCKOUT_MINUTES * 60_000) } },
        );
        await audit.record({ action: 'auth.lockout', outcome: 'failure', actor, entityType: 'user', entityId: user._id }, ctx);
      }
      return fail('bad_password');
    }

    const fresh = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } },
      { returnDocument: 'after' },
    ).lean<UserDoc>();
    const session = await this.issueSession(fresh!, input.client, input.deviceId ?? null, now);
    await audit.record(
      { action: 'auth.login', actor, entityType: 'user', entityId: user._id, metadata: { client: input.client } },
      ctx,
    );
    return session;
  }

  async refresh(refreshToken: string | undefined, ctx: RequestContext): Promise<IssuedSession> {
    if (!refreshToken) throw AppError.unauthenticated('Please sign in.');
    const now = this.now();
    const result = await this.deps.sessions.rotate(refreshToken, now);

    if (result.kind === 'reuse_detected') {
      await this.deps.audit.record(
        {
          action: 'auth.refresh_reuse',
          outcome: 'failure',
          entityType: 'user',
          entityId: result.previous.userId,
          metadata: { familyRevoked: true },
        },
        ctx,
      );
      throw AppError.unauthenticated('Your session is no longer valid. Please sign in again.');
    }
    if (result.kind !== 'rotated') throw AppError.unauthenticated('Your session has expired. Please sign in again.');

    const user = await UserModel.findById(result.next.doc.userId).lean<UserDoc>();
    if (!user || user.status !== 'active' || user.sessionVersion !== result.next.doc.sessionVersion) {
      await this.deps.sessions.revokeFamily(result.next.doc.familyId, 'session_revoked', now);
      throw AppError.unauthenticated('Your session is no longer valid. Please sign in again.');
    }

    const access = await this.deps.accessTokens.sign(
      { userId: String(user._id), role: user.role, sessionVersion: user.sessionVersion, client: result.next.doc.client },
      now,
    );
    return this.sessionResponse(user, access, result.next.token, result.next.expiresAt, result.next.doc.client);
  }

  /** Revokes the session family of the given token; with allDevices, every session of the user. */
  async logout(refreshToken: string | undefined, allDevices: boolean, ctx: RequestContext): Promise<void> {
    if (!refreshToken) return;
    const now = this.now();
    const doc = await this.deps.sessions.find(refreshToken);
    if (!doc) return;
    if (allDevices) {
      await UserModel.updateOne({ _id: doc.userId }, { $inc: { sessionVersion: 1 } });
      await this.deps.sessions.revokeAllForUser(doc.userId, 'logout_all', now);
    } else {
      await this.deps.sessions.revokeFamily(doc.familyId, 'logout', now);
    }
    await this.deps.audit.record(
      { action: allDevices ? 'auth.logout_all' : 'auth.logout', entityType: 'user', entityId: doc.userId, actor: undefined },
      ctx,
    );
  }

  /** Always resolves the same way whether or not the account exists (no account enumeration). */
  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    const now = this.now();
    const user = await UserModel.findOne({ email }).lean<UserDoc>();
    if (!user || user.status !== 'active') {
      await this.deps.audit.record({ action: 'auth.password_reset_requested', outcome: 'failure', metadata: { reason: user ? user.status : 'unknown_account' } }, ctx);
      return;
    }
    const link = await this.deps.links.issue({ userId: user._id, purpose: 'reset', ttlMs: LINK_TTL_MS.reset }, now);
    const { delivered } = await this.deps.notifier.send({ userId: user._id, email: user.email, purpose: 'reset', ...link });
    await this.deps.audit.record(
      { action: 'auth.password_reset_requested', entityType: 'user', entityId: user._id, organisationId: user.organisationId ?? null, metadata: { delivered } },
      ctx,
    );
  }

  /** Completes activation or reset: sets the password and revokes every existing session. */
  async resetPassword(input: ResetPasswordInput, ctx: RequestContext): Promise<{ activated: boolean }> {
    const now = this.now();
    const passwordHash = await this.deps.hasher.hash(input.password);
    let activated = false;

    await mongoose.connection.transaction(async (session) => {
      const token = await this.deps.links.consume(input.token, now, session);
      if (!token) throw new AppError('VALIDATION_ERROR', 'This link is invalid or has expired. Ask your administrator for a new one.');
      const user = await UserModel.findById(token.userId).session(session).lean<UserDoc>();
      if (!user || user.status === 'inactive') {
        throw new AppError('VALIDATION_ERROR', 'This link is invalid or has expired. Ask your administrator for a new one.');
      }
      activated = user.status === 'pending_activation';
      await UserModel.updateOne(
        { _id: user._id },
        {
          $set: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, status: 'active' },
          $inc: { sessionVersion: 1, version: activated ? 1 : 0 },
        },
        { session },
      );
      await this.deps.sessions.revokeAllForUser(user._id, 'session_revoked', now, session);
      await this.deps.audit.record(
        {
          action: activated ? 'auth.account_activated' : 'auth.password_reset',
          actor: { id: user._id, role: user.role, organisationId: user.organisationId ?? null },
          entityType: 'user',
          entityId: user._id,
          session,
        },
        ctx,
      );
    });
    return { activated };
  }

  /** Changes the password, signs out every other device and returns a fresh session for this one. */
  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const now = this.now();
    const user = await UserModel.findById(auth.userId).select('+passwordHash').lean<UserDoc>();
    if (!user?.passwordHash || !(await this.deps.hasher.verify(user.passwordHash, input.currentPassword))) {
      await this.deps.audit.record({ action: 'auth.password_changed', outcome: 'failure', auth, entityType: 'user', entityId: auth.userId }, ctx);
      throw new AppError('VALIDATION_ERROR', 'Current password is incorrect', [
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    const passwordHash = await this.deps.hasher.hash(input.newPassword);
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { passwordHash, passwordChangedAt: now }, $inc: { sessionVersion: 1 } },
      { returnDocument: 'after' },
    ).lean<UserDoc>();
    await this.deps.sessions.revokeAllForUser(user._id, 'session_revoked', now);
    await this.deps.audit.record({ action: 'auth.password_changed', auth, entityType: 'user', entityId: auth.userId }, ctx);
    return this.issueSession(updated!, auth.client, null, now);
  }

  /** Revokes all sessions of a user (deactivation, admin action). */
  async revokeAllSessions(userId: Types.ObjectId, session?: mongoose.ClientSession): Promise<void> {
    await UserModel.updateOne({ _id: userId }, { $inc: { sessionVersion: 1 } }, session ? { session } : {});
    await this.deps.sessions.revokeAllForUser(userId, 'session_revoked', this.now(), session);
  }

  private async issueSession(user: UserDoc, client: AuthClient, deviceId: string | null, now: Date): Promise<IssuedSession> {
    const refresh = await this.deps.sessions.issue(
      { userId: user._id, client, deviceId, sessionVersion: user.sessionVersion },
      now,
    );
    const access = await this.deps.accessTokens.sign(
      { userId: String(user._id), role: user.role, sessionVersion: user.sessionVersion, client },
      now,
    );
    return this.sessionResponse(user, access, refresh.token, refresh.expiresAt, client);
  }

  private sessionResponse(
    user: UserDoc,
    access: { token: string; expiresAt: Date },
    refreshToken: string,
    refreshExpiresAt: Date,
    client: AuthClient,
  ): IssuedSession {
    const response: LoginResponse = {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: toAuthenticatedUser(user),
    };
    if (client === 'mobile') response.refreshToken = refreshToken;
    return { response, refreshToken, refreshTokenExpiresAt: refreshExpiresAt };
  }
}
