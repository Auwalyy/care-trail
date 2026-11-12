import { ApiError } from '@caretrail/api-client';
import type { SyncOpResult } from '@caretrail/shared-types';
import type { LocalStore, OutboxEntry, SyncReport, Transport } from './types.js';

export interface EngineOptions {
  deviceId: string;
  appVersion: string;
  /** Operations per push request (small: rural networks drop large requests). */
  batchSize?: number;
  /** Maximum batches per sync run, so one run cannot hold the network forever. */
  maxBatches?: number;
  now?: () => Date;
  random?: () => number;
}

const BASE_DELAY_MS = 15_000;
const MAX_DELAY_MS = 30 * 60_000;

/** Exponential backoff with ±20% jitter: 15s, 30s, 1m, 2m … capped at 30 minutes. */
export function backoffDelay(retryCount: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1), MAX_DELAY_MS);
  return Math.round(base * (0.8 + random() * 0.4));
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in again to continue synchronising');
    this.name = 'AuthRequiredError';
  }
}

/**
 * Controlled synchronisation (spec §7): reset interrupted ops → push due ops in small batches with
 * idempotency keys → record per-op results → pull changes since the last cursor → save cursor with
 * the data. Safe to call at any time; concurrent calls share one run.
 */
export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private readonly batchSize: number;
  private readonly maxBatches: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly store: LocalStore,
    private readonly transport: Transport,
    private readonly opts: EngineOptions,
  ) {
    this.batchSize = opts.batchSize ?? 25;
    this.maxBatches = opts.maxBatches ?? 20;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
  }

  sync(): Promise<SyncReport> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = { startedAt: this.now().toISOString(), finishedAt: '', outcome: 'ok', pushed: 0, applied: 0, rejected: 0, conflicts: 0, deferred: 0, pulled: false, remaining: 0 };
    const done = async (outcome: SyncReport['outcome'], error?: string) => {
      report.outcome = outcome;
      if (error) report.error = error;
      report.remaining = await this.store.countUnsynced();
      report.finishedAt = this.now().toISOString();
      return report;
    };

    await this.store.resetInterrupted();

    // ── Push ──
    for (let i = 0; i < this.maxBatches; i++) {
      const batch = await this.store.nextBatch(this.now(), this.batchSize);
      if (batch.length === 0) break;
      await this.store.markSyncing(batch.map((b) => b.opId));
      let results: SyncOpResult[];
      try {
        const pending = Math.max(0, (await this.store.countUnsynced()) - batch.length);
        const res = await this.transport.push({
          deviceId: this.opts.deviceId,
          appVersion: this.opts.appVersion,
          pendingOperations: pending,
          operations: batch.map((b) => ({ opId: b.opId, opType: b.opType, targetId: b.targetId, payload: b.payload, createdAt: b.createdAt })),
        });
        results = res.results;
      } catch (err) {
        // Whole request failed: nothing is known to be applied, so everything goes back to the queue.
        // Re-sending the same opIds later is safe because the server ledger deduplicates them.
        for (const b of batch) await this.defer(b, errorText(err));
        report.deferred += batch.length;
        if (isAuthError(err)) return done('auth_required', 'Sign in again to continue synchronising');
        return done('offline', errorText(err));
      }

      report.pushed += batch.length;
      const byId = new Map(results.map((r) => [r.opId, r]));
      for (const entry of batch) {
        const r = byId.get(entry.opId);
        if (!r) {
          await this.defer(entry, 'No result returned');
          report.deferred++;
          continue;
        }
        switch (r.status) {
          case 'applied':
            await this.store.onApplied(entry, r.serverId, r.entity);
            await this.store.updateOp(entry.opId, { status: 'synced', serverId: r.serverId, lastError: null, conflict: null, nextAttemptAt: null });
            report.applied++;
            break;
          case 'conflict':
            await this.store.updateOp(entry.opId, { status: 'conflict', lastError: r.error.message, conflict: r.current });
            report.conflicts++;
            break;
          case 'rejected':
            await this.store.updateOp(entry.opId, { status: 'failed', permanent: true, lastError: r.error.message, nextAttemptAt: null });
            report.rejected++;
            break;
          case 'retry':
            await this.defer(entry, r.error.message);
            report.deferred++;
            break;
        }
      }
    }

    // ── Pull ──
    try {
      const data = await this.transport.pull(await this.store.getCursor());
      await this.store.applyPull(data); // data + cursor in one transaction
      report.pulled = true;
    } catch (err) {
      if (isAuthError(err)) return done('auth_required', 'Sign in again to continue synchronising');
      return done(report.pushed > 0 ? 'partial' : 'offline', errorText(err));
    }
    return done(report.rejected || report.conflicts || report.deferred ? 'partial' : 'ok');
  }

  private async defer(entry: OutboxEntry, error: string) {
    const retryCount = entry.retryCount + 1;
    await this.store.updateOp(entry.opId, {
      status: 'failed',
      permanent: false,
      retryCount,
      lastError: error,
      nextAttemptAt: new Date(this.now().getTime() + backoffDelay(retryCount, this.random)).toISOString(),
    });
  }
}

function isAuthError(err: unknown): boolean {
  return err instanceof AuthRequiredError || (err instanceof ApiError && err.status === 401);
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.isTransient ? 'No connection to the server' : err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
