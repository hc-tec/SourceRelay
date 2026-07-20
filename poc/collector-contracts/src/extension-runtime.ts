/**
 * The compatibility identity shared by the production MV3 worker, Browser
 * Host's cold-start probe, and Gateway's Host client.  Keeping it in the
 * contracts package prevents the live worker from importing the retired
 * Gateway control-plane protocol merely to publish its own identity.
 */
export const COLLECTOR_EXTENSION_VERSION = '0.7.0' as const;
export const COLLECTOR_CONTROL_SURFACE_REVISION = 5 as const;
export const COLLECTOR_RUNTIME_BOOTSTRAP_KEY = 'collector.runtime-bootstrap.v1' as const;

export interface CollectorRuntimeBootstrap {
  schemaVersion: 1;
  collectorVersion: typeof COLLECTOR_EXTENSION_VERSION;
  controlSurfaceRevision: typeof COLLECTOR_CONTROL_SURFACE_REVISION;
}
