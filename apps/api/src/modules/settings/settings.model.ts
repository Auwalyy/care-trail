import { Schema, model, type Types } from 'mongoose';

/** Per-organisation programme configuration (pilot targets and operational thresholds). */
export interface ProgrammeSettingsDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  pilot: {
    communities: number | null;
    facilities: number | null;
    chws: number | null;
    patients: number | null;
    durationWeeks: number | null;
    startDate: string | null;
  };
  referralExpectedArrivalDays: number;
  appointmentOverdueGraceDays: number;
  offlineSessionGraceDays: number;
  updatedBy?: Types.ObjectId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ProgrammeSettingsDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    pilot: {
      communities: { type: Number, default: null },
      facilities: { type: Number, default: null },
      chws: { type: Number, default: null },
      patients: { type: Number, default: null },
      durationWeeks: { type: Number, default: null },
      startDate: { type: String, default: null },
    },
    referralExpectedArrivalDays: { type: Number, required: true, min: 1, max: 60 },
    appointmentOverdueGraceDays: { type: Number, required: true, min: 0, max: 14 },
    offlineSessionGraceDays: { type: Number, required: true, min: 1, max: 60 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'programme_settings', versionKey: false },
);

settingsSchema.index({ organisationId: 1 }, { unique: true });

export const ProgrammeSettingsModel = model<ProgrammeSettingsDoc>('ProgrammeSettings', settingsSchema);
