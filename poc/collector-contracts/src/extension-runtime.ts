/**
 * The compatibility identity shared by the production MV3 worker, Browser
 * Host's cold-start probe, and Gateway's Host client.  Keeping it in the
 * contracts package prevents the live worker from importing the retired
 * Gateway control-plane protocol merely to publish its own identity.
 */
// Public compatibility identity.  Keep this stable across ordinary internal
// implementation work; it changes only for a deliberate release or wire
// compatibility boundary.
export const COLLECTOR_EXTENSION_VERSION = '0.7.17' as const;
export const COLLECTOR_CONTROL_SURFACE_REVISION = 15 as const;
export const COLLECTOR_RUNTIME_BOOTSTRAP_KEY = 'collector.runtime-bootstrap.v1' as const;
export const COLLECTOR_RUNTIME_BUILD_METADATA_FILENAME = 'runtime-build.json' as const;

export interface CollectorRuntimeBuildMetadata {
  schemaVersion: 1;
  buildFingerprint: string;
}

export interface CollectorRuntimeBootstrap {
  schemaVersion: 1;
  collectorVersion: typeof COLLECTOR_EXTENSION_VERSION;
  controlSurfaceRevision: typeof COLLECTOR_CONTROL_SURFACE_REVISION;
  buildFingerprint: string;
}
