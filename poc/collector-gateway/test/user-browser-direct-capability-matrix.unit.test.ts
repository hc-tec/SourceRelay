import { describe, expect, test } from 'vitest';
import { listDirectCapabilities } from '../../collector-client/src/index.mjs';
import { listUserBrowserCapabilities } from '../src/user-browser-capabilities.js';
import { userBrowserCollectorServiceOpenApiDocument } from '../src/user-browser-collector-service-openapi.js';

const ORIGIN = 'http://127.0.0.1:43127';

function asSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

function schemaName(reference: { $ref: string }): string {
  return reference.$ref.split('/').at(-1) as string;
}

describe('user-owned browser direct capability matrix', () => {
  test('keeps catalog, client allowlist, OpenAPI requests, operations, and artifacts identical', () => {
    const catalog = listUserBrowserCapabilities();
    const names = catalog.map((entry) => entry.capability);
    const directNames = catalog
      .filter((entry) => entry.dispatchState === 'direct_ready')
      .map((entry) => entry.capability);
    const migrationNames = catalog
      .filter((entry) => entry.dispatchState !== 'direct_ready')
      .map((entry) => entry.capability);

    expect(catalog).toHaveLength(21);
    expect(new Set(names).size).toBe(names.length);
    expect(directNames).toHaveLength(18);
    expect(migrationNames).toHaveLength(3);
    expect(asSet(listDirectCapabilities())).toEqual(asSet(directNames));

    const document = userBrowserCollectorServiceOpenApiDocument(ORIGIN) as Record<string, any>;
    expect(document.paths['/v2/release']).toBeDefined();
    expect(document.components.schemas.CoreReleaseManifest).toBeDefined();
    const schemas = document.components.schemas as Record<string, any>;
    const requestCapabilities = document.components.schemas.UserBrowserCollectRequest.oneOf
      .map((reference: { $ref: string }) => schemas[schemaName(reference)].properties.capability.const);
    const operationCapabilities = schemas.Operation.properties.capability.enum;
    const artifactCapabilities = schemas.ArtifactResponse.properties.capability.enum;

    expect(asSet(requestCapabilities)).toEqual(asSet(directNames));
    expect(asSet(operationCapabilities)).toEqual(asSet(directNames));
    expect(asSet(artifactCapabilities)).toEqual(asSet(directNames));
    expect(directNames.filter((capability) => migrationNames.includes(capability))).toEqual([]);

    for (const capability of directNames) {
      const descriptor = catalog.find((entry) => entry.capability === capability);
      expect(descriptor?.dispatchState).toBe('direct_ready');
      expect(requestCapabilities).toContain(capability);
      expect(operationCapabilities).toContain(capability);
      expect(artifactCapabilities).toContain(capability);
    }

    for (const capability of migrationNames) {
      expect(requestCapabilities).not.toContain(capability);
      expect(operationCapabilities).not.toContain(capability);
      expect(artifactCapabilities).not.toContain(capability);
    }
  });
});
