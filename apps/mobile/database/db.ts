import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

const DB_NAME = 'caretrail.db';
const KEY_NAME = 'caretrail.db.key';

/**
 * Local schema. Records are stored as the API's JSON shapes (`json`) plus the columns the app
 * queries on. `id` is the server id, or `local:<clientId>` for records created offline that the
 * server has not confirmed yet.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY NOT NULL, client_id TEXT, name TEXT NOT NULL, name_key TEXT NOT NULL, community_id TEXT, status TEXT, json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS patients_name ON patients (name_key);
  CREATE TABLE IF NOT EXISTS referrals (id TEXT PRIMARY KEY NOT NULL, client_id TEXT, patient_id TEXT NOT NULL, status TEXT, json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS referrals_patient ON referrals (patient_id);
  CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY NOT NULL, client_id TEXT, patient_id TEXT NOT NULL, scheduled_for TEXT, status TEXT, json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS appointments_patient ON appointments (patient_id);
  CREATE TABLE IF NOT EXISTS follow_ups (id TEXT PRIMARY KEY NOT NULL, client_id TEXT, patient_id TEXT NOT NULL, status TEXT, due_on TEXT, json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY NOT NULL, client_id TEXT, patient_id TEXT NOT NULL, visit_date TEXT, json TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY NOT NULL, community_id TEXT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS facilities (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS communities (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY NOT NULL, status TEXT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (
    op_id TEXT PRIMARY KEY NOT NULL, op_type TEXT NOT NULL, entity_local_id TEXT NOT NULL, target_id TEXT,
    payload TEXT NOT NULL, depends_on TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT, permanent INTEGER NOT NULL DEFAULT 0, last_error TEXT, conflict TEXT, server_id TEXT
  );
  CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, created_at);
  CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  `,
];

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** 256-bit random key, created once per installation and kept in the Android Keystore. */
async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, hex, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return hex;
}

async function open(): Promise<SQLiteDatabase> {
  const key = await databaseKey();
  const db = await openDatabaseAsync(DB_NAME);
  // SQLCipher (enabled by the expo-sqlite config plugin in app.json). Must be the first statement.
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  for (; version < MIGRATIONS.length; version++) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(MIGRATIONS[version]!);
      await tx.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return db;
}

export function getDb(): Promise<SQLiteDatabase> {
  dbPromise ??= open().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** Deletes all local data and the encryption key (sign-out / device hand-over). */
export async function wipeLocalData(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    await db?.closeAsync().catch(() => undefined);
  }
  dbPromise = null;
  await deleteDatabaseAsync(DB_NAME).catch(() => undefined);
  await SecureStore.deleteItemAsync(KEY_NAME);
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
