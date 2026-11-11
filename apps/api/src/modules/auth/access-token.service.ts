import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { isRole, type AuthClient, type Role } from '@caretrail/shared-types';
import type { Env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';

export interface AccessClaims {
  userId: string;
  role: Role;
  sessionVersion: number;
  client: AuthClient;
}

const AUDIENCE = 'caretrail';

/** Short-lived HS256 access tokens. The secret never leaves the API. */
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(private readonly env: Pick<Env, 'JWT_ACCESS_SECRET' | 'JWT_ACCESS_TTL_SECONDS' | 'JWT_ISSUER'>) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async sign(claims: AccessClaims, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.env.JWT_ACCESS_TTL_SECONDS;
    const token = await new SignJWT({ role: claims.role, sv: claims.sessionVersion, cl: claims.client })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.env.JWT_ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, role, sv, cl } = payload as { sub?: unknown; role?: unknown; sv?: unknown; cl?: unknown };
      if (typeof sub !== 'string' || !isRole(role) || typeof sv !== 'number' || (cl !== 'web' && cl !== 'mobile')) {
        throw new Error('malformed claims');
      }
      return { userId: sub, role, sessionVersion: sv, client: cl };
    } catch {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }
  }
}
