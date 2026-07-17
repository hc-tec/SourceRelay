import { createServer } from 'node:http';

const syntheticMarkers = {
  requestAuthorization: 'SYNTHETIC_REQUEST_AUTH_SECRET',
  responseAuthorization: 'SYNTHETIC_RESPONSE_AUTH_SECRET',
  responseToken: 'SYNTHETIC_RESPONSE_TOKEN_SECRET',
  responseSession: 'SYNTHETIC_RESPONSE_SESSION_SECRET',
  urlQuery: 'SYNTHETIC_XSEC_SECRET',
  bearerText: 'SYNTHETIC_BEARER_SECRET',
  disallowedRoute: 'SYNTHETIC_NOT_ALLOWED_RESULT'
};

export const nativeRouteFixtures = [
  {
    platform: 'bilibili',
    nativeUrl: 'https://search.bilibili.com/all?keyword=DeepSeek',
    expectedUrl: 'https://www.bilibili.com/video/BV1A411c7mD',
    html: '<a href="https://www.bilibili.com/video/BV1A411c7mD">B站测试视频</a><a href="https://www.bilibili.com/video/BV1A411c7mD?from=search">重复结果</a>'
  },
  {
    platform: 'zhihu',
    nativeUrl: 'https://www.zhihu.com/search?type=content&q=DeepSeek',
    expectedUrl: 'https://www.zhihu.com/question/123456789',
    html: '<a href="https://www.zhihu.com/question/123456789">知乎测试问题</a><a href="https://zhuanlan.zhihu.com/p/987654321">知乎测试专栏</a>'
  },
  {
    platform: 'weibo',
    nativeUrl: 'https://s.weibo.com/weibo?q=DeepSeek',
    expectedUrl: 'https://weibo.com/1234567890/AbCdEf',
    html: '<a href="https://weibo.com/1234567890/AbCdEf">微博测试帖子</a>'
  },
  {
    platform: 'xiaohongshu',
    nativeUrl: 'https://www.xiaohongshu.com/search_result_ai?keyword=DeepSeek&source=web_explore_feed',
    expectedUrl: 'https://www.xiaohongshu.com/explore/66abc123',
    html: '<a href="https://www.xiaohongshu.com/explore/66abc123">小红书测试笔记</a>'
  }
];

// An external, same-origin script deliberately runs under a strict CSP.  It
// waits for the observer/bridge handshake before issuing one fetch, one XHR,
// one oversized allowed response, and one disallowed route.  This makes the
// MAIN -> isolated -> Worker chain deterministic without a timing sleep.
const fixtureClientSource = `
(() => {
  const platform = document.documentElement.dataset.collectorPlatform;
  const requestMarker = ${JSON.stringify(syntheticMarkers.requestAuthorization)};

  function waitForObserver() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (document.documentElement.dataset.collectorNetworkCaptureObserver === 'ready') {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('observer handshake timed out'));
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  function xhrJson(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'json';
      xhr.setRequestHeader('Authorization', requestMarker);
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new Error('fixture xhr failed'));
      xhr.send();
    });
  }

  function exerciseXhrOpenArities() {
    const harmlessUrl = '/api/not-allowed?platform=' + encodeURIComponent(platform);
    new XMLHttpRequest().open('GET', harmlessUrl);
    new XMLHttpRequest().open('GET', harmlessUrl, true);
    new XMLHttpRequest().open('GET', harmlessUrl, true, null);
    new XMLHttpRequest().open('GET', harmlessUrl, true, null, null);
  }

  let stage = 'initial';
  async function run() {
    document.documentElement.dataset.fixtureNetworkState = 'running';
    stage = 'observer-handshake';
    await waitForObserver();
    document.documentElement.dataset.fixtureFetchArity = String(window.fetch.length);
    document.documentElement.dataset.fixtureXhrOpenArity = String(XMLHttpRequest.prototype.open.length);
    exerciseXhrOpenArities();
    document.documentElement.dataset.fixtureXhrOpenArities = 'ok';
    stage = 'fetch';
    await fetch('/api/network-search?platform=' + encodeURIComponent(platform) + '&sequence=fetch&xsec_token=' + requestMarker, {
      headers: { Authorization: requestMarker }
    }).then((response) => response.json());
    stage = 'xhr';
    await xhrJson('/api/network-search?platform=' + encodeURIComponent(platform) + '&sequence=xhr&token=' + requestMarker);
    stage = 'disallowed-route';
    await fetch('/api/not-allowed?platform=' + encodeURIComponent(platform) + '&token=' + requestMarker).then((response) => response.json());
    stage = 'large-response';
    await fetch('/api/network-search?platform=' + encodeURIComponent(platform) + '&sequence=large').then((response) => response.json());
    document.documentElement.dataset.fixtureNetworkState = 'complete';
  }

  void run().catch(() => {
    // Keep diagnostics non-sensitive: a failed stage is enough to pinpoint a
    // harness error, while raw browser exceptions can contain a request URL.
    document.documentElement.dataset.fixtureNetworkState = 'failed-' + stage;
  });
})();
`;

function fixtureHtml(fixture) {
  return `<!doctype html><html data-collector-platform="${fixture.platform}"><head>
    <meta charset="utf-8"><title>${fixture.platform} fixture</title>
    <script src="/fixture-client.js" defer></script>
  </head><body>${fixture.html}</body></html>`;
}

function networkPayload(platform, transport) {
  return {
    result: {
      platform,
      transport,
      title: `${platform} 网络夹具结果`,
      canonicalUrl: `https://safe.example/${platform}/item?xsec_token=${syntheticMarkers.urlQuery}`,
      description: `Bearer ${syntheticMarkers.bearerText}`,
      nested: [
        {
          keep: 'safe nested value',
          access_token: syntheticMarkers.responseToken,
          sessionId: syntheticMarkers.responseSession
        }
      ]
    },
    Authorization: syntheticMarkers.responseAuthorization
  };
}

function writeJson(response, statusCode, body) {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(text);
}

export function syntheticSecretLabels() {
  // Keep test output safe: assertions use labels rather than echoing values.
  return Object.keys(syntheticMarkers);
}

export function syntheticSecretValues() {
  return Object.values(syntheticMarkers);
}

export async function startFixtureServer() {
  const byPlatform = new Map(nativeRouteFixtures.map((fixture) => [fixture.platform, fixture]));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/fixture-client.js') {
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store'
      });
      response.end(fixtureClientSource);
      return;
    }

    if (url.pathname === '/api/network-search') {
      const platform = url.searchParams.get('platform');
      const sequence = url.searchParams.get('sequence');
      if (!byPlatform.has(platform)) {
        writeJson(response, 400, { error: 'unknown fixture platform' });
        return;
      }
      if (sequence === 'large') {
        // Deliberately stream without Content-Length.  The observer must stop
        // at its byte ceiling while reading response.clone(), rather than
        // relying solely on a declared header.
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'transfer-encoding': 'chunked'
        });
        response.write('{"result":{"padding":"');
        response.write('x'.repeat(100 * 1024));
        response.end('"}}');
        return;
      }
      writeJson(response, 200, networkPayload(platform, sequence === 'xhr' ? 'xhr' : 'fetch'));
      return;
    }

    if (url.pathname === '/api/not-allowed') {
      writeJson(response, 200, { result: syntheticMarkers.disallowedRoute });
      return;
    }

    const platform = url.pathname.replace(/^\//, '');
    const fixture = byPlatform.get(platform);
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('fixture not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'"
    });
    response.end(fixtureHtml(fixture));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
