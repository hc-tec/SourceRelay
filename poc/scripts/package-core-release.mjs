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
  files: await fileManifest(outputDirectory)
};
await writeFile(join(outputDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({
  ok: true,
  outputDirectory,
  releaseVersion,
  packages,
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
  await visit(directory, directory, files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function visit(root, current, result) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await visit(root, path, result);
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

function startScript() {
  return `$ErrorActionPreference = 'Stop'\nparam(\n  [int]$Port = 43127,\n  [string]$UserBrowserHome = (Join-Path $env:LOCALAPPDATA 'PersonalIntelligenceCollector')\n)\n$env:COLLECTOR_GATEWAY_PORT = [string]$Port\n$env:COLLECTOR_USER_BROWSER_HOME = $UserBrowserHome\n$env:COLLECTOR_USER_BROWSER_STATE_DIR = (Join-Path $UserBrowserHome 'gateway')\nnode (Join-Path $PSScriptRoot 'dist\\user-browser-server.js')\n`;
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
