import { Schema, model, type Types } from 'mongoose';
import { CONTACT_METHODS, FOLLOW_UP_REASONS, FOLLOW_UP_STATUSES, type ContactMethod, type FollowUpReason, type FollowUpStatus } from '@caretrail/shared-types';

export interface ContactAttemptDoc {
  at: Date;
  by: Types.ObjectId;
  method: ContactMethod;
  reached: boolean;
  response: string | null;
}

export interface FollowUpTaskDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  clientId?: string | null;
  patientId: Types.ObjectId;
  assignedChwId: Types.ObjectId;
  source: { type: 'appointment' | 'referral' | 'manual'; id: Types.ObjectId | null };
  reason: FollowUpReason;
  status: FollowUpStatus;
  dueOn: string; // YYYY-MM-DD
  note: string | null;
  attempts: ContactAttemptDoc[];
  outcome: string | null;
  nextAction: string | null;
  escalation: { at: Date; by: Types.ObjectId; to: Types.ObjectId[]; notes: string } | null;
  /**
   * `${source.type}:${source.id}:${reason}` while the task is open, unset once resolved. Unique, so
   * the missed-care check can run any number of times (even concurrently) without duplicating tasks.
   */
  openKey?: string | null;
  createdBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<FollowUpTaskDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    clientId: { type: String, default: undefined },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    assignedChwId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    source: {
      type: { type: String, enum: ['appointment', 'referral', 'manual'], required: true },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    reason: { type: String, enum: FOLLOW_UP_REASONS, required: true },
    status: { type: String, enum: FOLLOW_UP_STATUSES, default: 'assigned' },
    dueOn: { type: String, required: true },
    note: { type: String, default: null },
    attempts: {
      type: [
        new Schema<ContactAttemptDoc>(
          {
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            method: { type: String, enum: CONTACT_METHODS, required: true },
            reached: { type: Boolean, required: true },
            response: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    outcome: { type: String, default: null },
    nextAction: { type: String, default: null },
    escalation: {
      type: new Schema({ at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' }, to: [Schema.Types.ObjectId], notes: String }, { _id: false }),
      default: null,
    },
    openKey: { type: String, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'follow_up_tasks', versionKey: false },
);

taskSchema.index({ openKey: 1 }, { unique: true, partialFilterExpression: { openKey: { $type: 'string' } } });
taskSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
taskSchema.index({ organisationId: 1, assignedChwId: 1, status: 1, dueOn: 1 });
taskSchema.index({ patientId: 1, createdAt: -1 });
taskSchema.index({ 'escalation.to': 1, status: 1 });

export const FollowUpTaskModel = model<FollowUpTaskDoc>('FollowUpTask', taskSchema);

export const openKeyFor = (type: string, id: Types.ObjectId | null, reason: FollowUpReason) => `${type}:${id ? String(id) : 'none'}:${reason}`;
