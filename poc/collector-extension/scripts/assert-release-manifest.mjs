import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(outputDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3, 'release artifact must be Manifest V3');
assert.equal(manifest.name.includes('(test)'), false, 'release artifact must not be test-branded');

const forbiddenPermissions = new Set(['cookies', 'debugger', 'downloads', 'webRequest', 'webRequestBlocking']);
for (const permission of manifest.permissions ?? []) {
  assert.equal(forbiddenPermissions.has(permission), false, `forbidden release permission: ${permission}`);
}

const allMatches = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? [])
];
assert.equal(allMatches.includes('<all_urls>'), false, 'release artifact must not use <all_urls>');
assert.equal(
  allMatches.some((match) => /^https?:\/\/(?:127\.0\.0\.1|localhost)/.test(match)),
  false,
  'release artifact must not contain test-only localhost matches'
);

for (const script of [manifest.background?.service_worker, ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])]) {
  assert.equal(typeof script, 'string', 'release manifest must reference extension JavaScript');
  await access(resolve(outputDirectory, script));
}

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
console.log(JSON.stringify({ ok: true, manifest: 'dist/manifest.json', sha256: digest }, null, 2));
