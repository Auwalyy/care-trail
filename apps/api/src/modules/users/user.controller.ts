import type { RequestHandler } from 'express';
import type { ListUsersQuery } from '@caretrail/validation';
import { requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { sendData, sendList } from '../../utils/response.js';
import type { UserService } from './user.service.js';

type IdParams = { id: string };

export class UserController {
  constructor(private readonly service: UserService) {}

  list: RequestHandler = async (_req, res) => {
    const query = parsedQuery<ListUsersQuery>(res.locals);
    const { items, total } = await this.service.list(requireAuth(res.locals), query);
    sendList(res, items, { page: query.page, pageSize: query.pageSize, total });
  };

  get: RequestHandler<IdParams> = async (req, res) => {
    sendData(res, await this.service.get(requireAuth(res.locals), req.params.id));
  };

  create: RequestHandler = async (req, res) => {
    res.set('Cache-Control', 'no-store'); // response carries a one-time activation link
    sendData(res, await this.service.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  };

  update: RequestHandler<IdParams> = async (req, res) => {
    sendData(res, await this.service.update(requireAuth(res.locals), req.params.id, req.body, requestContext(req, res)));
  };

  setStatus: RequestHandler<IdParams> = async (req, res) => {
    sendData(res, await this.service.setStatus(requireAuth(res.locals), req.params.id, req.body, requestContext(req, res)));
  };

  issuePasswordLink: RequestHandler<IdParams> = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendData(res, await this.service.issuePasswordLink(requireAuth(res.locals), req.params.id, requestContext(req, res)), 201);
  };
}
