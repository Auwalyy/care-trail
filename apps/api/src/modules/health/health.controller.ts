import type { RequestHandler } from 'express';
import type { HealthService } from './health.service.js';

export class HealthController {
  constructor(private readonly service: HealthService) {}

  live: RequestHandler = (_req, res) => {
    res.set('Cache-Control', 'no-store').json(this.service.liveness());
  };

  ready: RequestHandler = async (_req, res) => {
    const status = await this.service.readiness();
    res
      .set('Cache-Control', 'no-store')
      .status(status.status === 'ok' ? 200 : 503)
      .json(status);
  };
}
