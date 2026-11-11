import { Schema, model, type Types } from 'mongoose';

/** Community / catchment area. CRUD endpoints arrive in Phase 3; CHWs reference communities now. */
export interface CommunityDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  name: string;
  lga: string;
  ward?: string | null;
  status: 'active' | 'inactive';
  deletedAt?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const communitySchema = new Schema<CommunityDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    lga: { type: String, required: true, trim: true, maxlength: 80 },
    ward: { type: String, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    deletedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'communities', versionKey: false },
);

communitySchema.index({ organisationId: 1, lga: 1, name: 1 }, { unique: true });

export const CommunityModel = model<CommunityDoc>('Community', communitySchema);
