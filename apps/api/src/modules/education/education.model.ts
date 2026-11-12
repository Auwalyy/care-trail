import { Schema, model, type Types } from 'mongoose';
import { AUDIO_CONTENT_TYPES, EDUCATION_CATEGORIES, EDUCATION_STATUSES, type AudioContentType, type EducationCategory, type EducationStatus } from '@caretrail/shared-types';

export interface EducationAudio {
  key: string;
  contentType: AudioContentType;
  size: number;
  uploadedAt: Date;
}

/**
 * Health education written by the programme. CARETRAIL ships none: every item needs a recorded
 * clinical review (by a platform administrator on behalf of the named reviewer) before it can be
 * published to CHWs.
 */
export interface EducationDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  category: EducationCategory;
  title: string;
  body: string;
  titleHa: string | null;
  bodyHa: string | null;
  audio: { en: EducationAudio | null; ha: EducationAudio | null };
  status: EducationStatus;
  approval: { reviewerName: string; reviewerCredentials: string; approvedOn: string; recordedBy: Types.ObjectId } | null;
  reviewNote: string | null;
  publishedAt: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const audioSchema = new Schema<EducationAudio>(
  { key: { type: String, required: true }, contentType: { type: String, enum: AUDIO_CONTENT_TYPES, required: true }, size: { type: Number, required: true }, uploadedAt: { type: Date, required: true } },
  { _id: false },
);

const educationSchema = new Schema<EducationDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    category: { type: String, enum: EDUCATION_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 5000 },
    titleHa: { type: String, default: null },
    bodyHa: { type: String, default: null },
    audio: { en: { type: audioSchema, default: null }, ha: { type: audioSchema, default: null } },
    status: { type: String, enum: EDUCATION_STATUSES, default: 'draft' },
    approval: {
      type: new Schema({ reviewerName: String, reviewerCredentials: String, approvedOn: String, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' } }, { _id: false }),
      default: null,
    },
    reviewNote: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'education_contents', versionKey: false },
);

educationSchema.index({ organisationId: 1, status: 1, category: 1, title: 1 });
// Mobile pull: published content changed since the cursor.
educationSchema.index({ organisationId: 1, updatedAt: 1 });

export const EducationModel = model<EducationDoc>('EducationContent', educationSchema);
