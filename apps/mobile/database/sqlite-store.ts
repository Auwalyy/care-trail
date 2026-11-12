import type { SQLiteDatabase } from 'expo-sqlite';
import { LOCAL_REF_PREFIX, nameKey, type PatientDto, type SyncOpType, type SyncPullResponse } from '@caretrail/shared-types';
import type { LocalStore, OutboxEntry, OutboxUpdate } from '@caretrail/sync-core';
import { notifyDataChanged } from '@/store/data-version';
import { getDb } from './db';

interface OutboxRow {
  op_id: string;
  op_type: string;
  entity_local_id: string;
  target_id: string | null;
  payload: string;
  depends_on: string | null;
  created_at: string;
  status: string;
  retry_count: number;
  next_attempt_at: string | null;
  permanent: number;
  last_error: string | null;
  conflict: string | null;
  server_id: string | null;
}

export function rowToEntry(r: OutboxRow): OutboxEntry {
  return {
    opId: r.op_id,
    opType: r.op_type as SyncOpType,
    entityLocalId: r.entity_local_id,
    targetId: r.target_id,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    dependsOn: r.depends_on,
    createdAt: r.created_at,
    status: r.status as OutboxEntry['status'],
    retryCount: r.retry_count,
    nextAttemptAt: r.next_attempt_at,
    permanent: Boolean(r.permanent),
    lastError: r.last_error,
    conflict: r.conflict ? (JSON.parse(r.conflict) as unknown) : null,
    serverId: r.server_id,
  };
}

/** Collection that holds the local record each create-type operation produces. */
const ENTITY_TABLE: Partial<Record<SyncOpType, string>> = {
  'patient.register': 'patients',
  'visit.create': 'visits',
  'referral.create': 'referrals',
  'appointment.create': 'appointments',
  'followup.create': 'follow_ups',
};

async function upsertPatient(db: SQLiteDatabase, p: PatientDto) {
  await db.runAsync(
    `INSERT INTO patients (id, client_id, name, name_key, community_id, status, json, pending) VALUES (?, NULL, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, community_id = excluded.community_id, status = excluded.status, json = excluded.json, pending = 0`,
    p.id, p.fullName, nameKey(p.fullName), p.communityId, p.status, JSON.stringify(p),
  );
}

async function upsertRow(db: SQLiteDatabase, table: string, item: { id: string } & Record<string, unknown>) {
  const json = JSON.stringify(item);
  const patientId = (item.patientId as string | undefined) ?? (item.patient as { id?: string } | undefined)?.id ?? '';
  switch (table) {
    case 'referrals':
      return db.runAsync('INSERT INTO referrals (id, patient_id, status, json, pending) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET patient_id = excluded.patient_id, status = excluded.status, json = excluded.json, pending = 0', item.id, patientId, String(item.status), json);
    case 'appointments':
      return db.runAsync('INSERT INTO appointments (id, patient_id, scheduled_for, status, json, pending) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET patient_id = excluded.patient_id, scheduled_for = excluded.scheduled_for, status = excluded.status, json = excluded.json, pending = 0', item.id, patientId, String(item.scheduledFor), String(item.status), json);
    case 'follow_ups':
      return db.runAsync('INSERT INTO follow_ups (id, patient_id, status, due_on, json, pending) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET patient_id = excluded.patient_id, status = excluded.status, due_on = excluded.due_on, json = excluded.json, pending = 0', item.id, patientId, String(item.status), String(item.dueOn), json);
    case 'visits':
      return db.runAsync('INSERT INTO visits (id, patient_id, visit_date, json, pending) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET json = excluded.json, visit_date = excluded.visit_date, pending = 0', item.id, patientId, String(item.visitDate), json);
    case 'households':
      return db.runAsync('INSERT INTO households (id, community_id, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET community_id = excluded.community_id, json = excluded.json', item.id, String(item.communityId), json);
    case 'templates':
      return db.runAsync('INSERT INTO templates (id, status, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, json = excluded.json', item.id, String(item.status), json);
    default:
      return db.runAsync(`INSERT INTO ${table} (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`, item.id, json);
  }
}

/** SQLite-backed LocalStore — same semantics as MemoryStore in @caretrail/sync-core (which is tested). */
export class SqliteStore implements LocalStore {
  async resetInterrupted() {
    const db = await getDb();
    const res = await db.runAsync("UPDATE outbox SET status = 'pending' WHERE status = 'syncing'");
    return res.changes;
  }

  async nextBatch(now: Date, limit: number) {
    const db = await getDb();
    const rows = await db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox o
       WHERE (o.status = 'pending' OR (o.status = 'failed' AND o.permanent = 0))
         AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
         AND (o.depends_on IS NULL OR EXISTS (SELECT 1 FROM outbox d WHERE d.op_id = o.depends_on AND d.status = 'synced'))
       ORDER BY o.created_at LIMIT ?`,
      now.toISOString(), limit,
    );
    return rows.map(rowToEntry);
  }

  async markSyncing(opIds: string[]) {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const id of opIds) await db.runAsync("UPDATE outbox SET status = 'syncing' WHERE op_id = ?", id);
    });
  }

  async updateOp(opId: string, u: OutboxUpdate) {
    const db = await getDb();
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    const add = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); vals.push(v); };
    if (u.status !== undefined) add('status', u.status);
    if (u.retryCount !== undefined) add('retry_count', u.retryCount);
    if (u.nextAttemptAt !== undefined) add('next_attempt_at', u.nextAttemptAt);
    if (u.permanent !== undefined) add('permanent', u.permanent ? 1 : 0);
    if (u.lastError !== undefined) add('last_error', u.lastError);
    if (u.conflict !== undefined) add('conflict', u.conflict === null ? null : JSON.stringify(u.conflict));
    if (u.serverId !== undefined) add('server_id', u.serverId);
    if (!sets.length) return;
    await db.runAsync(`UPDATE outbox SET ${sets.join(', ')} WHERE op_id = ?`, ...vals, opId);
    notifyDataChanged();
  }

  /** Replace the provisional local record with the server's version and re-point references to it. */
  async onApplied(entry: OutboxEntry, serverId: string, entity: unknown) {
    const table = ENTITY_TABLE[entry.opType];
    if (!table || !entity) return;
    const db = await getDb();
    const localId = `${LOCAL_REF_PREFIX}${entry.entityLocalId}`;
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`DELETE FROM ${table} WHERE id = ?`, localId);
      if (table === 'patients') {
        await upsertPatient(tx, entity as PatientDto);
        for (const t of ['referrals', 'appointments', 'follow_ups', 'visits']) await tx.runAsync(`UPDATE ${t} SET patient_id = ? WHERE patient_id = ?`, serverId, localId);
      } else {
        await upsertRow(tx, table, entity as { id: string });
      }
    });
    notifyDataChanged();
  }

  async countUnsynced() {
    const db = await getDb();
    return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status != 'synced'"))?.n ?? 0;
  }

  async getCursor() {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = 'sync.cursor'");
    return row ? (JSON.parse(row.value) as string) : null;
  }

  async applyPull(data: SyncPullResponse) {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (tx) => {
      // A record with a local change still waiting to be sent keeps the local version on screen.
      // Once that change is applied the server's updatedAt moves past the cursor, so the next
      // pull brings the merged server version.
      const waiting = new Set((await tx.getAllAsync<{ target_id: string }>("SELECT DISTINCT target_id FROM outbox WHERE status != 'synced' AND target_id IS NOT NULL")).map((r) => r.target_id));
      for (const p of data.patients) if (!waiting.has(p.id)) await upsertPatient(tx, p);
      for (const r of data.referrals) await upsertRow(tx, 'referrals', r as never);
      for (const a of data.appointments) await upsertRow(tx, 'appointments', a as never);
      for (const f of data.followUps) if (!waiting.has(f.id)) await upsertRow(tx, 'follow_ups', f as never);
      for (const v of data.visits) await upsertRow(tx, 'visits', v as never);
      for (const h of data.households) await upsertRow(tx, 'households', h as never);
      for (const f of data.facilities) await upsertRow(tx, 'facilities', f as never);
      for (const c of data.communities) await upsertRow(tx, 'communities', c as never);
      for (const t of data.templates) await upsertRow(tx, 'templates', t as never);
      // Only published content stays on the phone; unpublished or archived items are removed.
      for (const e of data.education ?? []) {
        if (e.status === 'published') {
          await tx.runAsync('INSERT INTO education (id, category, title, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category = excluded.category, title = excluded.title, json = excluded.json', e.id, e.category, e.title, JSON.stringify(e));
        } else {
          await tx.runAsync('DELETE FROM education WHERE id = ?', e.id);
        }
      }
      for (const m of data.messages ?? []) {
        await tx.runAsync('INSERT INTO messages (id, created_at, read_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET read_at = excluded.read_at, json = excluded.json', m.id, m.createdAt, m.readAt, JSON.stringify(m));
      }
      await tx.runAsync('DELETE FROM messages WHERE created_at < ?', new Date(Date.now() - 30 * 86_400_000).toISOString());

      // Data minimisation: remove patients (and their records) no longer assigned to this CHW,
      // unless they still have unsent local work.
      const keep = new Set(data.assignedPatientIds);
      const local = await tx.getAllAsync<{ id: string }>(`SELECT id FROM patients WHERE id NOT LIKE '${LOCAL_REF_PREFIX}%'`);
      for (const { id } of local) {
        if (keep.has(id)) continue;
        const busy = await tx.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status != 'synced' AND (target_id = ? OR payload LIKE ?)", id, `%${id}%`);
        if (busy?.n) continue;
        await tx.runAsync('DELETE FROM patients WHERE id = ?', id);
        for (const t of ['referrals', 'appointments', 'follow_ups', 'visits']) await tx.runAsync(`DELETE FROM ${t} WHERE patient_id = ?`, id);
      }

      const kv = (k: string, v: unknown) => tx.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
      await kv('sync.settings', data.settings);
      await kv('sync.canIssueReferrals', data.canIssueReferrals);
      await kv('sync.lastPullAt', data.serverTime);
      await kv('sync.cursor', data.cursor); // same transaction as the data
    });
    notifyDataChanged();
  }
}
