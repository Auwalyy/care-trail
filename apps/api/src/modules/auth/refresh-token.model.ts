import { Schema, model, type Types } from 'mongoose';
import type { AuthClient } from '@caretrail/shared-types';

export type RefreshRevokeReason =
  | 'rotated'
  | 'superseded_retry'
  | 'reuse_detected'
  | 'logout'
  | 'logout_all'
  | 'session_revoked';

export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** All tokens descending from one login share a family; reuse of a rotated token kills it. */
  familyId: string;
  parentId?: Types.ObjectId | null;
  /** SHA-256 of the opaque token — the token itself is never stored. */
  tokenHash: string;
  client: AuthClient;
  deviceId?: string | null;
  /** User.sessionVersion at issue time; a mismatch means the session was revoked. */
  sessionVersion: number;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedReason?: RefreshRevokeReason | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, default: null },
    tokenHash: { type: String, required: true },
    client: { type: String, enum: ['web', 'mobile'], required: true },
    deviceId: { type: String, default: null },
    sessionVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'refresh_tokens', versionKey: false },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ familyId: 1 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ parentId: 1 });
// MongoDB removes documents once expired; revoked tokens are kept until then for reuse detection.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);
