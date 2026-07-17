import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let captureModulePromise;

async function loadCaptureModule() {
  if (!captureModulePromise) {
    captureModulePromise = build({
      entryPoints: [resolve(root, 'src', 'shared', 'network-capture.ts')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      write: false,
      define: { __COLLECTOR_TEST_BUILD__: 'true' }
    }).then(async (result) => {
      const source = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
    });
  }
  return captureModulePromise;
}

test('network route allowlist accepts only the exact test endpoint', async () => {
  const capture = await loadCaptureModule();
  assert.equal(
    capture.findNetworkCaptureRoute('zhihu', 'http://127.0.0.1:43123/api/network-search?token=synthetic')?.id,
    'test-native-search-response'
  );
  assert.equal(capture.findNetworkCaptureRoute('zhihu', 'http://127.0.0.1:43123/api/network-profile'), null);
  assert.equal(capture.findNetworkCaptureRoute('zhihu', 'https://example.invalid/api/network-search'), null);
  assert.equal(capture.findNetworkCaptureRoute('zhihu', 'data:application/json,{}'), null);
  assert.equal(
    capture.routeMatchesNetworkCaptureUrl(
      { id: 'test-native-search-response', platform: 'zhihu', origin: 'https://example.invalid', pathname: '/api/network-search' },
      'https://example.invalid:444/api/network-search'
    ),
    false,
    'production-style routes must compare the complete origin, including port'
  );
});

test('network projection removes nested credentials and redacts URL/text values', async () => {
  const capture = await loadCaptureModule();
  const route = capture.findNetworkCaptureRoute('bilibili', 'http://127.0.0.1:43123/api/network-search?token=synthetic');
  assert.ok(route);
  const observation = capture.createNetworkCaptureFromText(
    {
      platform: 'bilibili',
      route,
      method: 'GET',
      responseUrl: 'http://127.0.0.1:43123/api/network-search?xsec_token=SYNTHETIC_XSEC_SECRET',
      contentType: 'application/json; charset=utf-8',
      httpStatus: 200
    },
    JSON.stringify({
      title: '中文安全结果',
      inside: 'must remain because it is not the exact sid field',
      Authorization: 'SYNTHETIC_RESPONSE_AUTH_SECRET',
      nested: {
        access_token: 'SYNTHETIC_TOKEN_SECRET',
        sid: 'SYNTHETIC_SID_SECRET',
        user_sid: 'SYNTHETIC_USER_SID_SECRET',
        userSid: 'SYNTHETIC_CAMEL_SID_SECRET',
        url: 'https://safe.example/item?xsec_token=SYNTHETIC_XSEC_SECRET',
        description: 'Bearer SYNTHETIC_BEARER_SECRET'
      }
    })
  );
  assert.equal(observation?.status, 'captured');
  const serialised = JSON.stringify(observation);
  for (const marker of [
    'SYNTHETIC_RESPONSE_AUTH_SECRET',
    'SYNTHETIC_TOKEN_SECRET',
    'SYNTHETIC_SID_SECRET',
    'SYNTHETIC_USER_SID_SECRET',
    'SYNTHETIC_CAMEL_SID_SECRET',
    'SYNTHETIC_XSEC_SECRET',
    'SYNTHETIC_BEARER_SECRET'
  ]) {
    assert.equal(serialised.includes(marker), false, 'A synthetic secret escaped the projection.');
  }
  assert.equal(serialised.includes('Authorization'), false);
  assert.equal(serialised.includes('access_token'), false);
  assert.equal(observation?.body?.inside, 'must remain because it is not the exact sid field');
  assert.equal(observation?.responseUrl.includes('?'), false);
});

test('network projection rejects non-JSON and oversized bodies without retaining their text', async () => {
  const capture = await loadCaptureModule();
  const route = capture.findNetworkCaptureRoute('weibo', 'http://127.0.0.1:43123/api/network-search');
  assert.ok(route);
  const input = {
    platform: 'weibo',
    route,
    method: 'GET',
    responseUrl: 'http://127.0.0.1:43123/api/network-search?token=SYNTHETIC_TOKEN_SECRET',
    contentType: 'text/html',
    httpStatus: 200
  };
  const nonJson = capture.createNetworkCaptureFromText(input, '<h1>SYNTHETIC_TOKEN_SECRET</h1>');
  assert.deepEqual(
    { status: nonJson?.status, reason: nonJson?.rejectionReason, hasBody: Boolean(nonJson?.body) },
    { status: 'payload_rejected', reason: 'mime_not_allowed', hasBody: false }
  );
  const large = capture.createNetworkCaptureFromText(
    { ...input, contentType: 'application/json' },
    JSON.stringify({ padding: 'x'.repeat(capture.NETWORK_CAPTURE_MAX_BODY_BYTES + 1) })
  );
  assert.deepEqual(
    { status: large?.status, reason: large?.rejectionReason, hasBody: Boolean(large?.body) },
    { status: 'payload_rejected', reason: 'payload_too_large', hasBody: false }
  );
});

test('production route policy starts empty until a live observation is explicitly admitted', async () => {
  const source = await readFile(resolve(root, 'src', 'shared', 'network-capture.ts'), 'utf8');
  assert.match(source, /const productionRoutes: readonly NetworkCaptureRoute\[\] = \[\];/);
});
