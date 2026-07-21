import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(root, 'public', 'manifest.json');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
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

console.log(`Built production extension at ${outputDirectory}`);
