import { z } from 'zod';
import {
  changePasswordSchema,
  createUserSchema,
  forgotPasswordSchema,
  listUsersQuerySchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
  setUserStatusSchema,
  updateUserSchema,
} from '@caretrail/validation';

/**
 * OpenAPI 3.1 document. Modules add their paths here as they are implemented, so the published
 * contract never documents endpoints that don't exist yet.
 */
export function buildOpenApiDocument(version: string) {
  const errorResponse = { $ref: '#/components/responses/Error' };
  return {
    openapi: '3.1.0',
    info: {
      title: 'CARETRAIL API',
      version,
      description:
        'Offline-first community healthcare navigation, referral and follow-up platform. ' +
        'CARETRAIL coordinates care; it does not diagnose or prescribe.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      schemas: {
        HealthStatus: {
          type: 'object',
          required: ['status', 'service', 'version', 'uptimeSeconds', 'timestamp'],
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
            service: { type: 'string' },
            version: { type: 'string' },
            uptimeSeconds: { type: 'integer' },
            timestamp: { type: 'string', format: 'date-time' },
            checks: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['up', 'down'] },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        ErrorBody: {
          type: 'object',
          required: ['error', 'meta'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
              },
            },
            meta: { type: 'object', properties: { requestId: { type: 'string' } } },
          },
        },
      },
      responses: {
        Error: {
          description: 'Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe',
          responses: {
            '200': {
              description: 'Process is running',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } } },
            },
          },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe (checks MongoDB)',
          responses: {
            '200': {
              description: 'Ready',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } } },
            },
            '503': {
              description: 'A dependency is down',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } } },
            },
            default: errorResponse,
          },
        },
      },
      ...authAndUserPaths(),
    },
  };
}

// ── Auth & users (request bodies generated from the shared Zod schemas) ───────

/** JSON Schema for a request body, from the same Zod schema the API validates with. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) } },
  };
}

const ok = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
const err = { $ref: '#/components/responses/Error' };
const secured = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } };

function authAndUserPaths() {
  return {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in. Web clients get the refresh token as an httpOnly cookie; mobile clients in the body.',
        requestBody: body(loginSchema),
        responses: { '200': ok('Session issued'), '401': err, '429': err },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token (cookie or body) and get a new access token',
        requestBody: { ...body(refreshSchema), required: false },
        responses: { '200': ok('Session rotated'), '401': err },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Revoke this session, or all sessions', requestBody: body(logoutSchema), responses: { '204': { description: 'Signed out' } } },
    },
    '/auth/forgot-password': {
      post: { tags: ['Auth'], summary: 'Request a reset link (always 202)', requestBody: body(forgotPasswordSchema), responses: { '202': ok('Accepted') } },
    },
    '/auth/reset-password': {
      post: { tags: ['Auth'], summary: 'Complete activation or password reset', requestBody: body(resetPasswordSchema), responses: { '200': ok('Password set'), '400': err } },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user and permissions', security: secured, responses: { '200': ok('Current user'), '401': err } },
    },
    '/auth/change-password': {
      post: { tags: ['Auth'], summary: 'Change password; signs out other devices', security: secured, requestBody: body(changePasswordSchema), responses: { '200': ok('New session'), '400': err } },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users within your scope (user:read)',
        security: secured,
        parameters: Object.keys(listUsersQuerySchema.shape).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
        responses: { '200': ok('Paged users'), '403': err },
      },
      post: {
        tags: ['Users'],
        summary: 'Create a user (user:manage). Returns a one-time activation link.',
        security: secured,
        requestBody: body(createUserSchema),
        responses: { '201': ok('User created'), '400': err, '403': err, '409': err },
      },
    },
    '/users/{id}': {
      get: { tags: ['Users'], summary: 'Get a user', security: secured, parameters: [idParam], responses: { '200': ok('User'), '404': err } },
      patch: { tags: ['Users'], summary: 'Update a user (optimistic concurrency)', security: secured, parameters: [idParam], requestBody: body(updateUserSchema), responses: { '200': ok('Updated'), '409': err } },
    },
    '/users/{id}/status': {
      post: { tags: ['Users'], summary: 'Activate or deactivate (deactivation revokes all sessions)', security: secured, parameters: [idParam], requestBody: body(setUserStatusSchema), responses: { '200': ok('Updated'), '409': err } },
    },
    '/users/{id}/password-link': {
      post: { tags: ['Users'], summary: 'Issue an activation or reset link to hand to the user', security: secured, parameters: [idParam], responses: { '201': ok('Link issued') } },
    },
  };
}
