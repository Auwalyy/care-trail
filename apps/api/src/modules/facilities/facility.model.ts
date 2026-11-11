import { Schema, model, type Types } from 'mongoose';

/** Healthcare facility. CRUD endpoints arrive in Phase 3; users reference facilities now. */
export interface FacilityDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  name: string;
  code: string;
  type: 'phc' | 'general_hospital' | 'other';
  lga: string;
  ward?: string | null;
  address?: string | null;
  phone?: string | null;
  status: 'active' | 'inactive';
  deletedAt?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const facilitySchema = new Schema<FacilityDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 30 },
    type: { type: String, enum: ['phc', 'general_hospital', 'other'], default: 'phc' },
    lga: { type: String, required: true, trim: true, maxlength: 80 },
    ward: { type: String, default: null },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    deletedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'facilities', versionKey: false },
);

facilitySchema.index({ organisationId: 1, code: 1 }, { unique: true });

export const FacilityModel = model<FacilityDoc>('Facility', facilitySchema);
