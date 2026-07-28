const stateKey = '__personalIntelligenceXiaohongshuSearchObserverV1';
const maximumBodyBytes = 2 * 1024 * 1024;
const maximumPayloads = 8;
const maximumItems = 40;

interface PublicItem {
  noteId: string;
  title: string;
  contentType: string;
  authorId: string;
  authorNickname: string;
  likedCountText: string;
}

interface ObserverState {
  schemaVersion: 1;
  expiresAt: number;
  matchedPayloadCount: number;
  bodyBytesRead: number;
  items: PublicItem[];
}

const root = window as typeof window & { [stateKey]?: ObserverState };
if (!root[stateKey]) {
  const state: ObserverState = {
    schemaVersion: 1,
    expiresAt: Date.now() + 60_000,
    matchedPayloadCount: 0,
    bodyBytesRead: 0,
    items: []
  };
  Object.defineProperty(root, stateKey, { value: state, configurable: true });

  const clean = (value: unknown, maximum: number): string =>
    (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      .replace(/\s+/g, ' ').trim().slice(0, maximum);
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

  const project = (value: unknown): PublicItem[] => {
    const found: PublicItem[] = [];
    const visit = (node: unknown, depth: number): void => {
      if (depth > 7 || found.length >= maximumItems) return;
      if (Array.isArray(node)) {
        for (const entry of node.slice(0, 80)) visit(entry, depth + 1);
        return;
      }
      const record = object(node);
      if (!record) return;
      const card = object(record.note_card ?? record.noteCard);
      if (card) {
        const user = object(card.user) ?? {};
        const interact = object(card.interact_info ?? card.interactInfo) ?? {};
        const noteId = clean(card.note_id ?? card.noteId ?? record.id, 80);
        const title = clean(card.display_title ?? card.title, 500);
        if (noteId && title) {
          found.push({
            noteId,
            title,
            contentType: clean(card.type ?? record.model_type, 40),
            authorId: clean(user.user_id ?? user.userId, 80),
            authorNickname: clean(user.nickname ?? user.nick_name, 200),
            likedCountText: clean(interact.liked_count ?? interact.likedCount, 40)
          });
        }
      }
      for (const [key, child] of Object.entries(record).slice(0, 80)) {
        if (/token|cookie|session|captcha|verify|phone|email|xsec|secret|password/i.test(key)) continue;
        visit(child, depth + 1);
      }
    };
    visit(value, 0);
    return found;
  };

  const observeText = (text: string): void => {
    if (Date.now() >= state.expiresAt || state.matchedPayloadCount >= maximumPayloads) return;
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maximumBodyBytes) return;
    try {
      const items = project(JSON.parse(text));
      if (items.length === 0) return;
      state.matchedPayloadCount += 1;
      state.bodyBytesRead += bytes;
      const known = new Set(state.items.map((item) => item.noteId));
      for (const item of items) {
        if (state.items.length >= maximumItems) break;
        if (!known.has(item.noteId)) {
          known.add(item.noteId);
          state.items.push(item);
        }
      }
    } catch {
      // Non-JSON or unreadable bodies are not retained.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function observedFetch(this: typeof window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const responsePromise = arguments.length === 1
      ? originalFetch.call(this, input)
      : originalFetch.call(this, input, init);
    void responsePromise.then(async (response) => {
      if (Date.now() >= state.expiresAt || !response.ok ||
        !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return;
      const clone = response.clone();
      const declared = Number(clone.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maximumBodyBytes) return;
      const text = await clone.text();
      observeText(text);
    }).catch(() => undefined);
    return responsePromise;
  } as typeof window.fetch;

  const metadata = new WeakMap<XMLHttpRequest, true>();
  const originalOpen = XMLHttpRequest.prototype.open as (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) => void;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function observedOpen(method: string, url: string | URL, async?: boolean,
    username?: string | null, password?: string | null): void {
    metadata.set(this, true);
    if (arguments.length <= 2) return originalOpen.call(this, method, url);
    if (arguments.length === 3) return originalOpen.call(this, method, url, async as boolean);
    if (arguments.length === 4) return originalOpen.call(this, method, url, async as boolean, username);
    return originalOpen.call(this, method, url, async as boolean, username, password);
  };
  XMLHttpRequest.prototype.send = function observedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.addEventListener('loadend', () => {
      if (!metadata.has(this) || Date.now() >= state.expiresAt || this.status < 200 || this.status >= 300 ||
        !(this.getResponseHeader('content-type') ?? '').toLowerCase().includes('json')) return;
      try {
        const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
        if (typeof text === 'string') observeText(text);
      } catch {
        // Unreadable bodies are not retained.
      }
    }, { once: true });
    if (arguments.length === 0) return originalSend.call(this);
    return originalSend.call(this, body);
  };
}
