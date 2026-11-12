import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  approveTemplateSchema,
  createReferralSchema,
  createTemplateSchema,
  listReferralsQuerySchema,
  listTemplatesQuerySchema,
  objectIdSchema,
  referralPrioritySchema,
  referralTransitionSchema,
  updateTemplateSchema,
  type ListReferralsQuery,
  type ListTemplatesQuery,
} from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { sendData, sendList } from '../../utils/response.js';
import type { InstructionTemplateService } from './instruction-template.service.js';
import type { ReferralService } from './referral.service.js';

const idParams = z.object({ id: objectIdSchema });
const codeParams = z.object({ code: z.string().trim().min(1).max(20) });
type Id = { id: string };

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** Templates are readable by anyone who works with referrals; managed by programme staff. */
const canReadTemplates: RequestHandler = (_req, res, next) => {
  const auth = requireAuth(res.locals);
  if (!['referral:read', 'referral:manage-templates'].some((p) => auth.permissions.has(p as never))) throw AppError.forbidden();
  next();
};

export function referralRoutes(deps: { service: ReferralService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const router = Router();
  router.use(deps.authenticate, noStore);

  router.get('/', authorize('referral:read'), validate({ query: listReferralsQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListReferralsQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  router.post('/', authorize('referral:create'), validate({ body: createReferralSchema }), async (req, res) => {
    const result = await s.create(requireAuth(res.locals), req.body, requestContext(req, res));
    sendData(res, result, result.alreadyIssued ? 200 : 201);
  });
  router.get('/code/:code', authorize('referral:verify'), validate({ params: codeParams }), async (req, res) => {
    sendData(res, await s.getByCode(requireAuth(res.locals), (req.params as { code: string }).code, requestContext(req, res)));
  });
  router.get('/:id', authorize('referral:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id));
  });
  router.get('/:id/history', authorize('referral:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.history(requireAuth(res.locals), (req.params as Id).id));
  });
  // Both facility staff (update-status) and issuers (cancel) use this; the state machine decides per role.
  router.patch('/:id/status', validate({ params: idParams, body: referralTransitionSchema }), async (req, res) => {
    const auth = requireAuth(res.locals);
    if (!auth.permissions.has('referral:update-status') && !auth.permissions.has('referral:cancel')) throw AppError.forbidden();
    sendData(res, await s.transition(auth, (req.params as Id).id, req.body, requestContext(req, res)));
  });
  router.patch('/:id/priority', authorize('referral:set-priority'), validate({ params: idParams, body: referralPrioritySchema }), async (req, res) => {
    sendData(res, await s.setPriority(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  return router;
}

export function templateRoutes(deps: { service: InstructionTemplateService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const router = Router();
  router.use(deps.authenticate);
  router.get('/', canReadTemplates, validate({ query: listTemplatesQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListTemplatesQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  router.get('/:id', canReadTemplates, validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id));
  });
  router.post('/', authorize('referral:manage-templates'), validate({ body: createTemplateSchema }), async (req, res) => {
    sendData(res, await s.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  router.patch('/:id', authorize('referral:manage-templates'), validate({ params: idParams, body: updateTemplateSchema }), async (req, res) => {
    sendData(res, await s.update(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  router.post('/:id/approve', authorize('referral:manage-templates'), validate({ params: idParams, body: approveTemplateSchema }), async (req, res) => {
    sendData(res, await s.approve(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  return router;
}
