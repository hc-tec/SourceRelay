import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const pocRoot = resolve(scriptsDirectory, '..');
const runtimeRoot = resolve(pocRoot, 'runtime');
const outputArgument = readArgument('--output');
const outputDirectory = resolve(outputArgument ?? join(runtimeRoot, 'core-release-0.7.17'));
const explicitOutput = outputArgument !== null;

if (!explicitOutput && !isWithin(outputDirectory, runtimeRoot)) {
  throw new Error('core_release_output_outside_runtime');
}
if (explicitOutput) {
  const existing = await readdir(outputDirectory).catch(() => []);
  if (existing.length > 0) throw new Error('core_release_output_must_be_empty');
} else {
  await rm(outputDirectory, { recursive: true, force: true });
}
await mkdir(outputDirectory, { recursive: true });
const npmDirectory = join(outputDirectory, 'npm');
const pythonDirectory = join(outputDirectory, 'python');
const extensionDirectory = join(outputDirectory, 'extension');
const gatewayDirectory = join(outputDirectory, 'gateway');
const gatewayDistDirectory = join(gatewayDirectory, 'dist');
await Promise.all([
  mkdir(npmDirectory, { recursive: true }),
  mkdir(pythonDirectory, { recursive: true }),
  mkdir(extensionDirectory, { recursive: true }),
  mkdir(gatewayDirectory, { recursive: true }),
  mkdir(gatewayDistDirectory, { recursive: true })
]);

await runNpm(['run', 'build:user-browser-runtime'], pocRoot);
const release = await import('../collector-contracts/dist/core-release.js');
const releaseVersion = release.COLLECTOR_CORE_RELEASE_VERSION;
if (releaseVersion !== '0.7.17') throw new Error('core_release_version_anchor_invalid');

await packNpmWorkspace('@intelligence/collector-contracts', npmDirectory);
await packNpmWorkspace('@intelligence/collector-client', npmDirectory);
await packNpmWorkspace('@intelligence/collector-gateway', npmDirectory);
await runPython(['-m', 'pip', 'wheel', '--no-deps', '--wheel-dir', pythonDirectory, resolve(pocRoot, 'collector-python-client')], pocRoot);

await cp(resolve(pocRoot, 'collector-extension', 'dist'), extensionDirectory, { recursive: true });
await cp(resolve(pocRoot, 'collector-gateway', 'dist'), gatewayDistDirectory, { recursive: true });
await writeFile(join(gatewayDirectory, 'start-user-browser.ps1'), startScript(), 'utf8');

const packages = {
  contracts: await packageFile(npmDirectory, 'intelligence-collector-contracts', releaseVersion),
  javascriptSdk: await packageFile(npmDirectory, 'intelligence-collector-client', releaseVersion),
  gateway: await packageFile(npmDirectory, 'intelligence-collector-gateway', releaseVersion),
  pythonSdk: await packageFile(pythonDirectory, 'intelligence_collector_client', releaseVersion, '.whl')
};
if (Object.values(packages).some((value) => typeof value !== 'string')) {
  throw new Error('core_release_package_artifact_missing');
}
const sbom = await buildSbom(releaseVersion);
await writeFile(join(outputDirectory, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
const manifest = {
  schemaVersion: 1,
  product: 'collector-core',
  releaseVersion,
  service: release.collectorCoreReleaseManifest().service,
  boundaries: release.collectorCoreReleaseManifest().boundaries,
  packages,
  extension: {
    directory: 'extension',
    runtimeBuild: JSON.parse(await readFile(join(extensionDirectory, 'runtime-build.json'), 'utf8'))
  },
  gateway: {
    directory: 'gateway',
    entrypoint: 'dist/user-browser-server.js',
    launcher: 'start-user-browser.ps1'
  },
  sbom: {
    file: 'sbom.cdx.json',
    format: 'CycloneDX',
    specVersion: '1.5',
    source: 'poc/package-lock.json',
    deterministic: true
  },
  files: await fileManifest(outputDirectory)
};
await writeFile(join(outputDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const checksums = {
  schemaVersion: 1,
  algorithm: 'sha256',
  excludes: ['sha256sums.json'],
  files: await fileChecksums(outputDirectory)
};
await writeFile(join(outputDirectory, 'sha256sums.json'), `${JSON.stringify(checksums, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({
  ok: true,
  outputDirectory,
  releaseVersion,
  packages,
  sbom: 'sbom.cdx.json',
  checksums: 'sha256sums.json',
  extensionBuildFingerprint: manifest.extension.runtimeBuild.buildFingerprint,
  livePlatformRequests: 0
}, null, 2) + '\n');

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function isWithin(child, parent) {
  const childPath = resolve(child).toLowerCase();
  const parentPath = resolve(parent).toLowerCase();
  return childPath === parentPath || childPath.startsWith(parentPath + sep);
}

async function packNpmWorkspace(workspace, destination) {
  await runNpm(['pack', '--workspace', workspace, '--pack-destination', destination], pocRoot);
}

function packageFile(directory, stem, version, suffix = '.tgz') {
  const expected = `${stem}-${version}`;
  const file = readdir(directory).then((entries) => entries.find((entry) => entry.startsWith(expected) && entry.endsWith(suffix)));
  return file;
}

async function fileManifest(directory) {
  const files = [];
  await visit(directory, directory, files, new Set(['release-manifest.json', 'sha256sums.json']));
  return files.sort(compareFileRecords);
}

async function fileChecksums(directory) {
  const files = [];
  await visit(directory, directory, files, new Set(['sha256sums.json']), true);
  return files.sort(compareFileRecords);
}

async function visit(root, current, result, excludedNames, includeBytes = false) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) await visit(root, path, result, excludedNames, includeBytes);
    else {
      const bytes = await readFile(path);
      result.push({
        path: relative(root, path).replaceAll('\\', '/'),
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
}

function compareFileRecords(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function buildSbom(releaseVersion) {
  const lockfilePath = join(pocRoot, 'package-lock.json');
  const lockfileBytes = await readFile(lockfilePath);
  const lockfile = JSON.parse(lockfileBytes.toString('utf8'));
  const entries = [];
  for (const [lockPath, record] of Object.entries(lockfile.packages ?? {})) {
    if (!record || typeof record !== 'object' || typeof record.version !== 'string') continue;
    const packageJson = await packageMetadata(lockPath);
    const name = typeof record.name === 'string'
      ? record.name
      : typeof packageJson?.name === 'string' ? packageJson.name : packageNameFromLockPath(lockPath);
    if (!name) continue;
    const version = record.version;
    const component = {
      'bom-ref': `${name}@${version}`,
      type: 'library',
      name,
      version,
      scope: record.dev ? 'development' : record.optional ? 'optional' : 'required',
      purl: npmPurl(name, version)
    };
    const license = licenseValue(record, packageJson);
    if (license) component.licenses = [{ license: license.startsWith('LicenseRef-') ? { name: license } : { id: license } }];
    if (typeof record.resolved === 'string' && /^https?:\/\//.test(record.resolved)) {
      component.externalReferences = [{ type: 'distribution', url: record.resolved }];
    }
    if (typeof record.integrity === 'string') {
      const hashes = integrityHashes(record.integrity);
      if (hashes.length > 0) component.hashes = hashes;
    }
    entries.push(component);
  }
  entries.sort((left, right) => left['bom-ref'] < right['bom-ref'] ? -1 : left['bom-ref'] > right['bom-ref'] ? 1 : 0);
  const root = lockfile.packages?.[''] ?? {};
  const rootName = typeof root.name === 'string' ? root.name : lockfile.name;
  const rootVersion = typeof root.version === 'string' ? root.version : releaseVersion;
  return {
    '$schema': 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ vendor: 'SourceRelay', name: 'core release packager', version: releaseVersion }],
      component: {
        'bom-ref': `${rootName}@${rootVersion}`,
        type: 'application',
        name: rootName,
        version: rootVersion,
        purl: npmPurl(rootName, rootVersion)
      },
      properties: [{
        name: 'sourcerelay:package-lock-sha256',
        value: createHash('sha256').update(lockfileBytes).digest('hex')
      }]
    },
    components: entries
  };
}

async function packageMetadata(lockPath) {
  const packageJsonPath = lockPath === ''
    ? join(pocRoot, 'package.json')
    : join(pocRoot, lockPath, 'package.json');
  if (!isWithin(packageJsonPath, pocRoot)) return null;
  try { return JSON.parse(await readFile(packageJsonPath, 'utf8')); } catch { return null; }
}

function packageNameFromLockPath(lockPath) {
  const normalized = lockPath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments.at(-1);
  const scope = segments.at(-2);
  if (scope?.startsWith('@') && last) return `${scope}/${last}`;
  return last ?? null;
}

function licenseValue(record, packageJson) {
  const license = packageJson?.license ?? record.license;
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type;
  if (Array.isArray(packageJson?.licenses)) {
    const first = packageJson.licenses.find((entry) => typeof entry?.type === 'string');
    if (first) return first.type;
  }
  return null;
}

function integrityHashes(integrity) {
  return integrity.split(/\s+/).flatMap((entry) => {
    const match = entry.match(/^sha(1|256|384|512)-(.+)$/i);
    if (!match) return [];
    return [{ alg: `SHA-${match[1]}`, content: Buffer.from(match[2], 'base64').toString('hex') }];
  });
}

function npmPurl(name, version) {
  const encodedName = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${version}`;
}

function startScript() {
  return `param(\n  [int]$Port = 43127,\n  [string]$UserBrowserHome = (Join-Path $env:LOCALAPPDATA 'PersonalIntelligenceCollector')\n)\n$ErrorActionPreference = 'Stop'\n$env:COLLECTOR_GATEWAY_PORT = [string]$Port\n$env:COLLECTOR_USER_BROWSER_HOME = $UserBrowserHome\n$env:COLLECTOR_USER_BROWSER_STATE_DIR = (Join-Path $UserBrowserHome 'gateway')\nnode (Join-Path $PSScriptRoot 'dist\\user-browser-server.js')\n`;
}

function runNpm(args, cwd) {
  return run(process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'), process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args, cwd);
}

function runPython(args, cwd) {
  return run(process.platform === 'win32' ? 'python.exe' : 'python3', args, cwd);
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`core_release_command_failed:${command}:${code ?? signal}`)));
  });
}
