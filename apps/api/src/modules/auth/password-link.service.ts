import type { ClientSession, Types } from 'mongoose';
import type { IssuedLink } from '@caretrail/shared-types';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { PasswordTokenModel, type PasswordTokenDoc, type PasswordTokenPurpose } from './password-token.model.js';

export const LINK_TTL_MS: Record<PasswordTokenPurpose | 'admin_reset', number> = {
  activation: 7 * 86_400_000, // handed over in person to CHWs who may be offline for days
  reset: 60 * 60_000, // self-service reset
  admin_reset: 24 * 60 * 60_000, // reset link issued by an administrator
};

export class PasswordLinkService {
  constructor(private readonly webAppUrl: string) {}

  /** Issues a single-use link and invalidates any earlier unused link for the user. */
  async issue(
    params: { userId: Types.ObjectId; purpose: PasswordTokenPurpose; ttlMs: number; issuedBy?: Types.ObjectId | null },
    now: Date,
    session?: ClientSession,
  ): Promise<IssuedLink> {
    const opts = session ? { session } : {};
    await PasswordTokenModel.deleteMany({ userId: params.userId, usedAt: null }, opts);
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + params.ttlMs);
    await PasswordTokenModel.create(
      [
        {
          userId: params.userId,
          purpose: params.purpose,
          tokenHash: sha256(token),
          expiresAt,
          issuedBy: params.issuedBy ?? null,
        },
      ],
      opts,
    );
    const url = new URL('/reset-password', this.webAppUrl);
    url.searchParams.set('token', token);
    if (params.purpose === 'activation') url.searchParams.set('mode', 'activate');
    return { url: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  /** Marks the token used if valid. Returns null for unknown, used or expired tokens. */
  async consume(token: string, now: Date, session: ClientSession): Promise<PasswordTokenDoc | null> {
    return PasswordTokenModel.findOneAndUpdate(
      { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { returnDocument: 'after', session },
    ).lean<PasswordTokenDoc>();
  }
}
