import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION
} from '@intelligence/collector-contracts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pocRoot = resolve(root, '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(root, 'public', 'manifest.json');
const contractsSourceDirectory = resolve(root, '..', 'collector-contracts', 'src');
const buildFingerprint = await computeBuildFingerprint();

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== COLLECTOR_EXTENSION_VERSION) {
  throw new Error('collector_extension_manifest_version_mismatch');
}
await writeFile(
  resolve(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

const bundles = [
  {
    input: resolve(root, 'src', 'background', 'service-worker.ts'),
    output: resolve(outputDirectory, 'background.js'),
    format: 'esm'
  },
  {
    input: resolve(root, 'src', 'content', 'network-capture-bridge.ts'),
    output: resolve(outputDirectory, 'network-capture-bridge.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'content', 'bilibili-video-detail-document-bridge.ts'),
    output: resolve(outputDirectory, 'bilibili-video-detail-document-bridge.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'content', 'bilibili-account-video-inventory-document-bridge.ts'),
    output: resolve(outputDirectory, 'bilibili-account-video-inventory-document-bridge.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'content', 'bilibili-account-profile-document-bridge.ts'),
    output: resolve(outputDirectory, 'bilibili-account-profile-document-bridge.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'content', 'bilibili-native-search-document-bridge.ts'),
    output: resolve(outputDirectory, 'bilibili-native-search-document-bridge.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'content', 'main-world-network-observer.ts'),
    output: resolve(outputDirectory, 'main-world-network-observer.js'),
    format: 'iife'
  },
  {
    input: resolve(root, 'src', 'control', 'index.ts'),
    output: resolve(outputDirectory, 'control.js'),
    format: 'iife'
  }
];

for (const bundle of bundles) {
  await build({
    entryPoints: [bundle.input],
    bundle: true,
    format: bundle.format,
    outfile: bundle.output,
    target: 'chrome120',
    sourcemap: true,
    define: {
      __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__: JSON.stringify(buildFingerprint)
    },
    logLevel: 'info'
  });
}

for (const publicFile of ['control.html', 'control.css']) {
  await cp(resolve(root, 'public', publicFile), resolve(outputDirectory, publicFile));
}

// Keep this explicit so a future asset directory cannot become an unreviewed
// way to bundle browser state or test output into the extension package.
const assetsDirectory = resolve(root, 'public', 'assets');
try {
  await cp(assetsDirectory, resolve(outputDirectory, 'assets'), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

await writeFile(
  resolve(outputDirectory, 'runtime-build.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
    buildFingerprint
  }, null, 2)}\n`,
  'utf8'
);

console.log(`Built production extension at ${outputDirectory} (build ${buildFingerprint})`);

async function computeBuildFingerprint() {
  const files = [
    ...(await collectFiles(resolve(root, 'src'))),
    ...(await collectFiles(resolve(root, 'public'))),
    // The worker bundles shared contracts too.  Include their source in the
    // fingerprint so a changed runtime protocol cannot look like an already
    // verified extension build merely because extension-local files are same.
    ...(await collectFiles(contractsSourceDirectory)),
    resolve(root, 'package.json'),
    resolve(root, 'scripts', 'build.mjs')
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relativePath(file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function relativePath(path) {
  return relative(pocRoot, path).replaceAll('\\', '/');
}
