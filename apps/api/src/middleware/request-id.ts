import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts a well-formed inbound X-Request-Id (from a proxy) or generates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
