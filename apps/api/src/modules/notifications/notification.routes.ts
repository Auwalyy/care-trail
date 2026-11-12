import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { inboxQuerySchema, notificationHistoryQuerySchema, objectIdSchema, sendReminderSchema, type InboxQuery, type NotificationHistoryQuery } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { NotificationService } from './notification.service.js';

const idParams = z.object({ id: objectIdSchema });
const inboxQuery = inboxQuerySchema.extend({ lang: z.enum(['en', 'ha']).default('en') });

export function notificationRoutes(deps: { service: NotificationService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const r = Router();
  r.use(deps.authenticate);

  // Own in-app inbox: any signed-in user.
  r.get('/inbox', validate({ query: inboxQuery }), async (_req, res) => {
    const q = parsedQuery<InboxQuery & { lang: 'en' | 'ha' }>(res.locals);
    const { items, total } = await s.inbox(requireAuth(res.locals), q, q.lang);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.get('/inbox/count', async (_req, res) => {
    sendData(res, await s.unreadCount(requireAuth(res.locals)));
  });
  r.post('/inbox/read-all', async (_req, res) => {
    sendData(res, await s.markAllRead(requireAuth(res.locals)));
  });
  r.post('/inbox/:id/read', validate({ params: idParams }), async (req, res) => {
    await s.markRead(requireAuth(res.locals), (req.params as { id: string }).id);
    res.status(204).end();
  });

  // Programme staff: delivery history and manual reminders.
  r.get('/history', authorize('notification:send'), validate({ query: notificationHistoryQuerySchema }), async (_req, res) => {
    const q = parsedQuery<NotificationHistoryQuery>(res.locals);
    const { items, total } = await s.history(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.post('/send', authorize('notification:send'), validate({ body: sendReminderSchema }), async (req, res) => {
    sendData(res, await s.sendReminder(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  r.post('/dispatch/run', authorize('settings:manage'), async (_req, res) => {
    sendData(res, await s.dispatch());
  });
  return r;
}
