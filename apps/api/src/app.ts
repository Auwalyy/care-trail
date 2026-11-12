import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Env } from './config/env.js';
import { buildOpenApiDocument } from './config/openapi.js';
import { pingDatabase } from './database/connection.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import {
  createCommunitySchema,
  createFacilitySchema,
  createOrganisationSchema,
  directoryListQuerySchema,
  updateCommunitySchema,
  updateFacilitySchema,
  updateOrganisationSchema,
} from '@caretrail/validation';
import { createAuthenticate } from './middleware/authenticate.js';
import { scopedCrudRoutes } from './modules/access/crud-routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { AnalyticsService } from './modules/analytics/analytics.service.js';
import { ReportService } from './modules/analytics/report.service.js';
import { AuditQueryService } from './modules/audit/audit.query.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { ChwRepository } from './modules/chws/chw.repository.js';
import { chwRoutes } from './modules/chws/chw.routes.js';
import { ChwService } from './modules/chws/chw.service.js';
import { CommunityRepository } from './modules/communities/community.repository.js';
import { CommunityService } from './modules/communities/community.service.js';
import { FacilityRepository } from './modules/facilities/facility.repository.js';
import { FacilityService } from './modules/facilities/facility.service.js';
import { OrganisationRepository } from './modules/organisations/organisation.repository.js';
import { OrganisationService } from './modules/organisations/organisation.service.js';
import { HouseholdRepository } from './modules/households/household.repository.js';
import { householdRoutes } from './modules/households/household.routes.js';
import { HouseholdService } from './modules/households/household.service.js';
import { PatientRepository } from './modules/patients/patient.repository.js';
import { patientRoutes } from './modules/patients/patient.routes.js';
import { PatientService } from './modules/patients/patient.service.js';
import { InstructionTemplateService } from './modules/referrals/instruction-template.service.js';
import { referralRoutes, templateRoutes } from './modules/referrals/referral.routes.js';
import { ReferralService } from './modules/referrals/referral.service.js';
import { appointmentRoutes } from './modules/appointments/appointment.routes.js';
import { AppointmentService } from './modules/appointments/appointment.service.js';
import { followUpRoutes } from './modules/follow-ups/follow-up.routes.js';
import { FollowUpService } from './modules/follow-ups/follow-up.service.js';
import { MissedCareService } from './modules/follow-ups/missed-care.service.js';
import { educationRoutes } from './modules/education/education.routes.js';
import { EducationService } from './modules/education/education.service.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { NotificationService } from './modules/notifications/notification.service.js';
import { createProviders, type ProviderSet } from './modules/notifications/providers.js';
import { createObjectStorage, type ObjectStorage } from './modules/storage/object-storage.js';
import { syncRoutes } from './modules/sync/sync.routes.js';
import { SyncService } from './modules/sync/sync.service.js';
import { visitRoutes } from './modules/visits/visit.routes.js';
import { VisitService } from './modules/visits/visit.service.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AccessTokenService } from './modules/auth/access-token.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { PasswordHasher } from './modules/auth/password-hasher.js';
import { LogOnlyPasswordLinkNotifier, type PasswordLinkNotifier } from './modules/auth/password-link-notifier.js';
import { PasswordLinkService } from './modules/auth/password-link.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { HealthService, type HealthCheck } from './modules/health/health.service.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { UserRepository } from './modules/users/user.repository.js';
import { userRoutes } from './modules/users/user.routes.js';
import { UserService } from './modules/users/user.service.js';
import { AppError } from './utils/app-error.js';
import type { Logger } from './utils/logger.js';

export interface AppDependencies {
  /** Exposed so server.ts can schedule it (tests call routes / run() directly). */
  onMissedCare?: (svc: MissedCareService) => void;
  onNotifications?: (svc: NotificationService) => void;
  /** Overridable for tests (defaults from env). */
  storage?: ObjectStorage;
  notificationProviders?: ProviderSet;
  env: Env;
  logger: Logger;
  /** Overridable for tests. */
  healthChecks?: Record<string, HealthCheck>;
  passwordLinkNotifier?: PasswordLinkNotifier;
  now?: () => Date;
}

export function createApp({ env, logger, healthChecks, passwordLinkNotifier, now, onMissedCare, onNotifications, storage, notificationProviders }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple'); // no nested objects in query strings → no operator injection

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => (res as express.Response).locals.requestId as string,
      // Only method, path and status are logged — never bodies or query strings (may contain PII).
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients (mobile app, curl) send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(new AppError('FORBIDDEN', 'Origin not allowed'));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  const health = new HealthService(env.APP_VERSION, healthChecks ?? { mongodb: async () => pingDatabase() });
  api.use('/health', healthRoutes(health));

  if (env.NODE_ENV !== 'test') api.use(apiRateLimit());

  if (env.API_DOCS_ENABLED) {
    const doc = buildOpenApiDocument(env.APP_VERSION);
    app.get('/api/openapi.json', (_req, res) => {
      res.json(doc);
    });
    app.use(
      '/api/docs',
      // Swagger UI needs inline scripts/styles; relax CSP only on this route.
      helmet({ contentSecurityPolicy: false }),
      swaggerUi.serve,
      swaggerUi.setup(doc, { customSiteTitle: 'CARETRAIL API' }),
    );
  }

  // ── Composition root ─────────────────────────────────────────────────────────
  const audit = new AuditService();
  const accessTokens = new AccessTokenService(env);
  const links = new PasswordLinkService(env.WEB_APP_URL);
  const authService = new AuthService({
    env,
    logger,
    audit,
    hasher: new PasswordHasher(),
    accessTokens,
    sessions: new SessionService(env.REFRESH_TOKEN_TTL_DAYS),
    links,
    notifier: passwordLinkNotifier ?? new LogOnlyPasswordLinkNotifier(logger, env.NODE_ENV === 'development'),
    ...(now ? { now } : {}),
  });
  const authenticate = createAuthenticate(accessTokens);
  const userService = new UserService({ repo: new UserRepository(), audit, auth: authService, links, ...(now ? { now } : {}) });

  api.use('/auth', authRoutes({ service: authService, authenticate, env, rateLimit: env.NODE_ENV !== 'test' }));
  api.use('/users', userRoutes({ service: userService, authenticate }));
  api.use(
    '/organisations',
    scopedCrudRoutes({
      service: new OrganisationService({ repo: new OrganisationRepository(), audit }),
      authenticate,
      read: 'organisation:read',
      manage: 'organisation:manage',
      schemas: { list: directoryListQuerySchema, create: createOrganisationSchema, update: updateOrganisationSchema },
    }),
  );
  api.use(
    '/facilities',
    scopedCrudRoutes({
      service: new FacilityService({ repo: new FacilityRepository(), audit }),
      authenticate,
      read: 'facility:read',
      manage: 'facility:manage',
      schemas: { list: directoryListQuerySchema, create: createFacilitySchema, update: updateFacilitySchema },
    }),
  );
  api.use(
    '/communities',
    scopedCrudRoutes({
      service: new CommunityService({ repo: new CommunityRepository(), audit }),
      authenticate,
      read: 'community:read',
      manage: 'community:manage',
      schemas: { list: directoryListQuerySchema, create: createCommunitySchema, update: updateCommunitySchema },
    }),
  );
  api.use('/chws', chwRoutes({ service: new ChwService({ repo: new ChwRepository(), users: userService, audit }), authenticate }));
  api.use('/households', householdRoutes({ service: new HouseholdService({ repo: new HouseholdRepository(), audit }), authenticate }));
  const clock = now ? { now } : {};
  const patientRepo = new PatientRepository();
  const settings = new SettingsService({ audit });
  const patientService = new PatientService({ repo: patientRepo, audit, ...clock });
  const referralService = new ReferralService({ audit, settings, patients: patientRepo, ...clock });
  const appointmentService = new AppointmentService({ audit, patients: patientRepo, ...clock });
  const followUpService = new FollowUpService({ audit, patients: patientRepo, ...clock });
  const visitService = new VisitService({ audit, patients: patientRepo });
  const missedCare = new MissedCareService({ settings, audit, logger, ...clock });
  onMissedCare?.(missedCare);
  const notificationService = new NotificationService({ providers: notificationProviders ?? createProviders(env, logger), audit, logger, ...clock });
  onNotifications?.(notificationService);
  const educationService = new EducationService({ audit, storage: storage ?? createObjectStorage(env) });

  api.use('/patients', patientRoutes({ service: patientService, authenticate }));
  api.use('/referrals', referralRoutes({ service: referralService, authenticate }));
  api.use('/appointments', appointmentRoutes({ service: appointmentService, authenticate }));
  api.use('/follow-ups', followUpRoutes({ service: followUpService, missedCare, authenticate }));
  api.use('/visits', visitRoutes({ service: visitService, authenticate }));
  api.use('/education', educationRoutes({ service: educationService, authenticate }));
  api.use('/notifications', notificationRoutes({ service: notificationService, authenticate }));
  api.use(
    '/sync',
    syncRoutes({
      service: new SyncService({ patients: patientService, referrals: referralService, appointments: appointmentService, followUps: followUpService, visits: visitService, settings, audit, logger }),
      authenticate,
    }),
  );
  api.use('/referral-templates', templateRoutes({ service: new InstructionTemplateService({ audit }), authenticate }));
  api.use('/settings', settingsRoutes({ service: settings, authenticate }));
  api.use('/audit-logs', auditRoutes({ service: new AuditQueryService(), authenticate }));
  api.use('/analytics', analyticsRoutes({ service: new AnalyticsService({ settings }), reports: new ReportService({ audit, ...clock }), authenticate }));
  // Further feature modules (organisations, patients, referrals, …) are mounted here.

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
