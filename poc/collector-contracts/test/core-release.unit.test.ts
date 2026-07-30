import { describe, expect, test } from 'vitest';
import {
  COLLECTOR_CORE_RELEASE_VERSION,
  collectorCoreReleaseManifest,
  USER_BROWSER_COLLECTOR_SERVICE_OPENAPI_VERSION,
  USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION
} from '../src/index.js';

describe('Collector Core release manifest', () => {
  test('publishes the exact local compatibility tuple and keeps it detached', () => {
    const manifest = collectorCoreReleaseManifest();
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseVersion: COLLECTOR_CORE_RELEASE_VERSION,
      product: 'collector-core',
      channel: 'source-compatible',
      service: {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        openApiVersion: USER_BROWSER_COLLECTOR_SERVICE_OPENAPI_VERSION
      },
      boundaries: {
        browserMode: 'user_owned_browser_only',
        arbitraryBrowserControl: 'not_exposed',
        upperApplications: 'external_projects_only'
      }
    });
    (manifest as any).protocols.extensionWorkProtocolVersion = 999;
    expect(collectorCoreReleaseManifest().protocols.extensionWorkProtocolVersion).not.toBe(999);
  });
});
