import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [entry, output] of [
  ['main.ts', 'main.js'],
  ['client.ts', 'client.js']
]) {
  await build({
    entryPoints: [resolve(root, 'src', entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['playwright'],
    outfile: resolve(outputDirectory, output),
    sourcemap: true,
    logLevel: 'info'
  });
}

console.log(`Built Collector Browser Host at ${outputDirectory}`);
