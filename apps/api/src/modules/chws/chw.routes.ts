import type { RequestHandler, Router } from 'express';
import { createChwSchema, listChwsQuerySchema, updateChwSchema } from '@caretrail/validation';
import { scopedCrudRoutes } from '../access/crud-routes.js';
import type { ChwService } from './chw.service.js';

/**
 * CHW programme profiles. Account status (activate/deactivate) and password links use the
 * /users endpoints, so there is exactly one place where account access is changed.
 */
export function chwRoutes(deps: { service: ChwService; authenticate: RequestHandler }): Router {
  return scopedCrudRoutes({
    service: deps.service,
    authenticate: deps.authenticate,
    read: 'chw:read',
    manage: 'chw:manage',
    schemas: { list: listChwsQuerySchema, create: createChwSchema, update: updateChwSchema },
  });
}
