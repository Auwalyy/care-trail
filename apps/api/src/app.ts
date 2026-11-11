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
import { createAuthenticate } from './middleware/authenticate.js';
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
  env: Env;
  logger: Logger;
  /** Overridable for tests. */
  healthChecks?: Record<string, HealthCheck>;
  passwordLinkNotifier?: PasswordLinkNotifier;
  now?: () => Date;
}

export function createApp({ env, logger, healthChecks, passwordLinkNotifier, now }: AppDependencies): Express {
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
  // Further feature modules (organisations, patients, referrals, …) are mounted here.

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
