import { Schema, model, type Types } from 'mongoose';

/** Tenant boundary. CRUD endpoints arrive in Phase 3; users reference organisations now. */
export interface OrganisationDoc {
  _id: Types.ObjectId;
  name: string;
  code: string;
  status: 'active' | 'inactive';
  state: string;
  contactEmail?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const organisationSchema = new Schema<OrganisationDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    contactEmail: { type: String, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'organisations', versionKey: false },
);

organisationSchema.index({ code: 1 }, { unique: true });

export const OrganisationModel = model<OrganisationDoc>('Organisation', organisationSchema);
