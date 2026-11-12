import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  attendanceSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  objectIdSchema,
  rescheduleAppointmentSchema,
  type ListAppointmentsQuery,
} from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { AppointmentService } from './appointment.service.js';

const idParams = z.object({ id: objectIdSchema });
type Id = { id: string };

export function appointmentRoutes(deps: { service: AppointmentService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const r = Router();
  r.use(deps.authenticate, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.get('/', authorize('appointment:read'), validate({ query: listAppointmentsQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListAppointmentsQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.post('/', authorize('appointment:manage'), validate({ body: createAppointmentSchema }), async (req, res) => {
    sendData(res, await s.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  r.get('/:id', authorize('appointment:read'), validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id));
  });
  r.patch('/:id', authorize('appointment:manage'), validate({ params: idParams, body: rescheduleAppointmentSchema }), async (req, res) => {
    sendData(res, await s.reschedule(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  r.post('/:id/cancel', authorize('appointment:manage'), validate({ params: idParams, body: cancelAppointmentSchema }), async (req, res) => {
    sendData(res, await s.cancel(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  r.post('/:id/attendance', authorize('appointment:record-attendance'), validate({ params: idParams, body: attendanceSchema }), async (req, res) => {
    sendData(res, await s.recordAttendance(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  return r;
}
