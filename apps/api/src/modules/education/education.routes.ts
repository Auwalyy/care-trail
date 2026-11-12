import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { MAX_AUDIO_BYTES, type Language } from '@caretrail/shared-types';
import {
  audioParamsSchema,
  createEducationSchema,
  educationTransitionSchema,
  listEducationQuerySchema,
  objectIdSchema,
  updateEducationSchema,
  versionSchema,
  type ListEducationQuery,
} from '@caretrail/validation';
import { authorize, requireAuth } from '../../middleware/authenticate.js';
import { parsedQuery, validate } from '../../middleware/validate.js';
import { requestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { sendData, sendList } from '../../utils/response.js';
import type { EducationService } from './education.service.js';

const idParams = z.object({ id: objectIdSchema });
const versionQuery = z.object({ version: z.coerce.number().pipe(versionSchema) });
type Id = { id: string };
type AudioParams = { id: string; lang: Language };

/** Authors (`education:manage`) and reviewers (`education:approve`). */
const canAuthorOrReview: RequestHandler = (_req, res, next) => {
  const auth = requireAuth(res.locals);
  if (!auth.permissions.has('education:manage') && !auth.permissions.has('education:approve')) throw AppError.forbidden();
  next();
};

export function educationRoutes(deps: { service: EducationService; authenticate: RequestHandler }): Router {
  const s = deps.service;
  const r = Router();
  r.use(deps.authenticate, authorize('education:read'));

  r.get('/', validate({ query: listEducationQuerySchema }), async (_req, res) => {
    const q = parsedQuery<ListEducationQuery>(res.locals);
    const { items, total } = await s.list(requireAuth(res.locals), q);
    sendList(res, items, { page: q.page, pageSize: q.pageSize, total });
  });
  r.get('/:id', validate({ params: idParams }), async (req, res) => {
    sendData(res, await s.get(requireAuth(res.locals), (req.params as Id).id));
  });
  r.post('/', authorize('education:manage'), validate({ body: createEducationSchema }), async (req, res) => {
    sendData(res, await s.create(requireAuth(res.locals), req.body, requestContext(req, res)), 201);
  });
  r.patch('/:id', authorize('education:manage'), validate({ params: idParams, body: updateEducationSchema }), async (req, res) => {
    sendData(res, await s.update(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });
  r.post('/:id/transition', canAuthorOrReview, validate({ params: idParams, body: educationTransitionSchema }), async (req, res) => {
    sendData(res, await s.transition(requireAuth(res.locals), (req.params as Id).id, req.body, requestContext(req, res)));
  });

  // Audio: the raw file is the request body; `?version=` guards against overwriting newer edits.
  r.put(
    '/:id/audio/:lang',
    authorize('education:manage'),
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    validate({ params: audioParamsSchema, query: versionQuery }),
    async (req, res) => {
      const { id, lang } = req.params as AudioParams;
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      sendData(res, await s.putAudio(requireAuth(res.locals), id, lang, body, req.get('content-type') ?? '', parsedQuery<{ version: number }>(res.locals).version, requestContext(req, res)));
    },
  );
  r.delete('/:id/audio/:lang', authorize('education:manage'), validate({ params: audioParamsSchema, query: versionQuery }), async (req, res) => {
    const { id, lang } = req.params as AudioParams;
    sendData(res, await s.deleteAudio(requireAuth(res.locals), id, lang, parsedQuery<{ version: number }>(res.locals).version, requestContext(req, res)));
  });
  r.get('/:id/audio/:lang', validate({ params: audioParamsSchema }), async (req, res) => {
    const { id, lang } = req.params as AudioParams;
    const { body, contentType } = await s.getAudio(requireAuth(res.locals), id, lang);
    res.set({ 'Content-Type': contentType, 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  });
  return r;
}
