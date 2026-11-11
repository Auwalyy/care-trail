import type { RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery } from '../../middleware/validate.js';
import { requestContext, type AuthContext, type RequestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';

/** The service shape shared by scoped CRUD modules (organisations, facilities, communities). */
export interface ScopedCrudService<Q extends { page: number; pageSize: number }, C, U, D> {
  list(auth: AuthContext, query: Q): Promise<{ items: D[]; total: number }>;
  get(auth: AuthContext, id: string): Promise<D>;
  /** May return a richer payload than D (e.g. a created user plus a one-time activation link). */
  create(auth: AuthContext, input: C, ctx: RequestContext): Promise<unknown>;
  update(auth: AuthContext, id: string, input: U, ctx: RequestContext): Promise<D>;
}

/** Thin HTTP adapter: no business logic, just request → service → response envelope. */
export function crudHandlers<Q extends { page: number; pageSize: number }, C, U, D>(service: ScopedCrudService<Q, C, U, D>) {
  const list: RequestHandler = async (_req, res) => {
    const query = parsedQuery<Q>(res.locals);
    const { items, total } = await service.list(requireAuth(res.locals), query);
    sendList(res, items, { page: query.page, pageSize: query.pageSize, total });
  };
  const get: RequestHandler<{ id: string }> = async (req, res) => {
    sendData(res, await service.get(requireAuth(res.locals), req.params.id));
  };
  const create: RequestHandler = async (req, res) => {
    sendData(res, await service.create(requireAuth(res.locals), req.body as C, requestContext(req, res)), 201);
  };
  const update: RequestHandler<{ id: string }> = async (req, res) => {
    sendData(res, await service.update(requireAuth(res.locals), req.params.id, req.body as U, requestContext(req, res)));
  };
  return { list, get, create, update };
}
