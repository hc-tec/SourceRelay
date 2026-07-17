import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testBuild = process.argv.includes('--test');
const outputDirectory = resolve(root, testBuild ? 'dist-test' : 'dist');
const manifestPath = resolve(root, 'public', 'manifest.json');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (testBuild) {
  manifest.name = `${manifest.name} (test)`;
  const fixtureMatch = 'http://127.0.0.1/*';
  manifest.host_permissions = [...manifest.host_permissions, fixtureMatch];
  manifest.content_scripts = manifest.content_scripts.map((entry) => ({
    ...entry,
    matches: [...entry.matches, fixtureMatch]
  }));
}

await writeFile(
  resolve(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

await build({
  entryPoints: [resolve(root, 'src', 'background', 'service-worker.ts')],
  bundle: true,
  format: 'esm',
  outfile: resolve(outputDirectory, 'background.js'),
  target: 'chrome120',
  sourcemap: true,
  define: { __COLLECTOR_TEST_BUILD__: JSON.stringify(testBuild) },
  logLevel: 'info'
});

await build({
  entryPoints: [resolve(root, 'src', 'content', 'index.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(outputDirectory, 'content.js'),
  target: 'chrome120',
  sourcemap: true,
  define: { __COLLECTOR_TEST_BUILD__: JSON.stringify(testBuild) },
  logLevel: 'info'
});

if (testBuild) {
  await writeFile(
    resolve(outputDirectory, 'test-driver.html'),
    '<!doctype html><meta charset="utf-8"><title>Collector extension test driver</title><script src="test-driver.js"></script>\n',
    'utf8'
  );
  await build({
    entryPoints: [resolve(root, 'src', 'test-driver.ts')],
    bundle: true,
    format: 'iife',
    outfile: resolve(outputDirectory, 'test-driver.js'),
    target: 'chrome120',
    sourcemap: true,
    define: { __COLLECTOR_TEST_BUILD__: JSON.stringify(testBuild) },
    logLevel: 'info'
  });
}

// Keep this explicit so a future asset directory cannot become an unreviewed
// way to bundle browser state or test output into the extension package.
const assetsDirectory = resolve(root, 'public', 'assets');
try {
  await cp(assetsDirectory, resolve(outputDirectory, 'assets'), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log(`Built ${testBuild ? 'test' : 'production'} extension at ${outputDirectory}`);
