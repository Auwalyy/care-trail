import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { Env } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requestContext } from '../../types/context.js';
import { readCookie } from '../../utils/cookies.js';
import { sendData } from '../../utils/response.js';
import { toAuthenticatedUser, type AuthService, type IssuedSession } from './auth.service.js';

export const REFRESH_COOKIE = 'ct_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly env: Pick<Env, 'NODE_ENV'>,
  ) {}

  private cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      ...(expires ? { expires } : {}),
    };
  }

  /** Web: refresh token only in an httpOnly cookie. Mobile: in the body (stored in SecureStore). */
  private sendSession(res: Response, session: IssuedSession, status = 200) {
    if (!session.response.refreshToken) {
      res.cookie(REFRESH_COOKIE, session.refreshToken, this.cookieOptions(session.refreshTokenExpiresAt));
    }
    res.set('Cache-Control', 'no-store');
    sendData(res, session.response, status);
  }

  private refreshTokenFrom(req: Request): string | undefined {
    return (req.body as { refreshToken?: string }).refreshToken ?? readCookie(req, REFRESH_COOKIE);
  }

  login: RequestHandler = async (req, res) => {
    this.sendSession(res, await this.service.login(req.body, requestContext(req, res)));
  };

  refresh: RequestHandler = async (req, res) => {
    try {
      this.sendSession(res, await this.service.refresh(this.refreshTokenFrom(req), requestContext(req, res)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  };

  logout: RequestHandler = async (req, res) => {
    const { allDevices } = req.body as { allDevices: boolean };
    await this.service.logout(this.refreshTokenFrom(req), allDevices, requestContext(req, res));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.status(204).end();
  };

  forgotPassword: RequestHandler = async (req, res) => {
    await this.service.forgotPassword((req.body as { email: string }).email, requestContext(req, res));
    sendData(res, { message: 'If an active account exists for that email, a reset link has been issued.' }, 202);
  };

  resetPassword: RequestHandler = async (req, res) => {
    sendData(res, await this.service.resetPassword(req.body, requestContext(req, res)));
  };

  me: RequestHandler = (_req, res) => {
    res.set('Cache-Control', 'no-store');
    sendData(res, toAuthenticatedUser(requireAuth(res.locals).user));
  };

  changePassword: RequestHandler = async (req, res) => {
    const auth = requireAuth(res.locals);
    this.sendSession(res, await this.service.changePassword(auth, req.body, requestContext(req, res)));
  };
}
