import {
  createXiaohongshuSearchPayloadProjector,
  type XhsArchivedPublicComment,
  type XhsPublicNoteDetail,
  type XhsPublicSearchItem
} from './xiaohongshu-search-payload-projector';

const stateKey = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
const maximumBodyBytes = 2 * 1024 * 1024;
const maximumPayloads = 8;
const maximumItems = 200;
const maximumComments = 80;

type PublicItem = XhsPublicSearchItem;
type PublicDetail = XhsPublicNoteDetail;
type ArchivedPublicComment = XhsArchivedPublicComment;

interface ObserverController {
  schemaVersion: 2;
  generation: number;
  expiresAt: number;
  matchedPayloadCount: number;
  bodyBytesRead: number;
  items: PublicItem[];
  details: PublicDetail[];
  comments: ArchivedPublicComment[];
  noteMedia: Record<string, { imageUrls: string[]; videoUrls: string[] }>;
  shapeProbe?: { keys: string[]; hosts: string[] } | null;
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
  noteMedia: {},
  commentPagination: { hasMore: null, cursorObserved: false },
  selectedNoteId: '',
  commentArchiveExpiresAt: 0,
  commentArchiveMatchedPayloadCount: 0,
  commentArchiveBodyBytesRead: 0,
  commentArchive: [],
  commentArchivePagination: { hasMore: null, cursorObserved: false }
};

controller.noteMedia ??= {};
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
  const jsonObject = (value: unknown): Record<string, unknown> | null => {
    if (typeof value !== 'string' || value.length > maximumBodyBytes) return null;
    try {
      let parsed: unknown = JSON.parse(value);
      // A few web builds double-encode the card envelope before placing it in
      // the search item. Decode at most one additional layer; never evaluate
      // arbitrary script text.
      if (typeof parsed === 'string' && parsed.length <= maximumBodyBytes) parsed = JSON.parse(parsed);
      return object(parsed);
    } catch {
      return null;
    }
  };

  const project = createXiaohongshuSearchPayloadProjector({
    clean, object, jsonObject, maximumItems, maximumComments
  });

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
      if (projected.shapeProbe && !active.shapeProbe) active.shapeProbe = projected.shapeProbe;
      for (const [noteId, noteMedia] of Object.entries(projected.media ?? {})) {
        if (Object.keys(active.noteMedia).length >= 200) break;
        const knownMedia = active.noteMedia[noteId];
        active.noteMedia[noteId] = {
          imageUrls: knownMedia && knownMedia.imageUrls.length >= noteMedia.imageUrls.length ? knownMedia.imageUrls : noteMedia.imageUrls,
          videoUrls: knownMedia && knownMedia.videoUrls.length >= noteMedia.videoUrls.length ? knownMedia.videoUrls : noteMedia.videoUrls
        };
      }
      const knownDetails = new Set(active.details.map((detail) => detail.noteId));
      for (const detail of projected.details) {
        if (active.details.length >= maximumItems) break;
        if (!knownDetails.has(detail.noteId)) {
          knownDetails.add(detail.noteId);
          active.details.push(detail);
        }
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
