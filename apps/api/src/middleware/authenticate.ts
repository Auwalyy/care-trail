import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { ROLE_PERMISSIONS, type Permission } from '@caretrail/shared-types';
import { buildAccessScope } from '../modules/access/access-scope.js';
import type { AccessTokenService } from '../modules/auth/access-token.service.js';
import { UserModel, type UserDoc } from '../modules/users/user.model.js';
import type { AuthContext } from '../types/context.js';
import { AppError } from '../utils/app-error.js';

/**
 * Verifies the bearer token and loads the user on every request, so deactivation and session
 * revocation (sessionVersion bump) take effect immediately rather than when the token expires.
 */
export function createAuthenticate(tokens: AccessTokenService): RequestHandler {
  return async (req, res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw AppError.unauthenticated();
    const claims = await tokens.verify(header.slice(7).trim());
    if (!isValidObjectId(claims.userId)) throw AppError.unauthenticated();

    const user = await UserModel.findById(claims.userId).lean<UserDoc>();
    if (!user || user.status !== 'active' || user.sessionVersion !== claims.sessionVersion || user.role !== claims.role) {
      throw AppError.unauthenticated('Your session is no longer valid. Please sign in again.');
    }

    const auth: AuthContext = {
      user,
      userId: user._id,
      role: user.role,
      permissions: new Set(ROLE_PERMISSIONS[user.role]),
      scope: buildAccessScope(user),
      client: claims.client,
    };
    res.locals.auth = auth;
    next();
  };
}

/** Requires every listed permission. Must run after authenticate. */
export function authorize(...required: Permission[]): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth;
    if (!auth) throw AppError.unauthenticated();
    if (!required.every((p) => auth.permissions.has(p))) throw AppError.forbidden();
    next();
  };
}

/** Narrowing helper for controllers behind `authenticate`. */
export function requireAuth(locals: { auth?: AuthContext }): AuthContext {
  if (!locals.auth) throw AppError.unauthenticated();
  return locals.auth;
}
