import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import { errorMessage } from '@/components/states/states';

/** Maps API field errors onto form fields; anything else becomes a toast. */
export function applyApiErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]) {
  if (err instanceof ApiError) {
    const matched = err.fieldErrors.filter((f) => f.path && fields.includes(f.path));
    for (const f of matched) setError(f.path as Path<T>, { message: f.message });
    if (matched.length > 0) return;
  }
  toast.error(errorMessage(err));
}
