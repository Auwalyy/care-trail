import { Schema, model, type Types } from 'mongoose';
import { TEMPLATE_STATUSES, type TemplateStatus } from '@caretrail/shared-types';

/**
 * Programme-authored referral instructions. CARETRAIL ships none (decision A3): every template is
 * written by the programme and needs a recorded clinical approval before it can be attached.
 */
export interface InstructionTemplateDoc {
  _id: Types.ObjectId;
  organisationId: Types.ObjectId;
  title: string;
  body: string;
  bodyHa: string | null;
  status: TemplateStatus;
  approval: { reviewerName: string; reviewerCredentials: string; approvedOn: string; recordedBy: Types.ObjectId } | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const templateSchema = new Schema<InstructionTemplateDoc>(
  {
    organisationId: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 1000 },
    bodyHa: { type: String, default: null },
    status: { type: String, enum: TEMPLATE_STATUSES, default: 'draft' },
    approval: {
      type: new Schema(
        {
          reviewerName: String,
          reviewerCredentials: String,
          approvedOn: String,
          recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
        { _id: false },
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'referral_instruction_templates', versionKey: false },
);

templateSchema.index({ organisationId: 1, status: 1, title: 1 });

export const InstructionTemplateModel = model<InstructionTemplateDoc>('InstructionTemplate', templateSchema);
