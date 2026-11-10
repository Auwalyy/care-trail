import { Router } from 'express';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

export function healthRoutes(service: HealthService): Router {
  const controller = new HealthController(service);
  const router = Router();
  router.get('/', controller.live);
  router.get('/ready', controller.ready);
  return router;
}
