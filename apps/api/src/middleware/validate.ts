import type { RequestHandler } from 'express';
import type { z } from 'zod';

export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Validates and replaces req.body / params, and stores the parsed query on res.locals.query
 * (Express 5 makes req.query a read-only getter). ZodErrors are turned into 400 responses by the
 * error handler.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) res.locals.query = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body);
    next();
  };
}
