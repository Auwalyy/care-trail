import { Router, type RequestHandler } from 'express';
import { createVisitSchema, listVisitsQuerySchema, type ListVisitsQuery } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { VisitService } from './visit.service.js';

export function visitRoutes(deps: { service: VisitService; authenticate: RequestHandler }): Router {
  const r = Router();
  r.use(deps.authenticate, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.get('/', authorize('visit:read'), validate({ query: listVisitsQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListVisitsQuery>(res.locals);
    const { items, total } = await deps.service.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.post('/', authorize('visit:create'), validate({ body: createVisitSchema }), async (req, res) => {
    sendData(res, await deps.service.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  return r;
}
