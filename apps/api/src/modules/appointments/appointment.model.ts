import { Schema, model, type Types } from 'mongoose';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_STATUSES, type AppointmentCategory, type AppointmentStatus } from '@caretrail/shared-types';

interface StepDoc {
  at: Date;
  by: Types.ObjectId;
}

export interface AppointmentDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  clientId?: string | null;
  patientId: Types.ObjectId;
  facilityId: Types.ObjectId;
  category: AppointmentCategory;
  scheduledFor: string; // YYYY-MM-DD
  status: AppointmentStatus;
  attendance: StepDoc | null;
  cancellation: (StepDoc & { reason: string }) | null;
  reschedules: (StepDoc & { from: string; to: string })[];
  missedDetectedAt: Date | null;
  createdBy: Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const step = { at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } };

const appointmentSchema = new Schema<AppointmentDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    clientId: { type: String, default: undefined },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    category: { type: String, enum: APPOINTMENT_CATEGORIES, required: true },
    scheduledFor: { type: String, required: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled' },
    attendance: { type: new Schema(step, { _id: false }), default: null },
    cancellation: { type: new Schema({ ...step, reason: String }, { _id: false }), default: null },
    reschedules: { type: [new Schema({ ...step, from: String, to: String }, { _id: false })], default: [] },
    missedDetectedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'appointments', versionKey: false },
);

appointmentSchema.index({ organisationId: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
appointmentSchema.index({ status: 1, scheduledFor: 1 }); // missed-care check
appointmentSchema.index({ facilityId: 1, scheduledFor: 1 });
appointmentSchema.index({ patientId: 1, scheduledFor: -1 });
appointmentSchema.index({ organisationId: 1, status: 1, scheduledFor: 1 });

export const AppointmentModel = model<AppointmentDoc>('Appointment', appointmentSchema);
