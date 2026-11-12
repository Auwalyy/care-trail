import { Schema, model, type Types } from 'mongoose';
import {
  CARE_PATHWAYS,
  CONTACT_CHANNELS,
  LANGUAGES,
  PATIENT_STATUSES,
  PHONE_OWNERS,
  SEXES,
  type CarePathway,
  type ConsentPurpose,
  type ContactChannel,
  type Language,
  type PatientStatus,
  type PhoneOwner,
  type Sex,
} from '@caretrail/shared-types';

export type ConsentSummaryDoc = Record<ConsentPurpose, { granted: boolean; recordedAt: Date } | null>;

/**
 * A person receiving coordinated care. Only the fields needed for the coordination workflow are
 * stored (data minimisation, NDPA): no diagnoses, findings, or clinical notes.
 */
export interface PatientDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  patientCode: string;
  /** Device-generated id for idempotent offline registration. */
  clientId?: string | null;
  communityId: Types.ObjectId;
  householdId?: Types.ObjectId | null;
  assignedChwId: Types.ObjectId;
  fullName: string;
  /** Normalised name for duplicate detection (see nameKey). */
  nameKey: string;
  sex: Sex;
  dateOfBirth?: string | null; // YYYY-MM-DD
  estimatedBirthYear?: number | null;
  /** Derived from either of the above; indexed for duplicate detection. */
  birthYear: number;
  phone?: string | null;
  alternatePhone?: string | null;
  phoneOwner: PhoneOwner;
  carePathway: CarePathway;
  pathwayDetails: {
    expectedDeliveryDate: string | null;
    deliveryDate: string | null;
    motherPatientId: Types.ObjectId | null;
  };
  status: PatientStatus;
  statusReason?: string | null;
  preferredLanguage: Language;
  preferredChannel: ContactChannel;
  consent: ConsentSummaryDoc;
  possibleDuplicateOf: Types.ObjectId[];
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  deletedAt?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const consentEntry = { type: new Schema({ granted: Boolean, recordedAt: Date }, { _id: false }), default: null };

const patientSchema = new Schema<PatientDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    patientCode: { type: String, required: true },
    clientId: { type: String, default: undefined },
    communityId: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    householdId: { type: Schema.Types.ObjectId, ref: 'Household', default: null },
    assignedChwId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true },
    sex: { type: String, enum: SEXES, required: true },
    dateOfBirth: { type: String, default: null },
    estimatedBirthYear: { type: Number, default: null },
    birthYear: { type: Number, required: true },
    phone: { type: String, default: null },
    alternatePhone: { type: String, default: null },
    phoneOwner: { type: String, enum: PHONE_OWNERS, default: 'none' },
    carePathway: { type: String, enum: CARE_PATHWAYS, required: true },
    pathwayDetails: {
      expectedDeliveryDate: { type: String, default: null },
      deliveryDate: { type: String, default: null },
      motherPatientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    },
    status: { type: String, enum: PATIENT_STATUSES, default: 'active' },
    statusReason: { type: String, default: null },
    preferredLanguage: { type: String, enum: LANGUAGES, default: 'ha' },
    preferredChannel: { type: String, enum: CONTACT_CHANNELS, default: 'none' },
    consent: {
      care_coordination: consentEntry,
      sms: consentEntry,
      voice: consentEntry,
      facility_sharing: consentEntry,
    },
    possibleDuplicateOf: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'patients', versionKey: false },
);

patientSchema.index({ organisationId: 1, patientCode: 1 }, { unique: true });
patientSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
patientSchema.index({ organisationId: 1, assignedChwId: 1, status: 1 });
patientSchema.index({ organisationId: 1, communityId: 1, status: 1 });
patientSchema.index({ organisationId: 1, nameKey: 1, birthYear: 1 });
patientSchema.index({ organisationId: 1, phone: 1 });
patientSchema.index({ householdId: 1 });

export const PatientModel = model<PatientDoc>('Patient', patientSchema);
