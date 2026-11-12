import { Schema, model, type Types } from 'mongoose';

/**
 * Idempotency ledger for device operations. The first push of an opId claims it ("processing");
 * the final result is stored so any retry returns exactly the same answer without re-applying.
 */
export interface SyncOperationDoc {
  _id: Types.ObjectId;
  opId: string;
  userId: Types.ObjectId;
  organisationId: Types.ObjectId | null;
  deviceId: string;
  opType: string;
  status: 'processing' | 'applied' | 'rejected' | 'conflict';
  /** Stored response (serverId / error) — never the request payload. */
  result: Record<string, unknown> | null;
  receivedAt: Date;
  completedAt: Date | null;
}

const schema = new Schema<SyncOperationDoc>(
  {
    opId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organisationId: { type: Schema.Types.ObjectId, default: null },
    deviceId: { type: String, required: true },
    opType: { type: String, required: true },
    status: { type: String, enum: ['processing', 'applied', 'rejected', 'conflict'], required: true },
    result: { type: Schema.Types.Mixed, default: null },
    receivedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { collection: 'sync_operations', versionKey: false },
);

schema.index({ opId: 1 }, { unique: true });
schema.index({ userId: 1, deviceId: 1, receivedAt: -1 });
// Ledger entries expire after 90 days; devices are forced to sync long before that.
schema.index({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const SyncOperationModel = model<SyncOperationDoc>('SyncOperation', schema);
