import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pocRoot = resolve(hostRoot, '..');
const validationBrowserInstanceId = boundedRuntimeIdentifier(
  process.env.COLLECTOR_VALIDATION_BROWSER_INSTANCE ?? 'validation-browser',
  'validation_browser_instance'
);
const runtimeRoot = resolve(pocRoot, 'runtime', validationBrowserInstanceId, 'host');

export const browserHostMainModulePath = resolve(hostRoot, 'dist', 'main.js');
export const browserHostEndpointPath = resolve(runtimeRoot, 'endpoint.json');
export const browserHostStateDirectory = resolve(runtimeRoot, 'state');
export const browserProfileRoot = resolve(runtimeRoot, 'profiles');
export const extensionDirectory = resolve(pocRoot, 'collector-extension', 'dist');
export const validationProfileId = boundedRuntimeIdentifier(
  process.env.COLLECTOR_VALIDATION_PROFILE_ID ?? 'validation',
  'validation_profile_id'
);
/**
 * The default test fixture retains its explicit extension-control path. A
 * platform-specific validation browser can opt out so it cannot accidentally
 * be used by test-only extension-control commands.
 */
export const validationAutomationProfileId =
  process.env.COLLECTOR_VALIDATION_EXTENSION_CONTROL === 'disabled' ? null : validationProfileId;
/** A separate fixed control path for Xiaohongshu's pre-arm, never Bilibili's pairing fixture. */
export const xiaohongshuValidationAutomationProfileId =
  process.env.COLLECTOR_XIAOHONGSHU_VALIDATION_EXTENSION_CONTROL === 'enabled'
    ? validationProfileId
    : null;

export function validationBrowserPaths() {
  return {
    validationBrowserInstanceId,
    runtimeRoot,
    browserHostStateDirectory,
    browserHostEndpointPath,
    browserProfileRoot,
    extensionDirectory
  };
}

export async function readExtensionRuntimeExpectation() {
  const [manifestText, runtimeText] = await Promise.all([
    readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'),
    readFile(resolve(extensionDirectory, 'runtime-build.json'), 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  const runtime = JSON.parse(runtimeText);
  if (manifest?.manifest_version !== 3 || typeof manifest.version !== 'string') {
    throw new Error('validation_browser_extension_manifest_invalid');
  }
  if (runtime?.schemaVersion !== 1 ||
    typeof runtime.collectorVersion !== 'string' ||
    !Number.isSafeInteger(runtime.controlSurfaceRevision) || runtime.controlSurfaceRevision < 1 ||
    typeof runtime.buildFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.buildFingerprint) ||
    runtime.collectorVersion !== manifest.version) {
    throw new Error('validation_browser_runtime_build_metadata_invalid');
  }
  return {
    version: runtime.collectorVersion,
    controlSurfaceRevision: runtime.controlSurfaceRevision,
    runtimeBootstrapKey: 'collector.runtime-bootstrap.v1',
    buildFingerprint: runtime.buildFingerprint
  };
}

export function runtimeMatches(observed, expected) {
  return observed?.finalManifestVersion === expected.version &&
    observed.finalRuntimeVersion === expected.version &&
    observed.finalControlSurfaceRevision === expected.controlSurfaceRevision &&
    observed.finalBuildFingerprint === expected.buildFingerprint;
}

export function publicRuntime(expected, observed) {
  return {
    expected: {
      manifestVersion: expected.version,
      collectorVersion: expected.version,
      controlSurfaceRevision: expected.controlSurfaceRevision,
      buildFingerprint: expected.buildFingerprint
    },
    observed: observed
      ? {
          extensionId: observed.extensionId,
          manifestVersion: observed.finalManifestVersion,
          collectorVersion: observed.finalRuntimeVersion,
          controlSurfaceRevision: observed.finalControlSurfaceRevision,
          buildFingerprint: observed.finalBuildFingerprint,
          headlessProbePerformed: observed.headlessProbePerformed,
          reloadAttempted: observed.reloadAttempted,
          nativeBridgeConnected: observed.nativeBridgeConnected
        }
      : null
  };
}

function boundedRuntimeIdentifier(value, field) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}
