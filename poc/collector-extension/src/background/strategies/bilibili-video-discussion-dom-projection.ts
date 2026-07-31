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
  firstThreadReplies?: Array<{
    author: string | null;
    content: string;
    publishedAt: string | null;
    likeCount: number | null;
  }>;
  replyPaginationVisible?: boolean;
  replyPage?: number | null;
  replyPageCount?: number | null;
  replyHasMore?: boolean | null;
  replyCoverage?: 'not_expanded' | 'current_page' | 'empty' | 'unknown';
  loginGateVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

const BILIBILI_DISCUSSION_SCRIPT_TIMEOUT_MS = 5_000;
const BILIBILI_DISCUSSION_DEBUGGER_ATTACH_TIMEOUT_MS = 2_500;
const BILIBILI_DISCUSSION_DEBUGGER_INPUT_TIMEOUT_MS = 2_500;
const BILIBILI_DISCUSSION_DEBUGGER_DETACH_TIMEOUT_MS = 1_500;

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
    results = await withTimeout(
      chrome.scripting.executeScript({
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
          // The visible label of Bilibili's bili-text-button is assigned to a
          // slot from the host light DOM. Walking only shadowRoot.childNodes
          // otherwise erases the "最热" / "最新" label used for discovery.
          if (node instanceof HTMLSlotElement) {
            const assigned = node.assignedNodes({ flatten: true });
            if (assigned.length > 0) return assigned.map(composedText).join(' ');
          }
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
        const sortModeOf = (element: Element | null): 'hot' | 'latest' | 'unknown' => {
          let current: Node | null = element;
          while (current) {
            if (current instanceof Element && current.id === 'sort-actions') {
              if (current.classList.contains('hot')) return 'hot';
              if (current.classList.contains('time') || current.classList.contains('latest')) return 'latest';
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
        const sortMode = sortModeOf(latest ?? hot);
        const resolvedLatestState = sortMode === 'hot'
          ? 'inactive' as const
          : sortMode === 'latest'
            ? 'active' as const
            : latestState === 'unknown' && hotState === 'active'
              ? 'inactive' as const
              : latestState;
        const roots = elements
          .filter((element) => element.tagName.toLowerCase() === 'bili-comment-thread-renderer' && rendered(element))
          .slice(0, 20)
          .map((element) => clean(composedText(element), 2_000))
          .filter((value) => value.length > 0);
        const firstThread = elements.find((element) =>
          element.tagName.toLowerCase() === 'bili-comment-thread-renderer' && rendered(element)) ?? null;
        const replyRenderer = firstThread
          ? composedElements(firstThread).find((element) =>
            element.tagName.toLowerCase() === 'bili-comment-replies-renderer' && rendered(element)) ?? null
          : null;
        const replyText = clean(replyRenderer ? composedText(replyRenderer) : '', 20_000);
        const replyExpandVisible = Boolean(replyRenderer &&
          visibleSemanticButton(composedElements(replyRenderer), '点击查看'));
        const replyRenderers = replyRenderer
          ? composedElements(replyRenderer)
            .filter((element) => element.tagName.toLowerCase() === 'bili-comment-reply-renderer' && rendered(element))
            .slice(0, 20)
          : [];
        const parseLikeCount = (value: string): number | null => {
          const candidate = clean(value, 40);
          if (!candidate) return null;
          if (/^\d+$/.test(candidate)) {
            const parsed = Number(candidate);
            return Number.isSafeInteger(parsed) ? parsed : null;
          }
          const abbreviated = candidate.match(/^([\d.]+)\s*([万千])$/);
          if (!abbreviated) return null;
          const amount = Number(abbreviated[1]);
          if (!Number.isFinite(amount)) return null;
          const parsed = Math.round(amount * (abbreviated[2] === '万' ? 10_000 : 1_000));
          return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
        };
        const elementWithId = (root: Element, id: string): Element | null =>
          [root, ...composedElements(root)].find((element) => element.id === id) ?? null;
        const projectedReplies = replyRenderers.flatMap((renderer) => {
          const userName = elementWithId(renderer, 'user-name');
          const contents = elementWithId(renderer, 'contents');
          if (!contents) return [];
          const content = clean(composedText(contents), 4_000);
          if (!content) return [];
          const pubdate = elementWithId(renderer, 'pubdate');
          const count = elementWithId(renderer, 'count');
          return [{
            author: userName ? (clean(composedText(userName), 200) || null) : null,
            content,
            publishedAt: pubdate ? (clean(composedText(pubdate), 100) || null) : null,
            likeCount: count ? parseLikeCount(composedText(count)) : null
          }];
        });
        const activePageButton = replyRenderer
          ? composedElements(replyRenderer)
            .filter((element) => (element.tagName.toLowerCase() === 'bili-text-button' ||
              element.tagName.toLowerCase() === 'button' || element.getAttribute('role') === 'button') &&
              renderedControl(element) &&
              /^\d+$/.test(clean(composedText(element), 20)))
            .find((element) => stateOf(element) === 'active') ?? null
          : null;
        const pageMatch = replyText.match(/第\s*(\d+)\s*页/);
        const pageCountMatch = replyText.match(/共\s*(\d+)\s*页/);
        const slashMatch = replyText.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/);
        const replyPage = pageMatch ? Number(pageMatch[1])
          : slashMatch ? Number(slashMatch[1])
            : activePageButton ? Number(clean(composedText(activePageButton), 20))
              : null;
        const replyPageCount = pageCountMatch ? Number(pageCountMatch[1]) : slashMatch ? Number(slashMatch[2]) : null;
        const nextButton = replyRenderer
          ? composedElements(replyRenderer).find((element) =>
            (element.tagName.toLowerCase() === 'bili-text-button' || element.tagName.toLowerCase() === 'button' ||
              element.getAttribute('role') === 'button') && renderedControl(element) &&
            /下一页/.test(clean(composedText(element), 20))) ?? null
          : null;
        const collapseButton = replyRenderer
          ? composedElements(replyRenderer).find((element) =>
            (element.tagName.toLowerCase() === 'bili-text-button' || element.tagName.toLowerCase() === 'button' ||
              element.getAttribute('role') === 'button') && renderedControl(element) &&
            /收起/.test(clean(composedText(element), 20))) ?? null
          : null;
        const nextDisabled = Boolean(nextButton && (nextButton.getAttribute('aria-disabled') === 'true' ||
          nextButton.hasAttribute('disabled') || nextButton.classList.contains('disabled') ||
          nextButton.classList.contains('is-disabled')));
        const visiblePaginationText = Boolean(replyRenderer && composedElements(replyRenderer).some((element) =>
          renderedControl(element) && /第\s*\d+\s*页|共\s*\d+\s*页|上一页/.test(clean(composedText(element), 100))));
        const replyPaginationVisible = Boolean(replyRenderer &&
          (nextButton || collapseButton || activePageButton || visiblePaginationText));
        const firstThreadExpanded = Boolean(replyRenderer && !replyExpandVisible &&
          (replyPaginationVisible || replyRenderers.length > 0));
        const firstThreadReplies = firstThreadExpanded ? projectedReplies : [];
        const replyCoverage = firstThreadExpanded
          ? firstThreadReplies.length > 0 ? 'current_page' as const : replyPaginationVisible ? 'empty' as const : 'unknown' as const
          : 'not_expanded' as const;
        const replyHasMore = firstThreadExpanded
          ? replyPage !== null && replyPageCount !== null
            ? replyPage < replyPageCount
            : nextButton ? !nextDisabled : null
          : null;
        const commentText = clean(composedText(commentRoot ?? host ?? document.body), 20_000);
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
            firstThreadReplies,
            replyPaginationVisible,
            replyPage,
            replyPageCount,
            replyHasMore,
            replyCoverage,
            loginGateVisible: /登录后查看|登录参与社区互动/.test(commentText),
            risk: {
              verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(commentText),
              rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(commentText),
              sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(commentText)
            }
          };
        }
      }),
      BILIBILI_DISCUSSION_SCRIPT_TIMEOUT_MS,
      'video_discussion_strategy_document_context_changed'
    );
  } catch {
    throw new Error('video_discussion_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('video_discussion_strategy_document_context_changed');
  return result;
}

interface BilibiliVideoDiscussionScrollProbe {
  found: boolean;
  inViewport: boolean;
  x: number;
  y: number;
  deltaY: number;
}

/**
 * One bounded, DOM-derived trusted scroll used by the managed discussion
 * work tab. The fixed projection first measures #commentapp and derives a
 * viewport-safe pointer and wheel delta. The actual scroll is delivered by
 * Chrome's Input domain so Bilibili sees the same kind of wheel input as a
 * foreground user page; no synthetic element method, selector, or caller
 * supplied coordinate is accepted.
 */
export async function scrollBilibiliVideoDiscussionIntoView(
  tabId: number,
  documentId: string
): Promise<{ found: boolean; inViewport: boolean }> {
  let results: chrome.scripting.InjectionResult<BilibiliVideoDiscussionScrollProbe>[];
  try {
    results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        world: 'ISOLATED',
        func: () => {
        const host = document.querySelector<HTMLElement>('#commentapp');
        if (!host) return { found: false, inViewport: false, x: 0, y: 0, deltaY: 0 };
        const rect = host.getBoundingClientRect();
        const viewportWidth = Math.max(1, window.innerWidth);
        const viewportHeight = Math.max(1, window.innerHeight);
        const inViewport = rect.bottom > 0 && rect.top < viewportHeight;
        // Keep the pointer in the lower portion of the foreground viewport,
        // where a person would naturally place it before moving toward the
        // comments. A positive wheel is the expected direction because the
        // public discussion host follows the video; retain a bounded upward
        // fallback if the page is already above the viewport in an unusual
        // retained-tab state.
        const direction = rect.bottom <= 0 ? -1 : 1;
        const x = Math.min(viewportWidth - 1, Math.max(0, Math.round(viewportWidth / 2)));
        const y = Math.min(viewportHeight - 1, Math.max(1, Math.round(viewportHeight * 0.8)));
        const deltaY = direction * Math.min(1_050, Math.max(480, Math.round(viewportHeight * 0.9)));
          return { found: true, inViewport, x, y, deltaY };
        }
      }),
      BILIBILI_DISCUSSION_SCRIPT_TIMEOUT_MS,
      'bilibili_video_discussion_scroll_document_context_changed'
    );
  } catch {
    throw new Error('bilibili_video_discussion_scroll_document_context_changed');
  }
  const probe = results[0]?.result;
  if (!probe) throw new Error('bilibili_video_discussion_scroll_document_context_changed');
  if (!probe.found || probe.inViewport) return { found: probe.found, inViewport: probe.inViewport };

  const debuggee: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  let attachPending = false;
  let primaryError: Error | null = null;
  let detachError: Error | null = null;
  try {
    attachPending = true;
    await withTimeout(
      chrome.debugger.attach(debuggee, '1.3'),
      BILIBILI_DISCUSSION_DEBUGGER_ATTACH_TIMEOUT_MS,
      'bilibili_video_discussion_scroll_debugger_attach_timeout'
    );
    attachPending = false;
    attached = true;
    await sendTrustedMouseCommand(debuggee, {
      type: 'mouseMoved',
      x: probe.x,
      y: probe.y
    });
    await sendTrustedMouseCommand(debuggee, {
      type: 'mouseWheel',
      x: probe.x,
      y: probe.y,
      deltaX: 0,
      deltaY: probe.deltaY
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    primaryError = new Error(code.startsWith('bilibili_video_discussion_scroll_debugger_')
      ? code
      : 'bilibili_video_discussion_scroll_debugger_attach_failed');
    if (code !== 'bilibili_video_discussion_scroll_debugger_attach_timeout') attachPending = false;
  } finally {
    if (attached || attachPending) {
      try {
        await withTimeout(
          chrome.debugger.detach(debuggee),
          BILIBILI_DISCUSSION_DEBUGGER_DETACH_TIMEOUT_MS,
          'bilibili_video_discussion_scroll_debugger_detach_timeout'
        );
      } catch {
        detachError = new Error('bilibili_video_discussion_scroll_debugger_detach_failed');
      }
    }
  }
  if (detachError) throw detachError;
  if (primaryError) throw primaryError;
  return { found: true, inViewport: false };
}

async function sendTrustedMouseCommand(
  debuggee: chrome.debugger.Debuggee,
  command: Record<string, unknown>
): Promise<void> {
  try {
    await withTimeout(
      chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', command),
      BILIBILI_DISCUSSION_DEBUGGER_INPUT_TIMEOUT_MS,
      'bilibili_video_discussion_scroll_debugger_input_timeout'
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    throw new Error(code === 'bilibili_video_discussion_scroll_debugger_input_timeout'
      ? code
      : 'bilibili_video_discussion_scroll_debugger_input_failed');
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
