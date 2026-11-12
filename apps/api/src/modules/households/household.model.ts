import { Schema, model, type Types } from 'mongoose';

export interface HouseholdDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  communityId: Types.ObjectId;
  householdCode: string;
  clientId?: string | null;
  headName?: string | null;
  /** Directions a CHW would use ("behind the Juma'at mosque") — no GPS is collected. */
  landmark?: string | null;
  phone?: string | null;
  createdBy: Types.ObjectId;
  deletedAt?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const householdSchema = new Schema<HouseholdDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    communityId: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    householdCode: { type: String, required: true },
    clientId: { type: String, default: undefined },
    headName: { type: String, default: null },
    landmark: { type: String, default: null },
    phone: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'households', versionKey: false },
);

householdSchema.index({ organisationId: 1, householdCode: 1 }, { unique: true });
householdSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
householdSchema.index({ organisationId: 1, communityId: 1 });

export const HouseholdModel = model<HouseholdDoc>('Household', householdSchema);
