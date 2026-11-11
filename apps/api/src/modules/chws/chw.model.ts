import { Schema, model, type Types } from 'mongoose';

/**
 * Programme profile of a community health worker. Identity, status and community assignment live
 * on the user (they drive authentication and data scope); this holds the programme data.
 */
export interface ChwProfileDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  organisationId: Types.ObjectId;
  programmeAreas: string[];
  /** Referral issuing is a per-CHW authorisation granted by the programme (decision A6). */
  canIssueReferrals: boolean;
  supervisorUserId?: Types.ObjectId | null;
  device: {
    lastSyncAt?: Date | null;
    appVersion?: string | null;
    pendingOperations?: number | null;
  };
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const chwProfileSchema = new Schema<ChwProfileDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    programmeAreas: { type: [String], default: [] },
    canIssueReferrals: { type: Boolean, default: false },
    supervisorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    device: {
      lastSyncAt: { type: Date, default: null },
      appVersion: { type: String, default: null },
      pendingOperations: { type: Number, default: null },
    },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'chws', versionKey: false },
);

chwProfileSchema.index({ userId: 1 }, { unique: true });
chwProfileSchema.index({ organisationId: 1 });

export const ChwProfileModel = model<ChwProfileDoc>('ChwProfile', chwProfileSchema);
