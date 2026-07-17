import { createServer } from 'node:http';

export const nativeRouteFixtures = [
  {
    platform: 'bilibili',
    nativeUrl: 'https://search.bilibili.com/all?keyword=DeepSeek',
    expectedUrl: 'https://www.bilibili.com/video/BV1A411c7mD',
    html: `<!doctype html><html data-collector-platform="bilibili"><body>
      <a href="https://www.bilibili.com/video/BV1A411c7mD">B站测试视频</a>
      <a href="https://www.bilibili.com/video/BV1A411c7mD?from=search">重复结果</a>
    </body></html>`
  },
  {
    platform: 'zhihu',
    nativeUrl: 'https://www.zhihu.com/search?type=content&q=DeepSeek',
    expectedUrl: 'https://www.zhihu.com/question/123456789',
    html: `<!doctype html><html data-collector-platform="zhihu"><body>
      <a href="https://www.zhihu.com/question/123456789">知乎测试问题</a>
      <a href="https://zhuanlan.zhihu.com/p/987654321">知乎测试专栏</a>
    </body></html>`
  },
  {
    platform: 'weibo',
    nativeUrl: 'https://s.weibo.com/weibo?q=DeepSeek',
    expectedUrl: 'https://weibo.com/1234567890/AbCdEf',
    html: `<!doctype html><html data-collector-platform="weibo"><body>
      <a href="https://weibo.com/1234567890/AbCdEf">微博测试帖子</a>
    </body></html>`
  },
  {
    platform: 'xiaohongshu',
    nativeUrl: 'https://www.xiaohongshu.com/search_result_ai?keyword=DeepSeek&source=web_explore_feed',
    expectedUrl: 'https://www.xiaohongshu.com/explore/66abc123',
    html: `<!doctype html><html data-collector-platform="xiaohongshu"><body>
      <a href="https://www.xiaohongshu.com/explore/66abc123">小红书测试笔记</a>
    </body></html>`
  }
];

export async function startFixtureServer() {
  const byPlatform = new Map(nativeRouteFixtures.map((fixture) => [fixture.platform, fixture]));
  const server = createServer((request, response) => {
    const platform = (request.url ?? '').split('?', 1)[0].replace(/^\//, '');
    const fixture = byPlatform.get(platform);
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('fixture not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(fixture.html);
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
