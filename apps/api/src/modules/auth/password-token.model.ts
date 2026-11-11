import { Schema, model, type Types } from 'mongoose';

export type PasswordTokenPurpose = 'activation' | 'reset';

/** Single-use activation / password-reset tokens. Only the SHA-256 hash is stored. */
export interface PasswordTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: PasswordTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  issuedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const passwordTokenSchema = new Schema<PasswordTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['activation', 'reset'], required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'password_tokens', versionKey: false },
);

passwordTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordTokenSchema.index({ userId: 1, usedAt: 1 });
passwordTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordTokenModel = model<PasswordTokenDoc>('PasswordToken', passwordTokenSchema);
