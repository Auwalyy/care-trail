import { Schema, model, type Types } from 'mongoose';

export interface AuditLogDoc {
  _id: Types.ObjectId;
  at: Date;
  action: string;
  outcome: 'success' | 'failure';
  actorId?: Types.ObjectId | null;
  actorRole?: string | null;
  organisationId?: Types.ObjectId | null;
  entityType?: string | null;
  entityId?: Types.ObjectId | null;
  requestId?: string | null;
  ip?: string | null;
  /**
   * Non-identifying context only: field *names* that changed, reason codes, counts. Never put
   * patient data, names, phone numbers, emails or tokens here.
   */
  metadata?: Record<string, unknown> | null;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    at: { type: Date, required: true, default: () => new Date() },
    action: { type: String, required: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    organisationId: { type: Schema.Types.ObjectId, default: null },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'audit_logs', versionKey: false },
);

auditLogSchema.index({ organisationId: 1, at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

// Append-only: block updates and deletes through Mongoose.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(op, function () {
    throw new Error('audit_logs is append-only');
  });
}

export const AuditLogModel = model<AuditLogDoc>('AuditLog', auditLogSchema);
