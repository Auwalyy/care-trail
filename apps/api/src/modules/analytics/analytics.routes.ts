import { Router, type RequestHandler } from 'express';
import { organisationScopeQuerySchema, reportQuerySchema, type ReportQuery } from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData } from '../../utils/response.js';
import type { AnalyticsService } from './analytics.service.js';
import { toCsv, type ReportService } from './report.service.js';

export function analyticsRoutes(deps: { service: AnalyticsService; reports: ReportService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate, authorize('analytics:read'));
  router.get('/overview', validate({ query: organisationScopeQuerySchema }), async (_req, res) => {
    const q = parsedQuery<{ organisationId?: string }>(res.locals);
    sendData(res, await deps.service.overview(requireAuth(res.locals).scope, q.organisationId));
  });
  /** One aggregated report as JSON, or as a CSV download with `format=csv`. */
  router.get('/report', validate({ query: reportQuerySchema }), async (req, res) => {
    const q = parsedQuery<ReportQuery>(res.locals);
    const auth = requireAuth(res.locals);
    const report = await deps.reports.run(auth, q);
    if (q.format === 'csv') {
      await deps.reports.recordExport(auth, report, requestContext(req, res));
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="caretrail-${report.report}-${report.filters.from}-to-${report.filters.to}.csv"`,
        'Cache-Control': 'no-store',
      });
      res.send(toCsv(report));
      return;
    }
    sendData(res, report);
  });
  return router;
}
