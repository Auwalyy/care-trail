import { Schema, model, type Types } from 'mongoose';
import { REFERRAL_PRIORITIES, REFERRAL_STATUSES, type ReferralPriority, type ReferralStatus } from '@caretrail/shared-types';

/** Append-only history of every referral status transition and priority decision. */
export interface ReferralEventDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  referralId: Types.ObjectId;
  patientId: Types.ObjectId;
  kind: 'status' | 'priority';
  fromStatus: ReferralStatus | null;
  toStatus: ReferralStatus | null;
  priority: ReferralPriority | null;
  actorId: Types.ObjectId | null;
  actorRole: string | null;
  /** Facility of the actor (receiving facility for facility staff). */
  facilityId: Types.ObjectId | null;
  at: Date;
  note: string | null;
  source: 'web' | 'mobile' | 'system';
}

const eventSchema = new Schema<ReferralEventDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, required: true },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['status', 'priority'], required: true },
    fromStatus: { type: String, enum: [...REFERRAL_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...REFERRAL_STATUSES, null], default: null },
    priority: { type: String, enum: [...REFERRAL_PRIORITIES, null], default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    at: { type: Date, required: true },
    note: { type: String, default: null },
    source: { type: String, enum: ['web', 'mobile', 'system'], required: true },
  },
  { collection: 'referral_events', versionKey: false },
);

eventSchema.index({ referralId: 1, at: 1 });
eventSchema.index({ patientId: 1, at: -1 });

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  eventSchema.pre(op, function () {
    throw new Error('referral_events is append-only');
  });
}

export const ReferralEventModel = model<ReferralEventDoc>('ReferralEvent', eventSchema);
