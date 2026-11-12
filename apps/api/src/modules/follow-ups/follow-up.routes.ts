import { Router, type RequestHandler } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  contactAttemptSchema,
  createFollowUpSchema,
  escalateFollowUpSchema,
  listFollowUpsQuerySchema,
  objectIdSchema,
  organisationScopeQuerySchema,
  resolveFollowUpSchema,
  updateFollowUpSchema,
  type ListFollowUpsQuery,
} from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { FollowUpService } from './follow-up.service.js';
import type { MissedCareService } from './missed-care.service.js';

const idParams = z.object({ id: objectIdSchema });
type Id = { id: string };

export function followUpRoutes(deps: { service: FollowUpService; missedCare: MissedCareService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const r = Router();
  r.use(deps.authenticate, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.get('/', authorize('followup:read'), validate({ query: listFollowUpsQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListFollowUpsQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.post('/', authorize('followup:manage'), validate({ body: createFollowUpSchema }), async (req, res) => {
    sendData(res, await s.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  /** Runs the missed-care check now (programme staff: own organisation; platform: all or one). */
  r.post('/missed-care/run', authorize('settings:manage'), validate({ query: organisationScopeQuerySchema }), async (_req, res) => {
    const auth = requireAuth(res.locals);
    const q = parsedQuery<{ organisationId?: string }>(res.locals);
    const org = auth.scope.kind === 'platform' ? (q.organisationId ? new Types.ObjectId(q.organisationId) : undefined) : auth.scope.organisationId;
    sendData(res, await deps.missedCare.run(org));
  });
  r.get('/:id', authorize('followup:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id));
  });
  r.patch('/:id', authorize('followup:manage'), validate({ params: idParams, body: updateFollowUpSchema }), async (req, res) => {
    sendData(res, await s.update(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  r.post('/:id/attempts', authorize('followup:manage'), validate({ params: idParams, body: contactAttemptSchema }), async (req, res) => {
    sendData(res, await s.addAttempt(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)), 201);
  });
  r.post('/:id/resolve', authorize('followup:manage'), validate({ params: idParams, body: resolveFollowUpSchema }), async (req, res) => {
    sendData(res, await s.resolve(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  r.post('/:id/escalate', authorize('followup:escalate'), validate({ params: idParams, body: escalateFollowUpSchema }), async (req, res) => {
    sendData(res, await s.escalate(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  return r;
}
