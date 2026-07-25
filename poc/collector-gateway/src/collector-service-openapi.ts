import {
  COLLECTOR_SERVICE_CAPABILITIES,
  COLLECTOR_SERVICE_SCHEMA_VERSION,
  collectorServiceCapabilities,
  type CollectorServiceCapabilityDescriptor
} from './collector-service-contract';
import { COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION } from './collector-service-input-schemas';

export const COLLECTOR_SERVICE_OPENAPI_VERSION = '1.0.0-experimental' as const;
export const COLLECTOR_SERVICE_OPENAPI_FORMAT = '3.1.0' as const;

/**
 * Machine-readable contract for external local consumers only.  Console
 * administration, audit reads, browser lifecycle, pairing, Profile paths,
 * and any arbitrary browser control are intentionally omitted.
 */
export function collectorServiceOpenApiDocument(loopbackOrigin: string): Record<string, unknown> {
  const origin = validatedLoopbackOrigin(loopbackOrigin);
  const capabilities = collectorServiceCapabilities();
  const inputComponents = Object.fromEntries(capabilities.map((descriptor) => [
    descriptor.input,
    descriptor.inputSchema
  ]));
  const requestVariants = capabilities.map((descriptor) => requestVariant(descriptor));

  return structuredClone({
    openapi: COLLECTOR_SERVICE_OPENAPI_FORMAT,
    info: {
      title: 'Local Collector Service',
      version: COLLECTOR_SERVICE_OPENAPI_VERSION,
      description: 'Loopback-only, registered-capability collection API. It is not a generic browser-control API.'
    },
    servers: [{ url: origin }],
    tags: [{ name: 'collector-service', description: 'Registered local collection capabilities.' }],
    paths: {
      '/v1/openapi.json': {
        get: {
          tags: ['collector-service'],
          operationId: 'getCollectorServiceOpenApi',
          summary: 'Read this machine-readable external consumer contract.',
          responses: {
            '200': jsonResponse('The current OpenAPI document.', { type: 'object' })
          }
        }
      },
      '/v1/capabilities': {
        get: {
          tags: ['collector-service'],
          operationId: 'listCollectorServiceCapabilities',
          summary: 'List registered capabilities and their input JSON Schema.',
          responses: {
            '200': jsonResponse('The registered capability catalog.', { $ref: '#/components/schemas/CapabilityCatalog' })
          }
        }
      },
      '/v1/collector-service/profiles': {
        get: {
          tags: ['collector-service'],
          operationId: 'listCollectorServiceProfiles',
          summary: 'List compatible managed Collection Profiles.',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'profiles:read',
          responses: {
            '200': jsonResponse('A safe Profile directory.', { $ref: '#/components/schemas/ProfileCatalog' }),
            '401': errorResponse('Missing, malformed, or revoked local service token.'),
            '403': errorResponse('A browser-origin request or a token without this scope was rejected.')
          }
        }
      },
      '/v1/collect': {
        post: {
          tags: ['collector-service'],
          operationId: 'collectRegisteredCapability',
          summary: 'Run one registered capability against a compatible managed Collection Profile.',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'collect:execute',
          'x-collector-browser-control': 'not_exposed',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CollectorServiceRequest' } }
            }
          },
          responses: {
            '201': jsonResponse('Operation summary and controlled artifact retrieval path.', {
              $ref: '#/components/schemas/CollectorServiceResult'
            }),
            '400': errorResponse('Malformed request or capability input rejected before publication.'),
            '401': errorResponse('Missing, malformed, or revoked local service token.'),
            '403': errorResponse('A browser-origin request or a token without this scope was rejected.'),
            '409': errorResponse('A bounded runner cannot safely start or resume.')
          }
        }
      },
      '/v1/collect/artifacts/{capability}/{artifactId}': {
        get: {
          tags: ['collector-service'],
          operationId: 'readCollectorServiceArtifact',
          summary: 'Read an artifact through the retrieval path returned by a successful collect response.',
          security: [{ CollectorServiceToken: [] }],
          'x-collector-required-scope': 'artifacts:read',
          parameters: [
            {
              name: 'capability',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: COLLECTOR_SERVICE_CAPABILITIES }
            },
            {
              name: 'artifactId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' }
            }
          ],
          responses: {
            '200': jsonResponse('A capability-bound raw-first local artifact.', {
              $ref: '#/components/schemas/ArtifactReadResponse'
            }),
            '401': errorResponse('Missing, malformed, or revoked local service token.'),
            '403': errorResponse('A browser-origin request or a token without this scope was rejected.'),
            '404': errorResponse('The registered capability or artifact was not found.')
          }
        }
      }
    },
    components: {
      securitySchemes: {
        CollectorServiceToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'cst',
          description: 'Revocable local service token issued once by the Gateway Console. It is not a platform credential.'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'ok', 'error'],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            ok: { type: 'boolean', const: false },
            error: { type: 'string', pattern: '^[a-z0-9_.-]{1,120}$' }
          }
        },
        CapabilityCatalog: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'capabilities'],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            capabilities: {
              type: 'array',
              items: { $ref: '#/components/schemas/CapabilityDescriptor' }
            }
          }
        },
        CapabilityDescriptor: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'status', 'execution',
            'requiresProfile', 'input', 'inputSchemaRevision', 'inputSchema', 'output'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            capability: { type: 'string', enum: COLLECTOR_SERVICE_CAPABILITIES },
            platform: { type: 'string', const: 'bilibili' },
            status: { type: 'string', enum: ['available', 'experimental'] },
            execution: { type: 'string', const: 'synchronous_runner_mvp' },
            requiresProfile: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'accountCategory'],
              properties: {
                kind: { type: 'string', const: 'collection' },
                accountCategory: { type: 'string', const: 'user_managed' }
              }
            },
            input: { type: 'string' },
            inputSchemaRevision: { type: 'integer', const: COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION },
            inputSchema: { type: 'object' },
            output: { type: 'string', const: 'operation_summary_and_artifact_reference' }
          }
        },
        ProfileCatalog: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'profiles'],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            profiles: { type: 'array', items: { $ref: '#/components/schemas/CollectorServiceProfile' } }
          }
        },
        CollectorServiceProfile: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'profileId', 'platform', 'accountLabel'],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            profileId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', const: 'bilibili' },
            accountLabel: { type: 'string', minLength: 1, maxLength: 80 }
          }
        },
        CollectorServiceRequest: {
          oneOf: requestVariants,
          description: 'profileId is an existing managed Collection Profile. It must never be copied into input.'
        },
        CollectorServiceResult: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion', 'capability', 'platform', 'profileId', 'operationId', 'operationKind',
            'state', 'errorCode', 'terminalReason', 'coverage', 'artifact'
          ],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            capability: { type: 'string', enum: COLLECTOR_SERVICE_CAPABILITIES },
            platform: { type: 'string', const: 'bilibili' },
            profileId: { type: 'string', format: 'uuid' },
            operationId: { type: 'string', format: 'uuid' },
            operationKind: { type: 'string', enum: ['run', 'batch'] },
            state: { type: 'string', enum: ['completed', 'partial', 'failed'] },
            errorCode: { type: ['string', 'null'] },
            terminalReason: { type: ['string', 'null'] },
            coverage: {},
            artifact: { $ref: '#/components/schemas/CollectorServiceArtifactReference' }
          }
        },
        CollectorServiceArtifactReference: {
          type: 'object',
          additionalProperties: false,
          required: ['artifactId', 'retrievalPath', 'summary'],
          properties: {
            artifactId: { type: 'string', format: 'uuid' },
            retrievalPath: {
              type: 'string',
              pattern: '^/v1/collect/artifacts/[a-z0-9._-]{1,120}/[0-9a-f-]{36}$'
            },
            summary: { type: 'object' }
          }
        },
        ArtifactReadResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'capability', 'artifact'],
          properties: {
            schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
            capability: { type: 'string', enum: COLLECTOR_SERVICE_CAPABILITIES },
            artifact: { type: 'object' }
          }
        },
        ...inputComponents
      }
    },
    'x-collector-service-schema-version': COLLECTOR_SERVICE_SCHEMA_VERSION,
    'x-collector-input-schema-revision': COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION,
    'x-collector-excluded-surfaces': [
      'console_administration',
      'audit_read',
      'browser_lifecycle',
      'profile_paths',
      'arbitrary_url',
      'arbitrary_selector',
      'arbitrary_script',
      'arbitrary_pointer_input',
      'arbitrary_network_route'
    ]
  });
}

function requestVariant(descriptor: CollectorServiceCapabilityDescriptor): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'profileId', 'platform', 'capability', 'input'],
    properties: {
      schemaVersion: { type: 'integer', const: COLLECTOR_SERVICE_SCHEMA_VERSION },
      profileId: { type: 'string', format: 'uuid' },
      platform: { type: 'string', const: descriptor.platform },
      capability: { type: 'string', const: descriptor.capability },
      input: { $ref: `#/components/schemas/${descriptor.input}` }
    }
  };
}

function jsonResponse(description: string, schema: Record<string, unknown>): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema } }
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return jsonResponse(description, { $ref: '#/components/schemas/ErrorResponse' });
}

function validatedLoopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('collector_service_openapi_origin_invalid');
  }
  if (
    url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error('collector_service_openapi_origin_invalid');
  }
  return url.origin;
}
