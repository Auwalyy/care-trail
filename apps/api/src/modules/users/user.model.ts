import { Schema, model, type Types } from 'mongoose';
import { LANGUAGES, ROLES, USER_STATUSES, type Language, type Role, type UserStatus } from '@caretrail/shared-types';

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  /** Absent until the user activates their account. Never selected by default. */
  passwordHash?: string;
  fullName: string;
  phone?: string | null;
  role: Role;
  status: UserStatus;
  organisationId?: Types.ObjectId | null;
  facilityId?: Types.ObjectId | null;
  communityIds: Types.ObjectId[];
  preferredLanguage: Language;
  /** Incremented to revoke every session (deactivation, password change, logout-all). */
  sessionVersion: number;
  failedLoginCount: number;
  lockedUntil?: Date | null;
  passwordChangedAt?: Date | null;
  lastLoginAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, default: null },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'pending_activation' },
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    communityIds: { type: [Schema.Types.ObjectId], ref: 'Community', default: [] },
    preferredLanguage: { type: String, enum: LANGUAGES, default: 'en' },
    sessionVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'users', versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ organisationId: 1, role: 1, status: 1 });
userSchema.index({ facilityId: 1, role: 1 });
userSchema.index({ organisationId: 1, fullName: 1 });

export const UserModel = model<UserDoc>('User', userSchema);
