import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Static cross-language contract gate for all registered direct providers.
 * The source packages intentionally do not import one another at runtime, so
 * this check reads the UTF-8 source declarations and compares their sets.
 */
export async function readCoreCapabilityMatrix(pocRoot = resolve(here, '..')) {
  const files = {
    registry: resolve(pocRoot, 'collector-gateway/src/user-browser-capability-registry.ts'),
    artifacts: resolve(pocRoot, 'collector-gateway/src/user-browser-artifact-reader-registry.ts'),
    openapi: resolve(pocRoot, 'collector-gateway/src/user-browser-collector-service-openapi.ts'),
    javascript: resolve(pocRoot, 'collector-client/src/constants.mjs'),
    python: resolve(pocRoot, 'collector-python-client/src/intelligence_collector/constants.py'),
    extension: resolve(pocRoot, 'collector-extension/src/background/user-browser-gateway-types.ts'),
    officialContract: resolve(pocRoot, 'collector-gateway/src/zhihu-official-contract.ts'),
    officialOpenApi: resolve(pocRoot, 'collector-gateway/src/zhihu-official-openapi.ts')
  };
  const source = {};
  for (const [name, path] of Object.entries(files)) source[name] = await readFile(path, 'utf8');

  const registry = extractObjectKeys(source.registry);
  const artifacts = extractObjectKeys(source.artifacts);
  const openapiRequests = [
    ...extractOpenApiRequestCapabilities(source.openapi),
    ...extractOfficialOpenApiRequestCapabilities(source.officialOpenApi)
  ];
  const openapiOperations = extractOpenApiEnum(source.openapi, 'Operation');
  const openapiArtifacts = extractOpenApiEnum(source.openapi, 'ArtifactResponse');
  const javascript = extractQuotedBlock(source.javascript, 'DIRECT_CAPABILITY_NAMES');
  const python = extractQuotedBlock(source.python, 'DIRECT_CAPABILITY_NAMES');
  const extension = extractQuotedBlock(source.extension, 'USER_BROWSER_DIRECT_WORK_CAPABILITIES');
  const officialRegistry = extractRegistryCapabilitiesByProvider(source.registry, 'official_api');
  const officialContract = [...source.officialContract.matchAll(
    /export const ZHIHU_OFFICIAL_[A-Z_]+_CAPABILITY\s*=\s*['"]([^'"]+)['"]/g
  )].map((match) => match[1]);

  return {
    registry, artifacts, openapiRequests, openapiOperations, openapiArtifacts, javascript, python,
    extension, officialRegistry, officialContract
  };
}

export function compareCoreCapabilityMatrix(matrix) {
  const baseline = [...new Set(matrix.registry)].sort();
  const mismatches = [];
  const providerSpecific = new Set(['extension', 'officialRegistry', 'officialContract']);
  for (const name of Object.keys(matrix).filter((name) => !providerSpecific.has(name))) {
    const values = [...new Set(matrix[name])].sort();
    if (values.join('\n') !== baseline.join('\n')) {
      mismatches.push({ source: name, expected: baseline, actual: values });
    }
  }
  if (matrix.officialRegistry || matrix.officialContract) {
    const officialRegistry = [...new Set(matrix.officialRegistry ?? [])].sort();
    const officialContract = [...new Set(matrix.officialContract ?? [])].sort();
    if (officialContract.join('\n') !== officialRegistry.join('\n')) {
      mismatches.push({ source: 'officialContract', expected: officialRegistry, actual: officialContract });
    }
    const browserBaseline = baseline.filter((capability) => !officialRegistry.includes(capability));
    const extension = [...new Set(matrix.extension ?? [])].sort();
    if (extension.join('\n') !== browserBaseline.join('\n')) {
      mismatches.push({ source: 'extension', expected: browserBaseline, actual: extension });
    }
  } else if (matrix.extension) {
    const extension = [...new Set(matrix.extension)].sort();
    if (extension.join('\n') !== baseline.join('\n')) {
      mismatches.push({ source: 'extension', expected: baseline, actual: extension });
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

function extractRegistryCapabilitiesByProvider(source, provider) {
  const entries = [...source.matchAll(/^\s{2}'([^']+)':\s*\{/gm)];
  const values = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const end = entries[index + 1]?.index ?? source.length;
    const block = source.slice(entry.index, end);
    if (block.includes(`executionProvider: '${provider}'`)) values.push(entry[1]);
  }
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

function extractOfficialOpenApiRequestCapabilities(source) {
  return [...source.matchAll(/officialRequestSchema\(\s*['"](?:zhihu|web)['"],\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
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
