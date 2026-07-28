import type { SupportedPlatform } from './protocol';

export function buildNativeSearchUrl(platform: SupportedPlatform, query: string): URL {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  if (!normalizedQuery) throw new Error('A non-empty native platform query is required.');

  switch (platform) {
    case 'bilibili': {
      const url = new URL('https://search.bilibili.com/all');
      url.searchParams.set('keyword', normalizedQuery);
      return url;
    }
    case 'zhihu': {
      const url = new URL('https://www.zhihu.com/search');
      url.searchParams.set('type', 'content');
      url.searchParams.set('q', normalizedQuery);
      return url;
    }
    case 'weibo': {
      const url = new URL('https://s.weibo.com/weibo');
      url.searchParams.set('q', normalizedQuery);
      return url;
    }
    case 'xiaohongshu': {
      // Search-result routes are observed outcomes, not safe replay targets.
      // Start from an already-open Explore page and use trusted browser input.
      throw new Error('xiaohongshu_search_requires_trusted_page_input');
    }
  }
}

export function nativeSearchPlatform(url: URL): SupportedPlatform | 'unsupported' {
  if (url.hostname === 'search.bilibili.com' && url.pathname === '/all' && url.searchParams.has('keyword')) {
    return 'bilibili';
  }
  if (
    url.hostname === 'www.zhihu.com' &&
    url.pathname === '/search' &&
    url.searchParams.get('type') === 'content' &&
    url.searchParams.has('q')
  ) {
    return 'zhihu';
  }
  if (url.hostname === 's.weibo.com' && url.pathname === '/weibo' && url.searchParams.has('q')) {
    return 'weibo';
  }
  if (
    url.hostname === 'www.xiaohongshu.com' &&
    url.pathname === '/search_result_ai' &&
    url.searchParams.has('keyword')
  ) {
    return 'xiaohongshu';
  }
  return 'unsupported';
}
