import type { RequestHandler, Router } from 'express';
import { createHouseholdSchema, listHouseholdsQuerySchema, objectIdSchema, updateHouseholdSchema } from '@caretrail/validation';
import { scopedCrudRoutes } from '../access/crud-routes.js';
import type { HouseholdService } from './household.service.js';

const createSchema = createHouseholdSchema.extend({ organisationId: objectIdSchema.nullish() });

export function householdRoutes(deps: { service: HouseholdService; authenticate: RequestHandler }): Router {
  return scopedCrudRoutes({
    service: deps.service,
    authenticate: deps.authenticate,
    read: 'patient:read',
    manage: 'household:manage',
    schemas: { list: listHouseholdsQuerySchema, create: createSchema, update: updateHouseholdSchema },
  });
}
