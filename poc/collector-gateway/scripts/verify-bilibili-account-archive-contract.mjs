import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-account-archive-'));
const contractBundle = join(temporaryDirectory, 'bilibili-account-archive-contract.mjs');

try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/bilibili-account-archive-contract.ts', import.meta.url))],
    outfile: contractBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  });
  const contract = await import(pathToFileURL(contractBundle).href);

  assert.equal(
    contract.normaliseBilibiliPublicImagePathname('/bfs/face/avatar.jpg'),
    '/bfs/face/avatar.jpg'
  );
  assert.equal(
    contract.normaliseBilibiliPublicImagePathname('/bfs/face/avatar.jpg@96w_96h_1c_1s.webp'),
    '/bfs/face/avatar.jpg'
  );
  assert.equal(
    contract.normaliseBilibiliPublicImagePathname('/bfs/face/avatar.png@240w_240h_1c_!web-avatar.avif'),
    '/bfs/face/avatar.png'
  );
  assert.equal(contract.normaliseBilibiliPublicImagePathname('bfs/face/avatar.jpg'), null);
  assert.equal(contract.normaliseBilibiliPublicImagePathname('/bfs/face/avatar.jpg?credential=x'), null);
  assert.equal(
    contract.canonicalBilibiliProfileUrl('https://space.bilibili.com/123456/upload/video'),
    'https://space.bilibili.com/123456'
  );
  assert.equal(
    contract.canonicalBilibiliProfileUrl('https://space.bilibili.com/123456?credential=x'),
    null
  );

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-account-archive-pure-contract',
    platformRequests: 0,
    verified: [
      'canonical_profile_url',
      'credential_query_rejected',
      'public_image_transform_path_normalisation'
    ]
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
