import { BROWSER_HOST_PROTOCOL_VERSION } from './ipc.js';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION
} from './extension-runtime.js';
import { EXTENSION_WORK_PROTOCOL_VERSION, EXTENSION_WORK_SCHEMA_VERSION } from './extension-work.js';
import { NATIVE_BRIDGE_PROTOCOL_VERSION } from './native-bridge.js';

/** Public wire version for the user-owned-browser Local Collector Service. */
export const USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION = 2 as const;
export const USER_BROWSER_COLLECTOR_SERVICE_OPENAPI_VERSION = '2.0.0-experimental' as const;

/**
 * Compatibility identity for one Core release. The extension compatibility
 * version is the release anchor; protocol revisions describe the exact local
 * process and browser-worker handshake that must match it.
 */
export const COLLECTOR_CORE_RELEASE_SCHEMA_VERSION = 1 as const;
export const COLLECTOR_CORE_RELEASE_VERSION = COLLECTOR_EXTENSION_VERSION;

export interface CollectorCoreReleaseManifest {
  schemaVersion: typeof COLLECTOR_CORE_RELEASE_SCHEMA_VERSION;
  releaseVersion: typeof COLLECTOR_CORE_RELEASE_VERSION;
  product: 'collector-core';
  channel: 'source-compatible';
  service: {
    schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
    openApiVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_OPENAPI_VERSION;
  };
  protocols: {
    extensionControlSurfaceRevision: typeof COLLECTOR_CONTROL_SURFACE_REVISION;
    extensionWorkSchemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
    extensionWorkProtocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
    browserHostProtocolVersion: typeof BROWSER_HOST_PROTOCOL_VERSION;
    nativeBridgeProtocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  };
  boundaries: {
    browserMode: 'user_owned_browser_only';
    arbitraryBrowserControl: 'not_exposed';
    upperApplications: 'external_projects_only';
  };
}

const RELEASE_MANIFEST: CollectorCoreReleaseManifest = {
  schemaVersion: COLLECTOR_CORE_RELEASE_SCHEMA_VERSION,
  releaseVersion: COLLECTOR_CORE_RELEASE_VERSION,
  product: 'collector-core',
  channel: 'source-compatible',
  service: {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    openApiVersion: USER_BROWSER_COLLECTOR_SERVICE_OPENAPI_VERSION
  },
  protocols: {
    extensionControlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
    extensionWorkSchemaVersion: EXTENSION_WORK_SCHEMA_VERSION,
    extensionWorkProtocolVersion: EXTENSION_WORK_PROTOCOL_VERSION,
    browserHostProtocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
    nativeBridgeProtocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION
  },
  boundaries: {
    browserMode: 'user_owned_browser_only',
    arbitraryBrowserControl: 'not_exposed',
    upperApplications: 'external_projects_only'
  }
};

export function collectorCoreReleaseManifest(): CollectorCoreReleaseManifest {
  return structuredClone(RELEASE_MANIFEST);
}
