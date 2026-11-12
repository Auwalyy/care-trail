import { Schema, model, type Types } from 'mongoose';
import { CONSENT_METHODS, LANGUAGES, type ConsentMethod, type ConsentPurpose, type Language } from '@caretrail/shared-types';

/**
 * Append-only record of a consent conversation. Each record states every purpose explicitly
 * (granted or not); the patient's current consent is the latest record.
 */
export interface ConsentRecordDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  patientId: Types.ObjectId;
  purposes: Record<ConsentPurpose, boolean>;
  method: ConsentMethod;
  /** Version reference of the programme-approved wording that was read to the patient. */
  consentTextVersion: string;
  language: Language;
  witnessName?: string | null;
  recordedBy: Types.ObjectId;
  recordedAt: Date;
  clientId?: string | null;
}

const consentSchema = new Schema<ConsentRecordDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    purposes: {
      care_coordination: { type: Boolean, required: true },
      sms: { type: Boolean, required: true },
      voice: { type: Boolean, required: true },
      facility_sharing: { type: Boolean, required: true },
    },
    method: { type: String, enum: CONSENT_METHODS, required: true },
    consentTextVersion: { type: String, required: true },
    language: { type: String, enum: LANGUAGES, required: true },
    witnessName: { type: String, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, required: true },
    clientId: { type: String, default: undefined },
  },
  { collection: 'consent_records', versionKey: false },
);

consentSchema.index({ patientId: 1, recordedAt: -1 });
consentSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  consentSchema.pre(op, function () {
    throw new Error('consent_records is append-only');
  });
}

export const ConsentRecordModel = model<ConsentRecordDoc>('ConsentRecord', consentSchema);
