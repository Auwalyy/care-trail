import { Router, type RequestHandler } from 'express';
import { listAuditLogsQuerySchema, type ListAuditLogsQuery } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { sendList } from '../../utils/response.js';
import type { AuditQueryService } from './audit.query.js';

export function auditRoutes(deps: { service: AuditQueryService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.get('/', deps.authenticate, authorize('audit:read'), validate({ query: listAuditLogsQuerySchema }), async (_req, res) => {
    const query = parsedQuery<ListAuditLogsQuery>(res.locals);
    const { items, total } = await deps.service.list(requireAuth(res.locals).scope, query);
    sendList(res, items, { page: query.page, pageSize: query.pageSize, total });
  });
  return router;
}
