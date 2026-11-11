import type { Model, QueryFilter } from 'mongoose';

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs a paged, sorted find + count over a filter that already includes the access scope. */
export async function findPaged<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  opts: { page: number; pageSize: number; sort: Record<string, 1 | -1> },
): Promise<{ items: T[]; total: number }> {
  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort({ ...opts.sort, _id: 1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .lean<T[]>(),
    model.countDocuments(filter),
  ]);
  return { items, total };
}
