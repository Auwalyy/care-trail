import { Router, type RequestHandler } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
} from '@caretrail/validation';
import type { Env } from '../../config/env.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

export function authRoutes(deps: {
  service: AuthService;
  authenticate: RequestHandler;
  env: Pick<Env, 'NODE_ENV'>;
  rateLimit: boolean;
}): Router {
  const c = new AuthController(deps.service, deps.env);
  const limited: RequestHandler[] = deps.rateLimit ? [authRateLimit()] : [];
  const router = Router();

  router.post('/login', ...limited, validate({ body: loginSchema }), c.login);
  router.post('/refresh', validate({ body: refreshSchema }), c.refresh);
  router.post('/logout', validate({ body: logoutSchema }), c.logout);
  router.post('/forgot-password', ...limited, validate({ body: forgotPasswordSchema }), c.forgotPassword);
  router.post('/reset-password', ...limited, validate({ body: resetPasswordSchema }), c.resetPassword);
  router.get('/me', deps.authenticate, c.me);
  router.post('/change-password', deps.authenticate, validate({ body: changePasswordSchema }), c.changePassword);
  return router;
}
