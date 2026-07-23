export interface BilibiliVideoDiscussionDomSnapshot {
  bvid: string | null;
  commentHostPresent: boolean;
  commentHostVisible: boolean;
  commentHostInViewport: boolean;
  commentHostBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  sortControls: {
    hotVisible: boolean;
    latestVisible: boolean;
    latestState: 'active' | 'inactive' | 'unknown';
  };
  commentContentState: 'loading' | 'ready' | 'empty' | 'unknown';
  rootCommentTexts: string[];
  firstThreadExpandVisible: boolean;
  loginGateVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Fixed Bilibili discussion DOM projection. Bilibili's current desktop
 * comments component is an open Shadow DOM tree; this function explicitly
 * walks only the composed subtree below #commentapp and never falls back to
 * a page-wide text match or caller-provided selector/script.
 */
export async function captureBilibiliVideoDiscussionDom(
  tabId: number,
  documentId: string
): Promise<BilibiliVideoDiscussionDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliVideoDiscussionDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      world: 'ISOLATED',
      func: () => {
        const clean = (value: string | null | undefined, maximum: number): string =>
          (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
        const rendered = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
        };
        const composedText = (node: Node): string => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
          if (!(node instanceof Element || node instanceof DocumentFragment)) return '';
          if (node instanceof Element && ['STYLE', 'SCRIPT', 'TEMPLATE'].includes(node.tagName)) return '';
          const shadow = node instanceof Element ? node.shadowRoot : null;
          const source = shadow ?? node;
          return Array.from(source.childNodes).map(composedText).join(' ');
        };
        const composedElements = (root: Element): Element[] => {
          const result: Element[] = [];
          const visit = (container: Element | ShadowRoot): void => {
            for (const element of Array.from(container.querySelectorAll('*'))) {
              result.push(element);
              if (element.shadowRoot) visit(element.shadowRoot);
            }
          };
          visit(root);
          if (root.shadowRoot) visit(root.shadowRoot);
          return result;
        };
        const renderedControl = (element: Element): boolean =>
          rendered(element) || Boolean(element.shadowRoot &&
            Array.from(element.shadowRoot.querySelectorAll('*')).some((candidate) => rendered(candidate)));
        const visibleSemanticButton = (elements: readonly Element[], label: string): Element | null =>
          elements.find((element) => {
            const tagName = element.tagName.toLowerCase();
            const interactive = tagName === 'bili-text-button' || tagName === 'button' ||
              element.getAttribute('role') === 'button';
            return interactive && renderedControl(element) && clean(composedText(element), 100) === label;
          }) ?? null;
        const stateOf = (element: Element | null): 'active' | 'inactive' | 'unknown' => {
          if (!element) return 'unknown';
          const inspect = (candidate: Element): 'active' | 'inactive' | 'unknown' => {
            const pressed = candidate.getAttribute('aria-pressed') ?? candidate.getAttribute('aria-selected');
            if (pressed === 'true') return 'active';
            if (pressed === 'false') return 'inactive';
            if (candidate.classList.contains('active') || candidate.classList.contains('selected') ||
              candidate.classList.contains('is-active') || candidate.classList.contains('is-selected')) return 'active';
            return 'unknown';
          };
          const candidates = [element, ...Array.from(element.querySelectorAll('*'))];
          for (const candidate of candidates) {
            const state = inspect(candidate);
            if (state !== 'unknown') return state;
          }
          let current: Node | null = element;
          while (current) {
            if (current instanceof Element) {
              const state = inspect(current);
              if (state !== 'unknown') return state;
            }
            if (current.parentNode) {
              current = current.parentNode;
              continue;
            }
            const root = current.getRootNode();
            current = root instanceof ShadowRoot ? root.host : null;
          }
          return 'unknown';
        };
        const host = document.querySelector<HTMLElement>('#commentapp');
        const commentRoot = host?.querySelector<HTMLElement>('bili-comments') ?? null;
        const elements = commentRoot ? composedElements(commentRoot) : [];
        const latest = visibleSemanticButton(elements, '最新');
        const hot = visibleSemanticButton(elements, '最热');
        const latestState = stateOf(latest);
        const hotState = stateOf(hot);
        const resolvedLatestState = latestState === 'unknown' && hotState === 'active'
          ? 'inactive' as const
          : latestState;
        const roots = elements
          .filter((element) => element.tagName.toLowerCase() === 'bili-comment-thread-renderer' && rendered(element))
          .slice(0, 20)
          .map((element) => clean(composedText(element), 2_000))
          .filter((value) => value.length > 0);
        const commentText = clean(composedText(commentRoot ?? host), 20_000);
        const commentContentState = /正在玩命加载|正在加载|加载中|loading/i.test(commentText)
          ? 'loading' as const
          : roots.length > 0
            ? 'ready' as const
            : /暂无评论|还没有评论|成为第一个评论者|快来发表你的评论/.test(commentText)
              ? 'empty' as const
              : 'unknown' as const;
        const firstThreadExpandVisible = elements
          .filter((element) => element.tagName.toLowerCase() === 'bili-comment-replies-renderer')
          .some((renderer) => visibleSemanticButton(composedElements(renderer), '点击查看') !== null);
        const rect = host?.getBoundingClientRect();
        const commentHostInViewport = Boolean(rect && rect.bottom > 0 && rect.top < window.innerHeight);
        const bvid = location.protocol === 'https:' && location.hostname === 'www.bilibili.com'
          ? location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
          : null;
        return {
          bvid,
          commentHostPresent: Boolean(host && commentRoot),
          commentHostVisible: Boolean(commentRoot && rendered(commentRoot)),
          commentHostInViewport,
          commentHostBounds: rect && rect.width > 0 && rect.height > 0
            ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            : null,
          sortControls: {
            hotVisible: hot !== null,
            latestVisible: latest !== null,
            latestState: resolvedLatestState
          },
          commentContentState,
          rootCommentTexts: roots,
          firstThreadExpandVisible,
          loginGateVisible: /登录后查看|登录参与社区互动/.test(commentText),
          risk: {
            verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(commentText),
            rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(commentText),
            sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(commentText)
          }
        };
      }
    });
  } catch {
    throw new Error('video_discussion_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('video_discussion_strategy_document_context_changed');
  return result;
}
