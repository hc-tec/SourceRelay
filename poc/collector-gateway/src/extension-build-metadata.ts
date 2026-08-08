import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  COLLECTOR_RUNTIME_BUILD_METADATA_FILENAME,
  type CollectorRuntimeBuildMetadata
} from '@intelligence/collector-contracts';

/**
 * Read the build identity that the Gateway expects from the production MV3
 * artifact.  This is deliberately metadata-only: no browser credentials,
 * profile data, or extension storage is inspected.
 */
export async function readExtensionBuildFingerprint(extensionDirectory: string): Promise<string> {
  const raw = await readFile(resolve(extensionDirectory, COLLECTOR_RUNTIME_BUILD_METADATA_FILENAME), 'utf8');
  const value = JSON.parse(raw) as Partial<CollectorRuntimeBuildMetadata>;
  if (value.schemaVersion !== 1 || typeof value.buildFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.buildFingerprint)) {
    throw new Error('extension_runtime_build_metadata_invalid');
  }
  return value.buildFingerprint;
}
