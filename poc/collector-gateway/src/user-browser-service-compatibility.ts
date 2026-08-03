import { canonicalJson, sha256Hex } from './canonical-json';
import { listUserBrowserCapabilities } from './user-browser-capabilities';
import {
  USER_BROWSER_CAPABILITY_REGISTRY,
  listUserBrowserExecutableCapabilities,
  type UserBrowserCapabilityBudgetPolicy,
  type UserBrowserExecutableCapability
} from './user-browser-capability-registry';
import { userBrowserCollectorServiceOpenApiDocument } from './user-browser-collector-service-openapi';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';

export const USER_BROWSER_SERVICE_FEATURES = [
  'artifacts.canonical_json_utf8_window.v1',
  'artifacts.metadata.v1',
  'capabilities.direct_contracts.v1',
  'collect.client_request_id.v1',
  'operations.exact_core_state.v1'
] as const;

export interface UserBrowserDirectCapabilityContract {
  capability: UserBrowserExecutableCapability;
  requestSchemaRef: string;
  requestSchemaDigest: string;
  executionTargets: readonly string[];
  defaultExecutionTarget: string;
  executionTargetMode: 'fixed' | 'enum';
  budgetPolicy: UserBrowserCapabilityBudgetPolicy;
}

export interface UserBrowserCapabilityCatalogContract {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  catalogDigest: string;
  capabilities: ReturnType<typeof listUserBrowserCapabilities>;
  directContracts: UserBrowserDirectCapabilityContract[];
}

export interface UserBrowserServiceCompatibility {
  schemaVersion: 1;
  digestAlgorithm: 'sha256-canonical-json-v1';
  openApiSchemaDigest: string;
  capabilityCatalogDigest: string;
  features: readonly typeof USER_BROWSER_SERVICE_FEATURES[number][];
}

export function userBrowserCapabilityCatalogContract(
  loopbackOrigin: string
): UserBrowserCapabilityCatalogContract {
  const document = userBrowserCollectorServiceOpenApiDocument(loopbackOrigin);
  const schemas = openApiSchemas(document);
  const directContracts = listUserBrowserExecutableCapabilities().map((capability) => {
    const registry = USER_BROWSER_CAPABILITY_REGISTRY[capability];
    const schema = schemas[registry.requestSchemaName];
    if (!schema) throw new Error('user_browser_capability_request_schema_missing');
    return {
      capability,
      requestSchemaRef: `#/components/schemas/${registry.requestSchemaName}`,
      requestSchemaDigest: digest(schema),
      executionTargets: [...registry.executionTargets],
      defaultExecutionTarget: registry.executionTargets[0]!,
      executionTargetMode: registry.executionTargets.length === 1 ? 'fixed' as const : 'enum' as const,
      budgetPolicy: registry.budgetPolicy
    };
  });
  const capabilities = listUserBrowserCapabilities();
  return {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    catalogDigest: digest({ capabilities, directContracts }),
    capabilities,
    directContracts
  };
}

export function userBrowserServiceCompatibility(loopbackOrigin: string): UserBrowserServiceCompatibility {
  const document = userBrowserCollectorServiceOpenApiDocument(loopbackOrigin);
  const catalog = userBrowserCapabilityCatalogContract(loopbackOrigin);
  const schemaIdentity = record(document);
  const { servers: _servers, ...originIndependentDocument } = schemaIdentity;
  return {
    schemaVersion: 1,
    digestAlgorithm: 'sha256-canonical-json-v1',
    openApiSchemaDigest: digest(originIndependentDocument),
    capabilityCatalogDigest: catalog.catalogDigest,
    features: [...USER_BROWSER_SERVICE_FEATURES]
  };
}

function openApiSchemas(document: Record<string, unknown>): Record<string, unknown> {
  const components = record(document.components);
  return record(components.schemas);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('user_browser_openapi_shape_invalid');
  }
  return value as Record<string, unknown>;
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
