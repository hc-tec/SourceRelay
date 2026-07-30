import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Static cross-language contract gate for the user-owned-browser direct lane.
 * The source packages intentionally do not import one another at runtime, so
 * this check reads the UTF-8 source declarations and compares their sets.
 */
export async function readCoreCapabilityMatrix(pocRoot = resolve(here, '..')) {
  const files = {
    registry: resolve(pocRoot, 'collector-gateway/src/user-browser-capability-registry.ts'),
    artifacts: resolve(pocRoot, 'collector-gateway/src/user-browser-artifact-reader-registry.ts'),
    openapi: resolve(pocRoot, 'collector-gateway/src/user-browser-collector-service-openapi.ts'),
    javascript: resolve(pocRoot, 'collector-client/src/constants.mjs'),
    python: resolve(pocRoot, 'collector-python-client/src/intelligence_collector/constants.py')
  };
  const source = {};
  for (const [name, path] of Object.entries(files)) source[name] = await readFile(path, 'utf8');

  const registry = extractObjectKeys(source.registry);
  const artifacts = extractObjectKeys(source.artifacts);
  const openapiRequests = extractOpenApiRequestCapabilities(source.openapi);
  const openapiOperations = extractOpenApiEnum(source.openapi, 'Operation');
  const openapiArtifacts = extractOpenApiEnum(source.openapi, 'ArtifactResponse');
  const javascript = extractQuotedBlock(source.javascript, 'DIRECT_CAPABILITY_NAMES');
  const python = extractQuotedBlock(source.python, 'DIRECT_CAPABILITY_NAMES');

  return { registry, artifacts, openapiRequests, openapiOperations, openapiArtifacts, javascript, python };
}

export function compareCoreCapabilityMatrix(matrix) {
  const names = Object.keys(matrix);
  const baseline = [...new Set(matrix.registry)].sort();
  const mismatches = [];
  for (const name of names) {
    const values = [...new Set(matrix[name])].sort();
    if (values.join('\n') !== baseline.join('\n')) {
      mismatches.push({ source: name, expected: baseline, actual: values });
    }
  }
  return mismatches;
}

export async function assertCoreCapabilityMatrix(pocRoot = resolve(here, '..')) {
  const matrix = await readCoreCapabilityMatrix(pocRoot);
  const mismatches = compareCoreCapabilityMatrix(matrix);
  if (mismatches.length > 0) {
    const details = mismatches.map((entry) =>
      `${entry.source}: expected [${entry.expected.join(', ')}], got [${entry.actual.join(', ')}]`
    ).join('\n');
    throw new Error(`collector_core_capability_matrix_mismatch\n${details}`);
  }
  return matrix;
}

function extractObjectKeys(source) {
  const values = [];
  const pattern = /^\s*'([^']+)':/gm;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function extractQuotedBlock(source, name) {
  const start = source.indexOf(name);
  if (start < 0) throw new Error(`collector_core_capability_declaration_missing:${name}`);
  const end = source.indexOf(']);', start) >= 0
    ? source.indexOf(']);', start)
    : source.indexOf(')', start);
  if (end < 0) throw new Error(`collector_core_capability_declaration_unterminated:${name}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function extractOpenApiRequestCapabilities(source) {
  const values = [];
  const start = source.indexOf('UserBrowserCollectRequest:');
  const end = source.indexOf('QueuedOperationResponse:', start);
  if (start < 0 || end < 0) throw new Error('collector_core_openapi_request_schemas_missing');
  const requestSource = source.slice(start, end);
  const pattern = /capability:\s*\{\s*type:\s*['"]string['"],\s*const:\s*['"]([^'"]+)['"]/g;
  for (const match of requestSource.matchAll(pattern)) values.push(match[1]);
  for (const match of requestSource.matchAll(/profileCollectRequest\(['"]([^'"]+)['"]\)/g)) values.push(match[1]);
  return [...new Set(values)];
}

function extractOpenApiEnum(source, schemaName) {
  const schemaStart = source.indexOf(`${schemaName}:`);
  if (schemaStart < 0) throw new Error(`collector_core_openapi_schema_missing:${schemaName}`);
  const capabilityStart = source.indexOf('capability:', schemaStart);
  const enumStart = source.indexOf('enum:', capabilityStart);
  const end = source.indexOf(']', enumStart);
  if (capabilityStart < 0 || enumStart < 0 || end < 0) throw new Error(`collector_core_openapi_enum_missing:${schemaName}`);
  return [...source.slice(enumStart, end).matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}
