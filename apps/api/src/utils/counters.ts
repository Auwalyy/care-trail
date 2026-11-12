import { Schema, model, type ClientSession } from 'mongoose';

interface CounterDoc {
  _id: string;
  seq: number;
}

const CounterModel = model<CounterDoc>(
  'Counter',
  new Schema<CounterDoc>({ _id: { type: String, required: true }, seq: { type: Number, required: true } }, { collection: 'counters', versionKey: false }),
);

/** Atomically allocates the next number in a named sequence (gaps are possible, repeats are not). */
export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session: session ?? null },
  ).lean<CounterDoc>();
  return doc!.seq;
}

/** e.g. formatCode('CT-P', 42) → "CT-P-000042" */
export function formatCode(prefix: string, n: number, width = 6): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
