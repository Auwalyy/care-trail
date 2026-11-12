import type { SyncOpType, SyncPullResponse } from '@caretrail/shared-types';
import type { LocalStore, OutboxEntry, OutboxUpdate } from './types.js';

/**
 * In-memory LocalStore used by tests (and as the reference behaviour for the SQLite store).
 * Mirrors the SQLite semantics: due-and-unblocked selection, crash reset, atomic pull apply.
 */
export class MemoryStore implements LocalStore {
  outbox: OutboxEntry[] = [];
  cursor: string | null = null;
  /** localId → serverId for records created on this device. */
  serverIds = new Map<string, string>();
  /** Last pulled working set, keyed by collection then server id. */
  data: Record<string, Map<string, unknown>> = {};
  assignedPatientIds: string[] = [];
  pulls = 0;
  /** Set to make the next applyPull throw (simulates a crash during the transaction). */
  failNextApply = false;

  enqueue(op: { opId: string; opType: SyncOpType; entityLocalId: string; payload: Record<string, unknown>; targetId?: string | null; dependsOn?: string | null; createdAt?: string }): OutboxEntry {
    const entry: OutboxEntry = {
      opId: op.opId,
      opType: op.opType,
      entityLocalId: op.entityLocalId,
      targetId: op.targetId ?? null,
      payload: op.payload,
      dependsOn: op.dependsOn ?? null,
      createdAt: op.createdAt ?? new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: null,
      permanent: false,
      lastError: null,
      conflict: null,
      serverId: null,
    };
    this.outbox.push(entry);
    return entry;
  }

  op(opId: string): OutboxEntry {
    const e = this.outbox.find((o) => o.opId === opId);
    if (!e) throw new Error(`no op ${opId}`);
    return e;
  }

  async resetInterrupted() {
    let n = 0;
    for (const o of this.outbox) if (o.status === 'syncing') { o.status = 'pending'; n++; }
    return n;
  }

  async nextBatch(now: Date, limit: number) {
    const synced = new Set(this.outbox.filter((o) => o.status === 'synced').map((o) => o.opId));
    return this.outbox
      .filter((o) => (o.status === 'pending' || (o.status === 'failed' && !o.permanent)) && (!o.nextAttemptAt || o.nextAttemptAt <= now.toISOString()) && (!o.dependsOn || synced.has(o.dependsOn)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }

  async markSyncing(opIds: string[]) {
    for (const id of opIds) this.op(id).status = 'syncing';
  }

  async updateOp(opId: string, update: OutboxUpdate) {
    Object.assign(this.op(opId), update);
  }

  async onApplied(entry: OutboxEntry, serverId: string) {
    this.serverIds.set(entry.entityLocalId, serverId);
  }

  async countUnsynced() {
    return this.outbox.filter((o) => o.status !== 'synced').length;
  }

  async getCursor() {
    return this.cursor;
  }

  async applyPull(data: SyncPullResponse) {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('simulated crash during apply');
    }
    // All-or-nothing: build the new state, then swap (the SQLite store uses a transaction).
    const next: Record<string, Map<string, unknown>> = Object.fromEntries(Object.entries(this.data).map(([k, v]) => [k, new Map(v)]));
    const upsert = (key: string, items: { id: string }[]) => {
      next[key] ??= new Map();
      for (const item of items) next[key]!.set(item.id, item);
    };
    upsert('patients', data.patients);
    upsert('referrals', data.referrals);
    upsert('appointments', data.appointments);
    upsert('followUps', data.followUps);
    upsert('visits', data.visits);
    upsert('households', data.households);
    upsert('facilities', data.facilities);
    // Purge patients no longer assigned to this CHW (data minimisation on the device).
    const keep = new Set(data.assignedPatientIds);
    for (const id of [...(next.patients?.keys() ?? [])]) if (!keep.has(id)) next.patients!.delete(id);
    this.data = next;
    this.assignedPatientIds = data.assignedPatientIds;
    this.cursor = data.cursor;
    this.pulls++;
  }
}
