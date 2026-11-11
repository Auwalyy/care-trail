import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Permission } from '@caretrail/shared-types';
import { objectIdSchema } from '@caretrail/validation';
import { authorize } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { crudHandlers, type ScopedCrudService } from './crud-controller.js';

const idParams = z.object({ id: objectIdSchema });

/** GET / · GET /:id · POST / · PATCH /:id with separate read and manage permissions. */
export function scopedCrudRoutes<Q extends { page: number; pageSize: number }, C, U, D>(deps: {
  service: ScopedCrudService<Q, C, U, D>;
  authenticate: RequestHandler;
  read: Permission;
  manage: Permission;
  schemas: { list: z.ZodType; create: z.ZodType; update: z.ZodType };
}): Router {
  const h = crudHandlers(deps.service);
  const router = Router();
  router.use(deps.authenticate);
  router.get('/', authorize(deps.read), validate({ query: deps.schemas.list }), h.list);
  router.post('/', authorize(deps.manage), validate({ body: deps.schemas.create }), h.create);
  router.get('/:id', authorize(deps.read), validate({ params: idParams }), h.get);
  router.patch('/:id', authorize(deps.manage), validate({ params: idParams, body: deps.schemas.update }), h.update);
  return router;
}
