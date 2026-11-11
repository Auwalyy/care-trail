import type { ClientSession, Model, QueryFilter, UpdateQuery } from 'mongoose';
import { AppError } from './app-error.js';

/**
 * Optimistic-concurrency update: applies `update` only if the document still has `version`,
 * and increments it. Throws NOT_FOUND / VERSION_CONFLICT (with the current state) otherwise.
 */
export async function updateVersioned<T extends { version: number }, D>(
  model: Model<T>,
  filter: QueryFilter<T>,
  version: number,
  update: UpdateQuery<T>,
  toDto: (doc: T) => D,
  session?: ClientSession,
): Promise<T> {
  const updated = await model
    .findOneAndUpdate(
      { ...filter, version } as QueryFilter<T>,
      { ...update, $inc: { ...((update.$inc as object | undefined) ?? {}), version: 1 } } as UpdateQuery<T>,
      { returnDocument: 'after', session: session ?? null },
    )
    .lean<T>();
  if (updated) return updated;
  const current = await model.findOne(filter).lean<T>();
  if (!current) throw AppError.notFound();
  throw new AppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.', {
    current: toDto(current) as unknown as Record<string, unknown>,
  });
}

/** Maps Mongo duplicate-key errors to a 409 on the given field. */
export function duplicateAs(path: string, message: string) {
  return (err: unknown): never => {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError('CONFLICT', message, [{ path, message }]);
    }
    throw err;
  };
}

/** Names of fields present in an update payload (for audit metadata — never values). */
export function changedFields(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((k) => k !== 'version' && input[k] !== undefined);
}
