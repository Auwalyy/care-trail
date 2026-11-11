import { randomUUID } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import type { AuthClient } from '@caretrail/shared-types';
import { sha256, randomToken } from '../../utils/crypto.js';
import { RefreshTokenModel, type RefreshRevokeReason, type RefreshTokenDoc } from './refresh-token.model.js';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  doc: RefreshTokenDoc;
}

export type RotationResult =
  | { kind: 'rotated'; previous: RefreshTokenDoc; next: IssuedRefreshToken }
  | { kind: 'invalid' }
  | { kind: 'expired'; previous: RefreshTokenDoc }
  | { kind: 'reuse_detected'; previous: RefreshTokenDoc };

/**
 * A rotated token presented again within this window is treated as a client retry after a lost
 * response (common on poor rural networks), not as theft: the successor issued earlier is revoked
 * and a fresh one issued. Outside the window, reuse revokes the whole token family.
 */
export const ROTATION_GRACE_MS = 30_000;

export class SessionService {
  constructor(private readonly ttlDays: number) {}

  private expiry(now: Date): Date {
    return new Date(now.getTime() + this.ttlDays * 86_400_000);
  }

  async issue(
    params: {
      userId: Types.ObjectId;
      client: AuthClient;
      deviceId?: string | null;
      sessionVersion: number;
      familyId?: string;
      parentId?: Types.ObjectId | null;
    },
    now: Date,
    session?: ClientSession,
  ): Promise<IssuedRefreshToken> {
    const token = randomToken();
    const expiresAt = this.expiry(now); // sliding expiry: CHWs may be offline for long periods
    const [doc] = await RefreshTokenModel.create(
      [
        {
          userId: params.userId,
          familyId: params.familyId ?? randomUUID(),
          parentId: params.parentId ?? null,
          tokenHash: sha256(token),
          client: params.client,
          deviceId: params.deviceId ?? null,
          sessionVersion: params.sessionVersion,
          expiresAt,
        },
      ],
      session ? { session } : {},
    );
    return { token, expiresAt, doc: doc!.toObject() };
  }

  async find(token: string): Promise<RefreshTokenDoc | null> {
    return RefreshTokenModel.findOne({ tokenHash: sha256(token) }).lean<RefreshTokenDoc>();
  }

  /** Validates and rotates a refresh token. Does not check the user — the caller does. */
  async rotate(token: string, now: Date): Promise<RotationResult> {
    const current = await this.find(token);
    if (!current) return { kind: 'invalid' };
    if (current.expiresAt <= now) return { kind: 'expired', previous: current };

    if (!current.revokedAt) {
      // Atomic claim: only one concurrent request can rotate a given token.
      const claimed = await RefreshTokenModel.findOneAndUpdate(
        { _id: current._id, revokedAt: null },
        { $set: { revokedAt: now, revokedReason: 'rotated' } },
        { returnDocument: 'after' },
      ).lean<RefreshTokenDoc>();
      if (claimed) {
        const next = await this.issue(
          { ...this.lineage(claimed), parentId: claimed._id },
          now,
        );
        return { kind: 'rotated', previous: claimed, next };
      }
      // Lost the race: fall through and treat as a re-presented rotated token.
      return this.rotate(token, now);
    }

    const withinGrace =
      current.revokedReason === 'rotated' && now.getTime() - current.revokedAt.getTime() <= ROTATION_GRACE_MS;
    if (withinGrace) {
      await RefreshTokenModel.updateMany(
        { parentId: current._id, revokedAt: null },
        { $set: { revokedAt: now, revokedReason: 'superseded_retry' } },
      );
      const next = await this.issue({ ...this.lineage(current), parentId: current._id }, now);
      return { kind: 'rotated', previous: current, next };
    }

    if (current.revokedReason === 'rotated' || current.revokedReason === 'superseded_retry') {
      await this.revokeFamily(current.familyId, 'reuse_detected', now);
      return { kind: 'reuse_detected', previous: current };
    }
    return { kind: 'invalid' };
  }

  async revokeFamily(familyId: string, reason: RefreshRevokeReason, now: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: now, revokedReason: reason } },
    );
  }

  async revokeAllForUser(
    userId: Types.ObjectId,
    reason: RefreshRevokeReason,
    now: Date,
    session?: ClientSession,
  ): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: now, revokedReason: reason } },
      session ? { session } : {},
    );
  }

  private lineage(doc: RefreshTokenDoc) {
    return {
      userId: doc.userId,
      client: doc.client,
      deviceId: doc.deviceId ?? null,
      sessionVersion: doc.sessionVersion,
      familyId: doc.familyId,
    };
  }
}
