import type { ClientSession } from 'mongoose';
import { AuditLogModel, type AuditLogDoc } from './audit-log.model.js';

export type NewAuditLog = Omit<AuditLogDoc, '_id' | 'at'> & { at?: Date };

export class AuditRepository {
  async insert(entry: NewAuditLog, session?: ClientSession): Promise<void> {
    await AuditLogModel.create([{ at: new Date(), ...entry }], session ? { session } : {});
  }
}
