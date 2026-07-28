const stateKey = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
const maximumBodyBytes = 2 * 1024 * 1024;
const maximumPayloads = 8;
const maximumItems = 40;
const maximumComments = 80;

interface PublicItem {
  noteId: string;
  title: string;
  contentType: string;
  authorId: string;
  authorNickname: string;
  likedCountText: string;
}

interface PublicDetail {
  publicText: string;
  authorNickname: string;
  interactionText: string;
}

interface PublicComment {
  commentId: string;
  publicText: string;
  authorNickname: string;
  likedCountText: string;
  subCommentCountText: string;
  createdAtText: string;
  locationText: string;
}

interface ArchivedPublicComment extends PublicComment { parentNoteId: string; parentCommentId: string }

interface ObserverController {
  schemaVersion: 2;
  generation: number;
  expiresAt: number;
  matchedPayloadCount: number;
  bodyBytesRead: number;
  items: PublicItem[];
  details: PublicDetail[];
  comments: PublicComment[];
  commentPagination: { hasMore: boolean | null; cursorObserved: boolean };
  selectedNoteId: string;
  commentArchiveExpiresAt: number;
  commentArchiveMatchedPayloadCount: number;
  commentArchiveBodyBytesRead: number;
  commentArchive: ArchivedPublicComment[];
  commentArchivePagination: { hasMore: boolean | null; cursorObserved: boolean };
}

const root = window as typeof window & { [stateKey]?: ObserverController };
const existing = root[stateKey];
const controller: ObserverController = existing ?? {
  schemaVersion: 2,
  generation: 0,
  expiresAt: 0,
  matchedPayloadCount: 0,
  bodyBytesRead: 0,
  items: [],
  details: [],
  comments: [],
  commentPagination: { hasMore: null, cursorObserved: false },
  selectedNoteId: '',
  commentArchiveExpiresAt: 0,
  commentArchiveMatchedPayloadCount: 0,
  commentArchiveBodyBytesRead: 0,
  commentArchive: [],
  commentArchivePagination: { hasMore: null, cursorObserved: false }
};

controller.selectedNoteId ??= '';
controller.commentArchiveExpiresAt ??= 0;
controller.commentArchiveMatchedPayloadCount ??= 0;
controller.commentArchiveBodyBytesRead ??= 0;
controller.commentArchive ??= [];
controller.commentArchivePagination ??= { hasMore: null, cursorObserved: false };

if (!existing) {
  Object.defineProperty(root, stateKey, { value: controller, configurable: true });

  const clean = (value: unknown, maximum: number): string =>
    (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      .replace(/\s+/g, ' ').trim().slice(0, maximum);
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

  const project = (value: unknown): {
    items: PublicItem[];
    details: PublicDetail[];
    comments: ArchivedPublicComment[];
    hasMore: boolean | null;
    cursorObserved: boolean;
  } => {
    const items: PublicItem[] = [];
    const details: PublicDetail[] = [];
    const comments: ArchivedPublicComment[] = [];
    let hasMore: boolean | null = null;
    let cursorObserved = false;
    const visit = (node: unknown, depth: number, inheritedParentCommentId = ''): void => {
      if (depth > 7 || (items.length >= maximumItems && comments.length >= maximumComments)) return;
      if (Array.isArray(node)) {
        for (const entry of node.slice(0, 80)) visit(entry, depth + 1, inheritedParentCommentId);
        return;
      }
      const record = object(node);
      if (!record) return;
      const commentId = clean(record.comment_id ?? record.commentId ?? record.id, 100);
      const commentText = clean(record.content ?? record.content_text ?? record.text, 2_000);
      const commentShape = Object.hasOwn(record, 'comment_id') || Object.hasOwn(record, 'commentId') ||
        Object.hasOwn(record, 'sub_comment_count') || Object.hasOwn(record, 'subCommentCount') ||
        (Object.hasOwn(record, 'user_info') &&
          (Object.hasOwn(record, 'create_time') || Object.hasOwn(record, 'ip_location')));
      if (commentShape && commentId && commentText && comments.length < maximumComments) {
        const user = object(record.user_info ?? record.userInfo ?? record.user) ?? {};
        comments.push({
          commentId,
          publicText: commentText,
          authorNickname: clean(user.nickname ?? user.nick_name ?? user.name, 200),
          likedCountText: clean(record.like_count ?? record.liked_count ?? record.likeCount, 40),
          subCommentCountText: clean(record.sub_comment_count ?? record.subCommentCount, 40),
          createdAtText: clean(record.create_time ?? record.created_at ?? record.createTime, 100),
          locationText: clean(record.ip_location ?? record.ipLocation, 100),
          parentNoteId: clean(record.note_id ?? record.noteId ?? record.target_note_id ?? record.targetNoteId, 80),
          parentCommentId: clean(record.parent_comment_id ?? record.parentCommentId ?? record.root_comment_id ??
            record.rootCommentId ?? record.target_comment_id ?? record.targetCommentId ?? inheritedParentCommentId, 100)
        });
      }
      const recordHasMore = record.has_more ?? record.hasMore;
      if (typeof recordHasMore === 'boolean') hasMore = recordHasMore;
      if (clean(record.cursor ?? record.next_cursor ?? record.nextCursor, 200)) cursorObserved = true;
      const card = object(record.note_card ?? record.noteCard);
      if (card) {
        const user = object(card.user) ?? {};
        const interact = object(card.interact_info ?? card.interactInfo) ?? {};
        const noteId = clean(card.note_id ?? card.noteId ?? record.id, 80);
        const title = clean(card.display_title ?? card.title, 500);
        if (noteId && title) {
          items.push({
            noteId,
            title,
            contentType: clean(card.type ?? record.model_type, 40),
            authorId: clean(user.user_id ?? user.userId, 80),
            authorNickname: clean(user.nickname ?? user.nick_name, 200),
            likedCountText: clean(interact.liked_count ?? interact.likedCount, 40)
          });
        }
        const description = clean(card.desc ?? card.description, 11_000);
        if (description && details.length === 0) {
          const publicTitle = clean(card.title ?? card.display_title, 500);
          details.push({
            publicText: clean(`${publicTitle}\n${description}`, 12_000),
            authorNickname: clean(user.nickname ?? user.nick_name, 200),
            interactionText: clean(Object.values(interact).filter((entry) =>
              typeof entry === 'string' || typeof entry === 'number').join(' '), 1_000)
          });
        }
      }
      for (const [key, child] of Object.entries(record).slice(0, 80)) {
        if (/token|cookie|session|captcha|verify|phone|email|xsec|secret|password/i.test(key)) continue;
        const nestedReplyCollection = /^(?:sub_?comments?|subComments?|repl(?:y|ies)|reply_?list)$/i.test(key);
        visit(child, depth + 1, nestedReplyCollection && commentId ? commentId : inheritedParentCommentId);
      }
    };
    visit(value, 0);
    return { items, details, comments, hasMore, cursorObserved };
  };

  const observeText = (text: string, generation: number): void => {
    const active = root[stateKey];
    if (!active || active.generation !== generation || Date.now() >= active.expiresAt ||
      active.matchedPayloadCount >= maximumPayloads) return;
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maximumBodyBytes) return;
    try {
      const projected = project(JSON.parse(text));
      if (projected.items.length === 0 && projected.details.length === 0 && projected.comments.length === 0) return;
      active.matchedPayloadCount += 1;
      active.bodyBytesRead += bytes;
      const known = new Set(active.items.map((item) => item.noteId));
      for (const item of projected.items) {
        if (active.items.length >= maximumItems) break;
        if (!known.has(item.noteId)) {
          known.add(item.noteId);
          active.items.push(item);
        }
      }
      if (active.details.length === 0 && projected.details.length > 0) {
        active.details.push(projected.details[0]!);
      }
      const knownComments = new Set(active.comments.map((comment) => comment.commentId));
      for (const comment of projected.comments) {
        if (active.comments.length >= maximumComments) break;
        if (!knownComments.has(comment.commentId)) {
          knownComments.add(comment.commentId);
          active.comments.push(comment);
        }
      }
      if (projected.hasMore !== null) active.commentPagination.hasMore = projected.hasMore;
      active.commentPagination.cursorObserved ||= projected.cursorObserved;
      const archiveKnown = new Set(active.commentArchive.map((comment) => `${comment.parentNoteId}:${comment.commentId}`));
      let archivedFromPayload = false;
      for (const comment of projected.comments) {
        const parentNoteId = comment.parentNoteId || active.selectedNoteId;
        if (!parentNoteId || active.commentArchive.length >= maximumComments) continue;
        const key = `${parentNoteId}:${comment.commentId}`;
        if (!archiveKnown.has(key)) {
          archiveKnown.add(key);
          active.commentArchive.push({ ...comment, parentNoteId });
          archivedFromPayload = true;
        }
      }
      if (archivedFromPayload) {
        active.commentArchiveExpiresAt = Date.now() + 3 * 60_000;
        active.commentArchiveMatchedPayloadCount = Math.min(maximumPayloads,
          active.commentArchiveMatchedPayloadCount + 1);
        active.commentArchiveBodyBytesRead = Math.min(16 * 1024 * 1024,
          active.commentArchiveBodyBytesRead + bytes);
        if (projected.hasMore !== null) active.commentArchivePagination.hasMore = projected.hasMore;
        active.commentArchivePagination.cursorObserved ||= projected.cursorObserved;
      }
    } catch {
      // Non-JSON or unreadable bodies are not retained.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function observedFetch(this: typeof window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const generation = root[stateKey]?.generation ?? -1;
    const responsePromise = arguments.length === 1
      ? originalFetch.call(this, input)
      : originalFetch.call(this, input, init);
    void responsePromise.then(async (response) => {
      const active = root[stateKey];
      if (!active || active.generation !== generation || Date.now() >= active.expiresAt || !response.ok ||
        !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return;
      const clone = response.clone();
      const declared = Number(clone.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maximumBodyBytes) return;
      observeText(await clone.text(), generation);
    }).catch(() => undefined);
    return responsePromise;
  } as typeof window.fetch;

  const originalOpen = XMLHttpRequest.prototype.open as (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) => void;
  const originalSend = XMLHttpRequest.prototype.send;
  const generations = new WeakMap<XMLHttpRequest, number>();
  XMLHttpRequest.prototype.open = function observedOpen(method: string, url: string | URL, async?: boolean,
    username?: string | null, password?: string | null): void {
    generations.set(this, root[stateKey]?.generation ?? -1);
    if (arguments.length <= 2) return originalOpen.call(this, method, url);
    if (arguments.length === 3) return originalOpen.call(this, method, url, async as boolean);
    if (arguments.length === 4) return originalOpen.call(this, method, url, async as boolean, username);
    return originalOpen.call(this, method, url, async as boolean, username, password);
  };
  XMLHttpRequest.prototype.send = function observedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const generation = generations.get(this) ?? -1;
    this.addEventListener('loadend', () => {
      const active = root[stateKey];
      if (!active || active.generation !== generation || Date.now() >= active.expiresAt ||
        this.status < 200 || this.status >= 300 ||
        !(this.getResponseHeader('content-type') ?? '').toLowerCase().includes('json')) return;
      try {
        const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
        if (typeof text === 'string') observeText(text, generation);
      } catch {
        // Unreadable bodies are not retained.
      }
    }, { once: true });
    if (arguments.length === 0) return originalSend.call(this);
    return originalSend.call(this, body);
  };
}

// Every injection starts a fresh work-scoped observation window. Wrappers are
// installed once per document and dynamically bind responses to this generation,
// so a late response from an earlier work item cannot leak into the next one.
controller.generation += 1;
controller.expiresAt = Date.now() + 60_000;
controller.matchedPayloadCount = 0;
controller.bodyBytesRead = 0;
controller.items = [];
controller.details = [];
controller.comments = [];
controller.commentPagination = { hasMore: null, cursorObserved: false };
if (Date.now() >= controller.commentArchiveExpiresAt) {
  controller.selectedNoteId = '';
  controller.commentArchiveMatchedPayloadCount = 0;
  controller.commentArchiveBodyBytesRead = 0;
  controller.commentArchive = [];
  controller.commentArchivePagination = { hasMore: null, cursorObserved: false };
}
