import { Router, type RequestHandler } from 'express';
import { organisationScopeQuerySchema } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { sendData } from '../../utils/response.js';
import type { AnalyticsService } from './analytics.service.js';

export function analyticsRoutes(deps: { service: AnalyticsService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.get('/overview', deps.authenticate, authorize('analytics:read'), validate({ query: organisationScopeQuerySchema }), async (_req, res) => {
    const q = parsedQuery<{ organisationId?: string }>(res.locals);
    sendData(res, await deps.service.overview(requireAuth(res.locals).scope, q.organisationId));
  });
  return router;
}
