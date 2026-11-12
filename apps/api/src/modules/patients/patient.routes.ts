import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  listPatientsQuerySchema,
  objectIdSchema,
  reassignPatientSchema,
  recordConsentSchema,
  registerPatientSchema,
  setPatientStatusSchema,
  updatePatientSchema,
  type ListPatientsQuery,
} from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { PatientService } from './patient.service.js';

const idParams = z.object({ id: objectIdSchema });
type Id = { id: string };

/** Patient records carry personal data: responses are never cached by browsers or proxies. */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export function patientRoutes(deps: { service: PatientService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const router = Router();
  router.use(deps.authenticate, noStore);

  router.get('/', authorize('patient:read'), validate({ query: listPatientsQuerySchema }), async (_req, res) => {
    const query = parsedQuery<ListPatientsQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), query);
    sendList(res, items, { page: query.page, pageSize: query.pageSize, total });
  });

  router.post('/', authorize('patient:create', 'consent:record'), validate({ body: registerPatientSchema }), async (req, res) => {
    const result = await s.register(requireAuth(res.locals), req.body, requestContext(req, res));
    sendData(res, result, result.alreadyRegistered ? 200 : 201);
  });

  router.get('/:id', authorize('patient:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id, requestContext(req, res)));
  });

  router.patch('/:id', authorize('patient:update'), validate({ params: idParams, body: updatePatientSchema }), async (req, res) => {
    sendData(res, await s.update(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });

  router.post('/:id/status', authorize('patient:update'), validate({ params: idParams, body: setPatientStatusSchema }), async (req, res) => {
    sendData(res, await s.setStatus(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });

  router.post('/:id/reassign', authorize('patient:reassign'), validate({ params: idParams, body: reassignPatientSchema }), async (req, res) => {
    sendData(res, await s.reassign(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });

  router.get('/:id/consent', authorize('consent:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.consentHistory(requireAuth(res.locals), (req.params as Id).id));
  });

  router.post('/:id/consent', authorize('consent:record'), validate({ params: idParams, body: recordConsentSchema }), async (req, res) => {
    sendData(res, await s.recordConsent(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)), 201);
  });

  router.get('/:id/history', authorize('patient:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.history(requireAuth(res.locals), (req.params as Id).id));
  });

  return router;
}
