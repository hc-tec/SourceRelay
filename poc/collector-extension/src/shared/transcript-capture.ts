const MAX_TRACKS = 32;
const MAX_SEGMENTS = 10_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_LABEL_LENGTH = 160;
const APPROVED_SUBTITLE_ORIGIN = 'https://aisubtitle.hdslb.com';
const APPROVED_SUBTITLE_PATH = /^\/bfs\/ai_subtitle\/prod\/[A-Za-z0-9_-]{20,200}$/;

export const BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID =
  'bilibili.video.transcript.track-directory.response.v1' as const;
export const BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID =
  'bilibili.video.transcript.document.response.v1' as const;
export const BILIBILI_TRANSCRIPT_RESEARCH_ROUTE_IDS = [
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID
] as const;

export interface BilibiliTranscriptTrackProjection {
  id: number | string | null;
  language: string;
  languageLabel: string;
  aiStatus: number | null;
  aiType: number | null;
  locked: boolean | null;
  type: number | null;
  sourceUrl: string | null;
  sourceUrlV2: string | null;
  sourceRouteApproved: boolean;
}

export interface BilibiliTranscriptDirectoryProjection {
  artifactKind: 'bilibili_transcript_track_directory';
  language: string | null;
  languageLabel: string | null;
  allowSubmit: boolean | null;
  tracks: BilibiliTranscriptTrackProjection[];
  sourceTrackCount: number;
  storedTrackCount: number;
  droppedTrackCount: number;
  partial: boolean;
}

export interface BilibiliTranscriptSegmentProjection {
  segmentId: number | string | null;
  from: number;
  to: number;
  content: string;
  location: number | null;
  music: number | null;
}

export interface BilibiliTranscriptDocumentProjection {
  artifactKind: 'bilibili_public_subtitle_document';
  language: string;
  type: string | null;
  version: string | null;
  segments: BilibiliTranscriptSegmentProjection[];
  sourceSegmentCount: number;
  storedSegmentCount: number;
  droppedSegmentCount: number;
  partial: boolean;
  presentation: {
    backgroundAlpha: number | null;
    backgroundColor: string | null;
    fontColor: string | null;
    fontSize: number | null;
    stroke: string | null;
  };
}

export type BilibiliTranscriptProjection =
  | BilibiliTranscriptDirectoryProjection
  | BilibiliTranscriptDocumentProjection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = MAX_LABEL_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeId(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,40}$/.test(value)) return value;
  return null;
}

function publicSubtitleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return null;
  try {
    const url = new URL(value, 'https://www.bilibili.com');
    if (
      url.protocol !== 'https:' ||
      url.origin !== APPROVED_SUBTITLE_ORIGIN ||
      !APPROVED_SUBTITLE_PATH.test(url.pathname)
    ) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function projectTrack(value: unknown): BilibiliTranscriptTrackProjection | null {
  if (!isRecord(value)) return null;
  const language = boundedString(value.lan);
  const languageLabel = boundedString(value.lan_doc);
  if (!language || !languageLabel) return null;
  const sourceUrl = publicSubtitleUrl(value.subtitle_url);
  const sourceUrlV2 = publicSubtitleUrl(value.subtitle_url_v2);
  return {
    id: safeId(value.id_str) ?? safeId(value.id),
    language,
    languageLabel,
    aiStatus: finiteNumber(value.ai_status),
    aiType: finiteNumber(value.ai_type),
    locked: typeof value.is_lock === 'boolean' ? value.is_lock : null,
    type: finiteNumber(value.type),
    sourceUrl,
    sourceUrlV2,
    sourceRouteApproved: sourceUrl !== null || sourceUrlV2 !== null
  };
}

export function projectBilibiliTranscriptDirectory(value: unknown): BilibiliTranscriptDirectoryProjection | null {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.subtitle)) return null;
  const subtitle = value.data.subtitle;
  if (!Array.isArray(subtitle.subtitles)) return null;
  const tracks = subtitle.subtitles
    .slice(0, MAX_TRACKS)
    .map(projectTrack)
    .filter((track): track is BilibiliTranscriptTrackProjection => track !== null);
  const sourceTrackCount = subtitle.subtitles.length;
  const droppedTrackCount = sourceTrackCount - tracks.length;
  return {
    artifactKind: 'bilibili_transcript_track_directory',
    language: boundedString(subtitle.lan),
    languageLabel: boundedString(subtitle.lan_doc),
    allowSubmit: typeof subtitle.allow_submit === 'boolean' ? subtitle.allow_submit : null,
    tracks,
    sourceTrackCount,
    storedTrackCount: tracks.length,
    droppedTrackCount,
    partial: droppedTrackCount > 0
  };
}

function projectSegment(value: unknown): BilibiliTranscriptSegmentProjection | null {
  if (!isRecord(value)) return null;
  const from = finiteNumber(value.from);
  const to = finiteNumber(value.to);
  if (
    from === null ||
    to === null ||
    from < 0 ||
    to < from ||
    typeof value.content !== 'string' ||
    value.content.length > MAX_TEXT_LENGTH
  ) return null;
  return {
    segmentId: safeId(value.sid),
    from,
    to,
    content: value.content,
    location: finiteNumber(value.location),
    music: finiteNumber(value.music)
  };
}

export function projectBilibiliTranscriptDocument(value: unknown): BilibiliTranscriptDocumentProjection | null {
  if (!isRecord(value) || !Array.isArray(value.body)) return null;
  const language = boundedString(value.lang);
  if (!language) return null;
  const segments = value.body
    .slice(0, MAX_SEGMENTS)
    .map(projectSegment)
    .filter((segment): segment is BilibiliTranscriptSegmentProjection => segment !== null);
  const sourceSegmentCount = value.body.length;
  const droppedSegmentCount = sourceSegmentCount - segments.length;
  if (sourceSegmentCount > 0 && segments.length === 0) return null;
  return {
    artifactKind: 'bilibili_public_subtitle_document',
    language,
    type: boundedString(value.type),
    version: boundedString(value.version),
    segments,
    sourceSegmentCount,
    storedSegmentCount: segments.length,
    droppedSegmentCount,
    partial: droppedSegmentCount > 0,
    presentation: {
      backgroundAlpha: finiteNumber(value.background_alpha),
      backgroundColor: boundedString(value.background_color),
      fontColor: boundedString(value.font_color),
      fontSize: finiteNumber(value.font_size),
      stroke: boundedString(value.Stroke)
    }
  };
}

function reprojectDirectory(value: Record<string, unknown>): BilibiliTranscriptDirectoryProjection | null {
  if (!Array.isArray(value.tracks)) return null;
  const tracks = value.tracks.slice(0, MAX_TRACKS).map((track) => {
    if (!isRecord(track)) return null;
    return projectTrack({
      id_str: track.id,
      lan: track.language,
      lan_doc: track.languageLabel,
      ai_status: track.aiStatus,
      ai_type: track.aiType,
      is_lock: track.locked,
      type: track.type,
      subtitle_url: track.sourceUrl,
      subtitle_url_v2: track.sourceUrlV2
    });
  }).filter((track): track is BilibiliTranscriptTrackProjection => track !== null);
  const declaredSourceCount = typeof value.sourceTrackCount === 'number' &&
    Number.isSafeInteger(value.sourceTrackCount) && value.sourceTrackCount >= tracks.length
    ? value.sourceTrackCount
    : tracks.length;
  return {
    artifactKind: 'bilibili_transcript_track_directory',
    language: value.language === null ? null : boundedString(value.language),
    languageLabel: value.languageLabel === null ? null : boundedString(value.languageLabel),
    allowSubmit: typeof value.allowSubmit === 'boolean' ? value.allowSubmit : null,
    tracks,
    sourceTrackCount: declaredSourceCount,
    storedTrackCount: tracks.length,
    droppedTrackCount: declaredSourceCount - tracks.length,
    partial: declaredSourceCount > tracks.length
  };
}

function reprojectDocument(value: Record<string, unknown>): BilibiliTranscriptDocumentProjection | null {
  if (!Array.isArray(value.segments)) return null;
  const language = boundedString(value.language);
  if (!language) return null;
  const segments = value.segments.slice(0, MAX_SEGMENTS).map((segment) => {
    if (!isRecord(segment)) return null;
    return projectSegment({
      sid: segment.segmentId,
      from: segment.from,
      to: segment.to,
      content: segment.content,
      location: segment.location,
      music: segment.music
    });
  }).filter((segment): segment is BilibiliTranscriptSegmentProjection => segment !== null);
  const declaredSourceCount = typeof value.sourceSegmentCount === 'number' &&
    Number.isSafeInteger(value.sourceSegmentCount) && value.sourceSegmentCount >= segments.length
    ? value.sourceSegmentCount
    : segments.length;
  const presentation = isRecord(value.presentation) ? value.presentation : {};
  return {
    artifactKind: 'bilibili_public_subtitle_document',
    language,
    type: value.type === null ? null : boundedString(value.type),
    version: value.version === null ? null : boundedString(value.version),
    segments,
    sourceSegmentCount: declaredSourceCount,
    storedSegmentCount: segments.length,
    droppedSegmentCount: declaredSourceCount - segments.length,
    partial: declaredSourceCount > segments.length,
    presentation: {
      backgroundAlpha: finiteNumber(presentation.backgroundAlpha),
      backgroundColor: presentation.backgroundColor === null ? null : boundedString(presentation.backgroundColor),
      fontColor: presentation.fontColor === null ? null : boundedString(presentation.fontColor),
      fontSize: finiteNumber(presentation.fontSize),
      stroke: presentation.stroke === null ? null : boundedString(presentation.stroke)
    }
  };
}

export function projectBilibiliTranscriptRouteBody(
  routeId: string,
  value: unknown
): BilibiliTranscriptProjection | null {
  if (isRecord(value) && value.artifactKind === 'bilibili_transcript_track_directory') {
    return routeId === BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID ? reprojectDirectory(value) : null;
  }
  if (isRecord(value) && value.artifactKind === 'bilibili_public_subtitle_document') {
    return routeId === BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID ? reprojectDocument(value) : null;
  }
  if (routeId === BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID) {
    return projectBilibiliTranscriptDirectory(value);
  }
  if (routeId === BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID) {
    return projectBilibiliTranscriptDocument(value);
  }
  return null;
}
