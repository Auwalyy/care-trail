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
    },
  };
}
