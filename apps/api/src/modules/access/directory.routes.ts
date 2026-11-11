import { Router, type RequestHandler } from 'express';
import type { Permission } from '@caretrail/shared-types';
import { directoryListQuerySchema, type DirectoryListQuery } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { sendList } from '../../utils/response.js';
import type { AccessScope } from './access-scope.js';

interface ScopedLister<T> {
  list(scope: AccessScope, query: DirectoryListQuery): Promise<{ items: T[]; total: number }>;
}

/**
 * Read-only, scoped list endpoint for reference data (organisations, facilities, communities).
 * Create/update endpoints for these modules arrive in Phase 3.
 */
export function directoryListRoutes<T>(deps: {
  repo: ScopedLister<T>;
  permission: Permission;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.get('/', deps.authenticate, authorize(deps.permission), validate({ query: directoryListQuerySchema }), async (_req, res) => {
    const query = parsedQuery<DirectoryListQuery>(res.locals);
    const { items, total } = await deps.repo.list(requireAuth(res.locals).scope, query);
    sendList(res, items, { page: query.page, pageSize: query.pageSize, total });
  });
  return router;
}
