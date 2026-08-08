const MAX_TRACKS = 32;
const MAX_SEGMENTS = 10_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_LABEL_LENGTH = 160;
const APPROVED_SUBTITLE_ORIGIN = 'https://aisubtitle.hdslb.com';
const APPROVED_SUBTITLE_PATH = /^\/bfs\/ai_subtitle\/prod\/[A-Za-z0-9_-]{20,200}$/;
const APPROVED_SUBTITLE_BINARY_ORIGIN = 'https://subtitle.bilibili.com';
const MAX_BINARY_SUBTITLE_PATH_LENGTH = 400;

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
      !approvedSubtitleLocation(url.origin, url.pathname)
    ) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function approvedSubtitleLocation(origin: string, pathname: string): boolean {
  if (origin === APPROVED_SUBTITLE_ORIGIN) return APPROVED_SUBTITLE_PATH.test(pathname);
  if (origin !== APPROVED_SUBTITLE_BINARY_ORIGIN ||
    pathname.length < 2 || pathname.length > MAX_BINARY_SUBTITLE_PATH_LENGTH ||
    /[\u0000-\u0020\u007f]/.test(pathname)) return false;
  for (let index = 1; index < pathname.length; index += 1) {
    if (pathname[index] !== '%') continue;
    if (index + 2 >= pathname.length || !/^[0-9A-Fa-f]{2}$/.test(pathname.slice(index + 1, index + 3))) {
      return false;
    }
    index += 2;
  }
  return true;
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

interface ProtobufField {
  number: number;
  wireType: number;
  value?: bigint;
  bytes?: Uint8Array;
}

function readProtobufVarint(bytes: Uint8Array, offset: number): { offset: number; value: bigint } | null {
  let value = 0n;
  let shift = 0n;
  while (offset < bytes.length && shift < 70n) {
    const byte = bytes[offset++] ?? 0;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { offset, value };
    shift += 7n;
  }
  return null;
}

function readProtobufFields(bytes: Uint8Array, depth = 0): ProtobufField[] {
  if (depth > 6) return [];
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < bytes.length && fields.length < 128) {
    const key = readProtobufVarint(bytes, offset);
    if (!key) break;
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (!Number.isSafeInteger(number) || number < 1) break;
    if (wireType === 0) {
      const value = readProtobufVarint(bytes, offset);
      if (!value) break;
      offset = value.offset;
      fields.push({ number, wireType, value: value.value });
      continue;
    }
    if (wireType === 2) {
      const length = readProtobufVarint(bytes, offset);
      if (!length || length.value > BigInt(bytes.length - length.offset)) break;
      offset = length.offset;
      const end = offset + Number(length.value);
      fields.push({ number, wireType, bytes: bytes.slice(offset, end) });
      offset = end;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > bytes.length) break;
      fields.push({ number, wireType });
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > bytes.length) break;
      fields.push({ number, wireType });
      offset += 4;
      continue;
    }
    break;
  }
  return fields;
}

function protobufText(field: ProtobufField | undefined, maximum = MAX_LABEL_LENGTH): string | null {
  if (!field?.bytes || field.bytes.length > maximum) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(field.bytes);
  if (text.length === 0 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function protobufSafeId(field: ProtobufField | undefined): number | string | null {
  const text = protobufText(field);
  if (text) return safeId(text);
  if (field?.value !== undefined && field.value >= 0n && field.value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(field.value);
  }
  return null;
}

function protobufTrackCandidate(fields: ProtobufField[]): BilibiliTranscriptTrackProjection | null {
  const languageField = fields.find((field) => field.number === 3 && field.wireType === 2);
  const labelField = fields.find((field) => field.number === 4 && field.wireType === 2);
  const language = protobufText(languageField);
  const languageLabel = protobufText(labelField);
  if (!language || !languageLabel || language.length > MAX_LABEL_LENGTH || languageLabel.length > MAX_LABEL_LENGTH) {
    return null;
  }
  const urlField = fields.find((field) => field.number === 5 && field.wireType === 2);
  const sourceUrl = publicSubtitleUrl(protobufText(urlField, 2_000));
  const idString = fields.find((field) => field.number === 2 && field.wireType === 2);
  const id = protobufSafeId(idString) ?? protobufSafeId(fields.find((field) => field.number === 1 && field.wireType === 0));
  const aiStatus = fields.find((field) => field.number === 7 && field.wireType === 0)?.value;
  const type = fields.find((field) => field.number === 10 && field.wireType === 0)?.value;
  return {
    id,
    language,
    languageLabel,
    aiStatus: aiStatus !== undefined && aiStatus <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(aiStatus) : null,
    aiType: null,
    locked: null,
    type: type !== undefined && type <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(type) : null,
    sourceUrl,
    sourceUrlV2: null,
    sourceRouteApproved: sourceUrl !== null
  };
}

function findProtobufTracks(bytes: Uint8Array, depth = 0): BilibiliTranscriptTrackProjection[] {
  if (depth > 5) return [];
  const fields = readProtobufFields(bytes, depth);
  const direct = protobufTrackCandidate(fields);
  const tracks: BilibiliTranscriptTrackProjection[] = direct ? [direct] : [];
  for (const field of fields) {
    if (field.wireType !== 2 || !field.bytes || field.bytes.length === bytes.length) continue;
    tracks.push(...findProtobufTracks(field.bytes, depth + 1));
  }
  return tracks;
}

/**
 * Bilibili's current subtitle directory endpoint is a bounded protobuf
 * envelope (`/x/v2/subtitle/web/view`, application/octet-stream).  We do not
 * retain the signed URL query; only the approved origin/path is projected.
 */
export function projectBilibiliTranscriptDirectoryProtobuf(
  bytes: Uint8Array
): BilibiliTranscriptDirectoryProjection | null {
  if (bytes.length === 0 || bytes.length > 128 * 1024) return null;
  const allTracks = findProtobufTracks(bytes)
    .filter((track, index, all) => all.findIndex((candidate) =>
      candidate.language === track.language && candidate.languageLabel === track.languageLabel &&
      candidate.sourceUrl === track.sourceUrl
    ) === index)
  const tracks = allTracks.slice(0, MAX_TRACKS);
  if (allTracks.length === 0) return null;
  const droppedTrackCount = allTracks.length - tracks.length;
  return {
    artifactKind: 'bilibili_transcript_track_directory',
    language: tracks[0]?.language ?? null,
    languageLabel: tracks[0]?.languageLabel ?? null,
    allowSubmit: null,
    tracks,
    sourceTrackCount: allTracks.length,
    storedTrackCount: tracks.length,
    droppedTrackCount,
    partial: droppedTrackCount > 0
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
