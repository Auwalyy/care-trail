import type { SyncOpType, SyncPullResponse, SyncPushRequest, SyncPushResponse, SyncStatus } from '@caretrail/shared-types';

/** One queued offline operation (the local outbox row). */
export interface OutboxEntry {
  /** UUID generated on the device — also the server idempotency key. */
  opId: string;
  opType: SyncOpType;
  /** Local id of the entity this op creates/changes (for status display and result mapping). */
  entityLocalId: string;
  /** Server id of the target for update-style ops, or `local:<clientId>` if not yet synced. */
  targetId: string | null;
  payload: Record<string, unknown>;
  /** opId that must be applied first (e.g. the registration of the patient this visit is for). */
  dependsOn: string | null;
  createdAt: string;
  status: SyncStatus;
  retryCount: number;
  /** When a failed op may be retried (ISO); null = retry now or never (see `permanent`). */
  nextAttemptAt: string | null;
  /** Rejected by the server (validation/permission): needs a person, never auto-retried. */
  permanent: boolean;
  lastError: string | null;
  /** Server response for conflicts (current server version or duplicate candidates). */
  conflict: unknown;
  serverId: string | null;
}

export type OutboxUpdate = Partial<Pick<OutboxEntry, 'status' | 'retryCount' | 'nextAttemptAt' | 'permanent' | 'lastError' | 'conflict' | 'serverId'>>;

/**
 * Persistence the engine needs. The mobile app implements this on SQLite; tests use MemoryStore.
 * Implementations must make `applyPull` (data + cursor) a single transaction so an app crash can
 * never save a cursor without its data.
 */
export interface LocalStore {
  /** Ops left "syncing" by a crash are put back to "pending" (safe: the server ledger dedupes). */
  resetInterrupted(): Promise<number>;
  /** Due, unblocked ops in creation order (dependencies already synced). */
  nextBatch(now: Date, limit: number): Promise<OutboxEntry[]>;
  markSyncing(opIds: string[]): Promise<void>;
  updateOp(opId: string, update: OutboxUpdate): Promise<void>;
  /** Called for each applied op so the app can record server ids / codes on its local records. */
  onApplied(entry: OutboxEntry, serverId: string, entity: unknown): Promise<void>;
  countUnsynced(): Promise<number>;
  getCursor(): Promise<string | null>;
  applyPull(data: SyncPullResponse): Promise<void>;
}

export interface Transport {
  push(req: SyncPushRequest): Promise<SyncPushResponse>;
  pull(since: string | null): Promise<SyncPullResponse>;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  outcome: 'ok' | 'offline' | 'auth_required' | 'partial';
  pushed: number;
  applied: number;
  rejected: number;
  conflicts: number;
  deferred: number;
  pulled: boolean;
  remaining: number;
  error?: string;
}
