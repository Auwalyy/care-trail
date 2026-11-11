import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { createUserSchema, listUsersQuerySchema, objectIdSchema, setUserStatusSchema, updateUserSchema } from '@caretrail/validation';
import { authorize } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { UserController } from './user.controller.js';
import type { UserService } from './user.service.js';

const idParams = z.object({ id: objectIdSchema });

export function userRoutes(deps: { service: UserService; authenticate: RequestHandler }): Router {
  const c = new UserController(deps.service);
  const router = Router();
  router.use(deps.authenticate);

  router.get('/', authorize('user:read'), validate({ query: listUsersQuerySchema }), c.list);
  router.post('/', authorize('user:manage'), validate({ body: createUserSchema }), c.create);
  router.get('/:id', authorize('user:read'), validate({ params: idParams }), c.get);
  router.patch('/:id', authorize('user:manage'), validate({ params: idParams, body: updateUserSchema }), c.update);
  router.post('/:id/status', authorize('user:manage'), validate({ params: idParams, body: setUserStatusSchema }), c.setStatus);
  router.post('/:id/password-link', authorize('user:manage'), validate({ params: idParams }), c.issuePasswordLink);
  return router;
}
