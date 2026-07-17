import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright'],
  outfile: resolve(outputDirectory, 'server.js'),
  sourcemap: true,
  logLevel: 'info'
});

console.log(`Built loopback Collector Gateway at ${outputDirectory}`);
