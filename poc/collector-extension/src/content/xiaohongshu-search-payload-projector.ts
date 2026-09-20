// Pure projector for Xiaohongshu public search/homefeed/feed payloads.
//
// Field shapes are taken from field-tested captures (camelCase envelopes in
// some builds, snake_case in others — both accepted): note cards carry
// display_title/displayTitle, cover.{url,url_default,urlPre,info_list[].url},
// image_list[].url_default and video.media.stream.h264[].master_url for video
// notes. Media references are classified by key/path: video stream URLs under
// video subtrees, everything image/cover-like under image keys. Avatars live
// on the user subtree and are never classified as note media because their
// keys never match the media patterns.

export interface XhsPublicSearchItem {
  noteId: string;
  title: string;
  contentType: string;
  authorId: string;
  authorNickname: string;
  likedCountText: string;
}

export interface XhsPublicNoteDetail {
  noteId: string;
  publicText: string;
  authorNickname: string;
  interactionText: string;
  imageUrls?: string[];
  videoUrls?: string[];
}

export interface XhsArchivedPublicComment {
  commentId: string;
  publicText: string;
  authorNickname: string;
  likedCountText: string;
  subCommentCountText: string;
  createdAtText: string;
  locationText: string;
  parentNoteId: string;
  parentCommentId: string;
}

export interface XhsSearchShapeProbe {
  keys: string[];
  hosts: string[];
  /** Raw values of the media URL fields on the probed card (cover.url*,
   * image_list[0].url/url_default/info_list[].url). Public CDN references;
   * needed to diagnose how the platform stores image URLs (empty vs
   * protocol-relative vs absolute). */
  mediaUrlSamples: Record<string, string>;
}

export interface XhsSearchProjection {
  items: XhsPublicSearchItem[];
  details: XhsPublicNoteDetail[];
  comments: XhsArchivedPublicComment[];
  media: Record<string, { imageUrls: string[]; videoUrls: string[] }>;
  /** Structure-only probe of the first note card seen (key tree to depth 4
   * plus https hostname samples). Never carries content values. */
  shapeProbe?: XhsSearchShapeProbe;
  hasMore: boolean | null;
  cursorObserved: boolean;
}

export interface XhsSearchProjectorDeps {
  clean(value: unknown, maximum: number): string;
  object(value: unknown): Record<string, unknown> | null;
  jsonObject(value: unknown): Record<string, unknown> | null;
  maximumItems: number;
  maximumComments: number;
}

export function createXiaohongshuSearchPayloadProjector(deps: XhsSearchProjectorDeps) {
  const { clean, object, jsonObject, maximumItems, maximumComments } = deps;
  return function project(value: unknown): XhsSearchProjection {
    const items: XhsPublicSearchItem[] = [];
    const details: XhsPublicNoteDetail[] = [];
    const comments: XhsArchivedPublicComment[] = [];
    const mediaByNote: Record<string, { imageUrls: string[]; videoUrls: string[] }> = {};
    let shapeProbe: XhsSearchShapeProbe | null = null;
    let mediaUrlSamples: Record<string, string> | null = null;
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
            record.rootCommentId ?? record.target_comment_id ?? record.target_comment_id ?? record.targetCommentId ?? inheritedParentCommentId, 100)
        });
      }
      const recordHasMore = record.has_more ?? record.hasMore;
      if (typeof recordHasMore === 'boolean') hasMore = recordHasMore;
      if (clean(record.cursor ?? record.next_cursor ?? record.nextCursor, 200)) cursorObserved = true;
      // Search/profile responses have changed the card envelope several
      // times: some builds expose `note_card` as an object, others flatten it
      // or serialise it as JSON.  Keep the projector shape-bound and only
      // promote records that carry a note identity plus a title-like field.
      const card = object(record.note_card ?? record.noteCard ?? record.note ?? record.card) ??
        jsonObject(record.note_card ?? record.noteCard);
      const candidate = card ?? (Object.hasOwn(record, 'model_type') ||
        Object.hasOwn(record, 'display_title') || Object.hasOwn(record, 'note_id') ? record : null);
      if (candidate) {
        const user = object(candidate.user ?? candidate.user_info ?? record.user ?? record.user_info) ?? {};
        const interact = object(candidate.interact_info ?? candidate.interactInfo ?? record.interact_info) ?? {};
        const noteId = clean(candidate.note_id ?? candidate.noteId ?? record.note_id ?? record.noteId ?? record.id, 80);
        const title = clean(candidate.display_title ?? candidate.title ?? record.display_title ?? record.title, 500);
        if (noteId && title) {
          items.push({
            noteId,
            title,
            contentType: clean(candidate.type ?? record.model_type, 40),
            authorId: clean(user.user_id ?? user.userId, 80),
            authorNickname: clean(user.nickname ?? user.nick_name, 200),
            likedCountText: clean(interact.liked_count ?? interact.likedCount, 40)
          });
        }
        // One structure-only probe per payload: the first card's key tree
        // (depth 4) plus https hostname samples — no content values.
        if (!shapeProbe && noteId) {
          const keys: string[] = [];
          const probeKeys = (nodeValue: unknown, depth: number, path: string): void => {
            if (depth > 4 || keys.length >= 80) return;
            if (Array.isArray(nodeValue)) {
              if (nodeValue.length > 0) probeKeys(nodeValue[0], depth + 1, `${path}[]`);
              return;
            }
            const recordValue = object(nodeValue);
            if (!recordValue) return;
            for (const [key, child] of Object.entries(recordValue).slice(0, 40)) {
              const childPath = `${path}.${key}`;
              keys.push(childPath);
              if (child && typeof child === 'object') probeKeys(child, depth + 1, childPath);
            }
          };
          probeKeys(candidate, 0, '');
          const hosts: string[] = [];
          const collectHosts = (nodeValue: unknown, depth: number): void => {
            if (depth > 7 || hosts.length >= 8) return;
            if (Array.isArray(nodeValue)) {
              for (const entry of nodeValue.slice(0, 40)) collectHosts(entry, depth + 1);
              return;
            }
            const recordValue = object(nodeValue);
            if (!recordValue) return;
            for (const child of Object.values(recordValue).slice(0, 60)) {
              if (typeof child === 'string' && child.startsWith('https://')) {
                try {
                  const host = new URL(child).hostname;
                  if (!hosts.includes(host)) hosts.push(host);
                } catch { /* ignore */ }
              } else if (child && typeof child === 'object') {
                collectHosts(child, depth + 1);
              }
            }
          };
          collectHosts(candidate, 0);
          // Raw media URL field values for the first card: the exact strings
          // the payload carries (empty / protocol-relative / absolute).
          const samples: Record<string, string> = {};
          const sampleUrlFields = (nodeValue: unknown, depth: number, path: string): void => {
            if (depth > 5) return;
            if (Array.isArray(nodeValue)) {
              for (const [index, entry] of nodeValue.slice(0, 3).entries()) {
                sampleUrlFields(entry, depth + 1, `${path}[${index}]`);
              }
              return;
            }
            const recordValue = object(nodeValue);
            if (!recordValue) return;
            for (const [key, child] of Object.entries(recordValue).slice(0, 40)) {
              if (/^(url|url_default|url_pre|master_url|url_preload)$/i.test(key)) {
                samples[`${path}.${key}`] = typeof child === 'string' ? child.slice(0, 160) : '<non-string>';
              } else if (child && typeof child === 'object') {
                sampleUrlFields(child, depth + 1, `${path}.${key}`);
              }
            }
          };
          sampleUrlFields(candidate, 0, '');
          if (Object.keys(samples).length > 0) mediaUrlSamples = samples;
          shapeProbe = { keys, hosts, mediaUrlSamples: samples };
        }
        // Media references ride every note card (image_list / cover / video
        // subtrees), independent of whether the card carries a description.
        // Classified by key path: video subtrees yield stream sources, image
        // and cover keys yield picture references. Avatars live under user
        // keys and never match.
        if (noteId) {
          const media: { imageUrls: string[]; videoUrls: string[] } = { imageUrls: [], videoUrls: [] };
          const collectMediaUrl = (nodeValue: unknown, depth: number, path: string): void => {
            if (depth > 7 || (media.imageUrls.length >= 24 && media.videoUrls.length >= 4)) return;
            if (Array.isArray(nodeValue)) {
              for (const entry of nodeValue.slice(0, 40)) collectMediaUrl(entry, depth + 1, path);
              return;
            }
            const recordValue = object(nodeValue);
            if (!recordValue) return;
            for (const [key, child] of Object.entries(recordValue).slice(0, 60)) {
              if (/token|cookie|session|captcha|verify|secret|password|avatar/i.test(key)) continue;
              const childPath = `${path}.${key}`;
              if (typeof child === 'string' && child.length <= 1024 &&
                (child.startsWith('https://') || child.startsWith('//'))) {
                // The payload stores image URLs protocol-relative ('//sns-…')
                // or empty; the client prepends https: at render time.
                const absolute = child.startsWith('//') ? `https:${child}` : child;
                if (/master_?url|video_?url|play_?url|media_?url/i.test(key) || /video|stream/i.test(childPath)) {
                  if (media.videoUrls.length < 4 && !media.videoUrls.includes(absolute)) media.videoUrls.push(absolute);
                } else if (/image|cover|pic/i.test(key) || /image|cover/i.test(childPath) || key === 'url') {
                  if (media.imageUrls.length < 24 && !media.imageUrls.includes(absolute)) media.imageUrls.push(absolute);
                }
              } else if (child && typeof child === 'object') {
                collectMediaUrl(child, depth + 1, childPath);
              }
            }
          };
          collectMediaUrl(candidate, 0, '');
          // URL-content filtering is authoritative: avatar/platform/comment
          // references can surface under image-ish keys depending on the
          // payload build, so classify by the URL itself.
          media.imageUrls = media.imageUrls.filter((url) =>
            !/\/avatar\/|sns-avatar|picasso-static|fe-platform|\/comment\//.test(url));
          if (media.imageUrls.length > 0 || media.videoUrls.length > 0) {
            const knownMedia = mediaByNote[noteId];
            mediaByNote[noteId] = {
              imageUrls: knownMedia && knownMedia.imageUrls.length >= media.imageUrls.length ? knownMedia.imageUrls : media.imageUrls,
              videoUrls: knownMedia && knownMedia.videoUrls.length >= media.videoUrls.length ? knownMedia.videoUrls : media.videoUrls
            };
          }
        }
        const description = clean(candidate.desc ?? candidate.description ?? candidate.content ?? record.desc, 11_000);
        if (noteId && description && details.length < maximumItems) {
          const publicTitle = clean(candidate.title ?? candidate.display_title ?? title, 500);
          const detail: XhsPublicNoteDetail = {
            noteId,
            publicText: clean(`${publicTitle}\n${description}`, 12_000),
            authorNickname: clean(user.nickname ?? user.nick_name, 200),
            interactionText: clean(Object.values(interact).filter((entry) =>
              typeof entry === 'string' || typeof entry === 'number').join(' '), 1_000)
          };
          const noteMedia = mediaByNote[noteId];
          if (noteMedia?.imageUrls.length) detail.imageUrls = noteMedia.imageUrls;
          if (noteMedia?.videoUrls.length) detail.videoUrls = noteMedia.videoUrls;
          details.push(detail);
        }
      }
      for (const [key, child] of Object.entries(record).slice(0, 80)) {
        if (/token|cookie|session|captcha|verify|phone|email|xsec|secret|password/i.test(key)) continue;
        const nestedReplyCollection = /^(?:sub_?comments?|subComments?|repl(?:y|ies)|reply_?list)$/i.test(key);
        visit(child, depth + 1, nestedReplyCollection && commentId ? commentId : inheritedParentCommentId);
      }
    };
    visit(value, 0);
    return {
      items, details, comments, media: mediaByNote,
      ...(shapeProbe ? { shapeProbe } : {}),
      hasMore, cursorObserved
    };
  };
}
