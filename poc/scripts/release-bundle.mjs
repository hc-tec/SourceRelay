import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Verify one packaged Core release directory without importing Core source or
 * contacting a registry, browser, Gateway, or platform.
 */
export async function verifyReleaseBundle(root, manifest) {
  const releaseRoot = resolve(root);
  if (manifest.schemaVersion !== 1 || manifest.sbom?.file !== 'sbom.cdx.json' ||
      manifest.sbom?.format !== 'CycloneDX' || manifest.sbom?.deterministic !== true ||
      !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('release_candidate_integrity_manifest_invalid');
  }
  const manifestFiles = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || manifestFiles.has(entry.path)) {
      throw new Error('release_candidate_manifest_file_entry_invalid');
    }
    const bytes = await releaseFile(releaseRoot, entry.path);
    const actual = fileDigest(bytes);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
      throw new Error(`release_candidate_manifest_file_hash_mismatch:${entry.path}`);
    }
    manifestFiles.set(entry.path, entry);
  }
  const actualPayload = await releaseFiles(releaseRoot, new Set(['release-manifest.json', 'sha256sums.json']));
  if (actualPayload.length !== manifestFiles.size ||
      actualPayload.some((entry) => !manifestFiles.has(entry.path))) {
    throw new Error('release_candidate_manifest_file_set_mismatch');
  }

  const sbom = JSON.parse((await releaseFile(releaseRoot, manifest.sbom.file)).toString('utf8'));
  const componentRefs = sbom.components?.map((component) => component?.['bom-ref']);
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5' ||
      !Array.isArray(sbom.components) || sbom.components.length === 0 ||
      !Array.isArray(sbom.metadata?.tools) ||
      sbom.metadata.tools[0]?.vendor !== 'SourceRelay' ||
      new Set(componentRefs).size !== componentRefs.length ||
      sbom.metadata.component?.version !== manifest.releaseVersion) {
    throw new Error('release_candidate_sbom_invalid');
  }

  const checksums = JSON.parse((await releaseFile(releaseRoot, 'sha256sums.json')).toString('utf8'));
  if (checksums.schemaVersion !== 1 || checksums.algorithm !== 'sha256' ||
      !Array.isArray(checksums.files) ||
      JSON.stringify(checksums.excludes) !== JSON.stringify(['sha256sums.json'])) {
    throw new Error('release_candidate_checksum_manifest_invalid');
  }
  const checksumFiles = new Map();
  for (const entry of checksums.files) {
    if (!entry || typeof entry.path !== 'string' || checksumFiles.has(entry.path)) {
      throw new Error('release_candidate_checksum_entry_invalid');
    }
    const bytes = await releaseFile(releaseRoot, entry.path);
    const actual = fileDigest(bytes);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
      throw new Error(`release_candidate_checksum_mismatch:${entry.path}`);
    }
    checksumFiles.set(entry.path, entry);
  }
  const expectedChecksumFiles = await releaseFiles(releaseRoot, new Set(['sha256sums.json']));
  if (expectedChecksumFiles.length !== checksumFiles.size ||
      expectedChecksumFiles.some((entry) => !checksumFiles.has(entry.path))) {
    throw new Error('release_candidate_checksum_file_set_mismatch');
  }
  return {
    releaseVersion: manifest.releaseVersion,
    manifestFiles: manifestFiles.size,
    checksumFiles: checksumFiles.size,
    sbomComponents: sbom.components.length
  };
}

export async function readReleaseManifest(root) {
  return JSON.parse(await readFile(join(resolve(root), 'release-manifest.json'), 'utf8'));
}

async function releaseFile(root, pathname) {
  return readFile(safeReleasePath(root, pathname));
}

function safeReleasePath(root, pathname) {
  if (!pathname || pathname.includes('\0') || pathname.startsWith('/') || pathname.startsWith('\\')) {
    throw new Error('release_candidate_path_invalid');
  }
  const target = resolve(root, pathname);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) throw new Error('release_candidate_path_escape');
  return target;
}

async function releaseFiles(root, excluded) {
  const files = [];
  await visitReleaseFiles(root, root, excluded, files);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function visitReleaseFiles(root, current, excluded, result) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = join(current, entry.name);
    if (entry.isDirectory()) await visitReleaseFiles(root, target, excluded, result);
    else if (entry.isFile()) {
      const bytes = await readFile(target);
      result.push({ path: relative(root, target).replaceAll('\\', '/'), ...fileDigest(bytes) });
    }
  }
}

function fileDigest(bytes) {
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
