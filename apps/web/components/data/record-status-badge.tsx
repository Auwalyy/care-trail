import type { RecordStatus } from '@caretrail/shared-types';
import { Badge } from '@/components/ui/badge';

export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  return status === 'active' ? (
    <Badge variant="outline" className="border-success-700/20 bg-success-50 text-success-700">Active</Badge>
  ) : (
    <Badge variant="outline" className="bg-muted text-ink-muted">Inactive</Badge>
  );
}
