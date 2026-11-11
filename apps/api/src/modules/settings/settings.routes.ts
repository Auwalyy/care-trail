import { Router, type RequestHandler } from 'express';
import { organisationScopeQuerySchema, updateSettingsSchema } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData } from '../../utils/response.js';
import type { SettingsService } from './settings.service.js';

type OrgQuery = { organisationId?: string };

export function settingsRoutes(deps: { service: SettingsService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate, authorize('settings:manage'));
  router.get('/', validate({ query: organisationScopeQuerySchema }), async (_req, res) => {
    const q = parsedQuery<OrgQuery>(res.locals);
    sendData(res, await deps.service.get(requireAuth(res.locals), q.organisationId));
  });
  router.put('/', validate({ query: organisationScopeQuerySchema, body: updateSettingsSchema }), async (req, res) => {
    const q = parsedQuery<OrgQuery>(res.locals);
    sendData(res, await deps.service.update(requireAuth(res.locals), q.organisationId, req.body, requestContext(req, res)));
  });
  return router;
}
