import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(root, 'dist', 'server.js');
await access(artifact);
const source = await readFile(artifact, 'utf8');

assert.match(source, /127\.0\.0\.1/, 'Gateway artifact must bind an IPv4 loopback address');
assert.doesNotMatch(source, /0\.0\.0\.0/, 'Gateway artifact must not contain an all-interface bind address');
assert.doesNotMatch(source, /express|fastify|koa/i, 'Gateway build must remain on the reviewed Node HTTP surface');

console.log(JSON.stringify({
  ok: true,
  gate: 'collector-gateway-build-artifact',
  artifact: 'dist/server.js'
}, null, 2));
