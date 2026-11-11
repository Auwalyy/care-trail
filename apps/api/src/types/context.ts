import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { AuthClient, Permission, Role } from '@caretrail/shared-types';
import type { AccessScope } from '../modules/access/access-scope.js';
import type { UserDoc } from '../modules/users/user.model.js';

/** Request metadata carried into services for audit logging. */
export interface RequestContext {
  requestId: string;
  ip: string | null;
}

export interface AuthContext {
  user: UserDoc;
  userId: Types.ObjectId;
  role: Role;
  permissions: ReadonlySet<Permission>;
  scope: AccessScope;
  client: AuthClient;
}

export function requestContext(req: Request, res: Response): RequestContext {
  return { requestId: res.locals.requestId, ip: req.ip ?? null };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      requestId: string;
      auth?: AuthContext;
      query?: unknown;
    }
  }
}
