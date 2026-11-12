import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { syncPullQuerySchema, syncPushSchema } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData } from '../../utils/response.js';
import type { SyncService } from './sync.service.js';

export function syncRoutes(deps: { service: SyncService; authenticate: RequestHandler }): Router {
  const r = Router();
  r.use(deps.authenticate, authorize('sync:use'), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.post('/push', validate({ body: syncPushSchema }), async (req, res) => {
    sendData(res, await deps.service.push(requireAuth(res.locals), req.body, requestContext(req, res)));
  });
  r.get('/pull', validate({ query: syncPullQuerySchema }), async (req, res) => {
    sendData(res, await deps.service.pull(requireAuth(res.locals), parsedQuery<{ since?: string }>(res.locals).since, requestContext(req, res)));
  });
  r.get('/status', validate({ query: z.object({ deviceId: z.string().max(100).optional() }) }), async (_req, res) => {
    sendData(res, await deps.service.status(requireAuth(res.locals), parsedQuery<{ deviceId?: string }>(res.locals).deviceId));
  });
  return r;
}
