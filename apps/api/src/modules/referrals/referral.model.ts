import { Schema, model, type Types } from 'mongoose';
import { REFERRAL_PRIORITIES, REFERRAL_STATUSES, type ReferralPriority, type ReferralStatus } from '@caretrail/shared-types';

interface StepDoc {
  at: Date;
  by: Types.ObjectId;
}

export interface InstructionSnapshotDoc {
  templateId: Types.ObjectId;
  title: string;
  body: string;
  bodyHa: string | null;
  templateVersion: number;
}

/** A closed-loop referral. Status changes only through ReferralService (state machine + events). */
export interface ReferralDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  referralCode: string;
  clientId?: string | null;
  patientId: Types.ObjectId;
  origin: { type: 'community' | 'facility'; communityId: Types.ObjectId | null; facilityId: Types.ObjectId | null };
  toFacilityId: Types.ObjectId;
  issuedBy: Types.ObjectId;
  issuedByRole: string;
  issuedAt: Date;
  expectedArrivalBy: string; // YYYY-MM-DD
  reason: string;
  instructions: InstructionSnapshotDoc[];
  priority: ReferralPriority | null;
  status: ReferralStatus;
  arrival: StepDoc | null;
  service: (StepDoc & { summary: string }) | null;
  completion: StepDoc | null;
  followUpNote: string | null;
  cancellation: (StepDoc & { reason: string }) | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const step = { at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } };

const referralSchema = new Schema<ReferralDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    referralCode: { type: String, required: true },
    clientId: { type: String, default: undefined },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    origin: {
      type: { type: String, enum: ['community', 'facility'], required: true },
      communityId: { type: Schema.Types.ObjectId, ref: 'Community', default: null },
      facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    },
    toFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedByRole: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expectedArrivalBy: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    instructions: {
      type: [
        new Schema<InstructionSnapshotDoc>(
          {
            templateId: { type: Schema.Types.ObjectId, required: true },
            title: { type: String, required: true },
            body: { type: String, required: true },
            bodyHa: { type: String, default: null },
            templateVersion: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    priority: { type: String, enum: [...REFERRAL_PRIORITIES, null], default: null },
    status: { type: String, enum: REFERRAL_STATUSES, required: true, default: 'issued' },
    arrival: { type: new Schema(step, { _id: false }), default: null },
    service: { type: new Schema({ ...step, summary: String }, { _id: false }), default: null },
    completion: { type: new Schema(step, { _id: false }), default: null },
    followUpNote: { type: String, default: null },
    cancellation: { type: new Schema({ ...step, reason: String }, { _id: false }), default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'referrals', versionKey: false },
);

referralSchema.index({ referralCode: 1 }, { unique: true });
referralSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
referralSchema.index({ toFacilityId: 1, status: 1, expectedArrivalBy: 1 });
referralSchema.index({ organisationId: 1, status: 1, issuedAt: -1 });
referralSchema.index({ patientId: 1, issuedAt: -1 });
referralSchema.index({ issuedBy: 1, issuedAt: -1 });

export const ReferralModel = model<ReferralDoc>('Referral', referralSchema);
