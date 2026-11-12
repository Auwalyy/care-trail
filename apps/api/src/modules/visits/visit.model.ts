import { Schema, model, type Types } from 'mongoose';
import { VISIT_OUTCOMES, type VisitOutcome } from '@caretrail/shared-types';

/** A community visit by a CHW. Operational facts only — no clinical findings. */
export interface VisitDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  clientId?: string | null;
  patientId: Types.ObjectId;
  chwId: Types.ObjectId;
  visitDate: string; // YYYY-MM-DD (device date of the visit)
  outcome: VisitOutcome;
  followUpRequired: boolean;
  nextActivityDate: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const visitSchema = new Schema<VisitDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    clientId: { type: String, default: undefined },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    chwId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visitDate: { type: String, required: true },
    outcome: { type: String, enum: VISIT_OUTCOMES, required: true },
    followUpRequired: { type: Boolean, default: false },
    nextActivityDate: { type: String, default: null },
    notes: { type: String, default: null, maxlength: 500 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'visits', versionKey: false },
);

visitSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
visitSchema.index({ patientId: 1, visitDate: -1 });
visitSchema.index({ chwId: 1, updatedAt: 1 });

export const VisitModel = model<VisitDoc>('Visit', visitSchema);
