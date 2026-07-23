import type { BilibiliDanmakuDomSnapshot } from '../../shared/bilibili-danmaku-capture';

/**
 * Reads only the public, human-visible Bilibili danmaku DOM. The binary
 * `seg.so` network stream is deliberately not consumed here.
 */
export async function captureBilibiliDanmakuDom(
  tabId: number,
  documentId: string
): Promise<BilibiliDanmakuDomSnapshot> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    world: 'ISOLATED',
    func: () => {
      const clean = (value: string | null | undefined, maximum = 4_000): string =>
        (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
      const rendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const finite = (value: string | null | undefined): number | null => {
        const parsed = value === null || value === undefined ? Number.NaN : Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const styleVar = (element: Element, name: string): string | null => {
        const value = element instanceof HTMLElement
          ? element.style.getPropertyValue(name)
          : '';
        return value.trim() || null;
      };
      const player = document.querySelector('.bpx-player-video-area');
      const overlay = document.querySelector('.bpx-player-row-dm-wrap');
      const listRoot = document.querySelector('.bpx-player-filter-wrap.bpx-player-dm');
      const listWrap = listRoot?.querySelector<HTMLElement>('.bui-long-list-wrap') ?? null;
      const list = listRoot?.querySelector<HTMLUListElement>('ul.bui-long-list-list') ?? null;
      const rows = listRoot
        ? [...listRoot.querySelectorAll<HTMLElement>('li.bui-long-list-item')]
          .map((row) => {
            const index = Number.parseInt(row.getAttribute('data-index') ?? '', 10);
            const time = clean(row.querySelector('.dm-info-time')?.textContent, 40);
            const content = clean(row.querySelector('.dm-info-dm')?.textContent);
            const sentAt = clean(row.querySelector('.dm-info-date')?.textContent, 80);
            return Number.isSafeInteger(index) && index >= 0 && time && content && sentAt
              ? { index, time, content, sentAt }
              : null;
          })
          .filter((row): row is { index: number; time: string; content: string; sentAt: string } => row !== null)
          .slice(0, 64)
        : [];
      const rowHeight = rows.length > 0
        ? listRoot?.querySelector<HTMLElement>('li.bui-long-list-item')?.getBoundingClientRect().height ?? 0
        : 0;
      const listHeight = list?.getBoundingClientRect().height ?? 0;
      const inlineTransform = list?.getAttribute('style') ?? '';
      const transformMatch = inlineTransform.match(/transform:\s*translate\([^,]+,\s*(-?[\d.]+)px/i);
      const transformY = transformMatch ? finite(transformMatch[1]) : null;
      // Risk words are scoped to the player, not the whole page. Bilibili's
      // recommendation/advertisement DOM can contain unrelated "服务不可用"
      // text and must not stop a public player read.
      const bodyText = clean(document.querySelector('.bpx-player-container')?.innerText, 40_000);
      const bvid = location.protocol === 'https:' && location.hostname === 'www.bilibili.com'
        ? location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
        : null;
      const danmakuEnabled = document.querySelector<HTMLElement>('[aria-label="弹幕显示隐藏"] input[type="checkbox"]');
      const overlayItems = [...(overlay?.querySelectorAll<HTMLElement>('.bili-danmaku-x-dm') ?? [])]
        .map((element) => ({
          text: clean(element.textContent),
          top: finite(styleVar(element, '--top')),
          color: styleVar(element, '--color'),
          fontSize: finite(styleVar(element, '--fontSize'))
        }))
        .filter((item) => item.text.length > 0)
        .slice(0, 32);
      return {
        schemaVersion: 1 as const,
        bvid,
        playerVisible: rendered(player),
        danmakuOverlayVisible: rendered(overlay),
        danmakuEnabled: danmakuEnabled ? danmakuEnabled.checked : null,
        overlayItems,
        listControlVisible: rendered(document.querySelector('.bui-dropdown-display')),
        listOpen: rendered(listRoot),
        listRows: rows,
        listTotalEstimate: rowHeight > 0 && listHeight > 0 ? Math.round(listHeight / rowHeight) : null,
        listOffset: transformY === null ? null : Math.max(0, Math.abs(transformY)),
        listContainerVisible: rendered(listWrap),
        loginGateVisible: /请先\s*登录|登录后查看/.test(bodyText),
        risk: {
          verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
          rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
          sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
        }
      };
    }
  });
  const result = results[0]?.result;
  if (!result) throw new Error('bilibili_danmaku_dom_capture_unavailable');
  return result;
}
