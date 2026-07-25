import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const userBrowserOnly = process.argv.slice(2).includes('--user-browser-only');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: userBrowserOnly
    ? { 'user-browser-server': resolve(root, 'src', 'user-browser-server.ts') }
    : {
      'user-browser-server': resolve(root, 'src', 'user-browser-server.ts'),
      'isolated-browser-server': resolve(root, 'src', 'server.ts')
    },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: outputDirectory,
  sourcemap: true,
  logLevel: 'info'
});

console.log(
  userBrowserOnly
    ? `Built user-browser Collector Gateway at ${outputDirectory}`
    : `Built user-browser and isolated-browser Collector Gateways at ${outputDirectory}`
);
