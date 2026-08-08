import { describe, expect, test } from 'vitest';
import {
  BILIBILI_DYNAMIC_FEED_ROUTE_ID,
  approvedNetworkCaptureRouteIds,
  bilibiliTranscriptResearchRouteIds,
  createNetworkCaptureFromBytes,
  createNetworkCaptureFromText,
  findNetworkCaptureRoute,
  isNetworkCaptureResponseContentType,
  isJsonContentType,
  routeMatchesNetworkCaptureUrl,
  sanitiseCaptureUrl,
  sanitiseNetworkCaptureObservation,
  sanitiseNetworkJson,
  validateNetworkCaptureRouteIds
} from '../src/shared/network-capture.js';
import {
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
  projectBilibiliTranscriptDirectoryProtobuf
} from '../src/shared/transcript-capture.js';

// These inputs exercise the local redaction and route gate only. They are not
// synthetic platform/XHR evidence and do not claim that a live route works.
const dynamicUrl = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?offset=private-value#ignored';

function varint(value: bigint): number[] {
  const bytes: number[] = [];
  let current = value;
  while (current >= 0x80n) {
    bytes.push(Number(current & 0x7fn) | 0x80);
    current >>= 7n;
  }
  bytes.push(Number(current));
  return bytes;
}

function field(number: number, wireType: 0 | 2, value: bigint | string | number[]): number[] {
  const key = varint(BigInt(number << 3 | wireType));
  if (wireType === 0) return [...key, ...varint(value as bigint)];
  const bytes = typeof value === 'string' ? [...new TextEncoder().encode(value)] : value as number[];
  return [...key, ...varint(BigInt(bytes.length)), ...bytes];
}

function concat(...parts: number[][]): number[] {
  return parts.flat();
}

describe('Extension network observation safety contract', () => {
  test('redacts sensitive keys and text before any observation reaches an artifact boundary', () => {
    const result = sanitiseNetworkJson({
      title: 'token=private-value visible title',
      cookie: 'never-retained',
      userSid: 'never-retained',
      nested: { publicField: 'okay', authorization: 'Bearer sensitive-value' },
      prototype: 'unsafe',
      finite: 1,
      invalid: Number.POSITIVE_INFINITY
    });
    const serialised = JSON.stringify(result);
    expect(serialised).toContain('publicField');
    expect(serialised).toContain('[redacted]');
    expect(serialised).not.toContain('private-value');
    expect(serialised).not.toContain('never-retained');
    expect(serialised).not.toContain('authorization');
    expect(serialised).not.toContain('prototype');
    expect(serialised).not.toContain('invalid');
  });

  test('allows only explicit research route IDs and canonicalises URL metadata without query values', () => {
    expect(approvedNetworkCaptureRouteIds('bilibili')).toEqual([]);
    expect(validateNetworkCaptureRouteIds(
      'bilibili',
      [BILIBILI_DYNAMIC_FEED_ROUTE_ID],
      'research_validation'
    )).toEqual([BILIBILI_DYNAMIC_FEED_ROUTE_ID]);
    expect(validateNetworkCaptureRouteIds(
      'bilibili',
      [BILIBILI_DYNAMIC_FEED_ROUTE_ID, BILIBILI_DYNAMIC_FEED_ROUTE_ID],
      'research_validation'
    )).toBeNull();
    expect(validateNetworkCaptureRouteIds(
      'bilibili',
      [BILIBILI_DYNAMIC_FEED_ROUTE_ID],
      'production'
    )).toBeNull();
    expect(bilibiliTranscriptResearchRouteIds()).toEqual([
      BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
      BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID
    ]);
    expect(sanitiseCaptureUrl(dynamicUrl)).toBe('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space');

    const route = findNetworkCaptureRoute('bilibili', dynamicUrl, [BILIBILI_DYNAMIC_FEED_ROUTE_ID]);
    expect(route?.id).toBe(BILIBILI_DYNAMIC_FEED_ROUTE_ID);
    if (!route) throw new Error('dynamic_route_missing');
    expect(routeMatchesNetworkCaptureUrl(route, 'https://attacker.invalid/x/polymer/web-dynamic/v1/feed/space')).toBe(false);
  });

  test('rejects invalid media and revalidates a page-world observation against the permitted route', () => {
    const route = findNetworkCaptureRoute('bilibili', dynamicUrl, [BILIBILI_DYNAMIC_FEED_ROUTE_ID]);
    if (!route) throw new Error('dynamic_route_missing');
    expect(isJsonContentType('application/problem+json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('text/html')).toBe(false);
    const rejection = createNetworkCaptureFromText({
      platform: 'bilibili',
      route,
      method: 'POST',
      responseUrl: dynamicUrl,
      contentType: 'text/html',
      httpStatus: 200
    }, '{"token":"private"}');
    expect(rejection).toMatchObject({ status: 'payload_rejected', rejectionReason: 'mime_not_allowed' });

    const observed = sanitiseNetworkCaptureObservation({
      schemaVersion: 1,
      platform: 'bilibili',
      routeId: BILIBILI_DYNAMIC_FEED_ROUTE_ID,
      status: 'captured',
      method: 'POST',
      responseUrl: dynamicUrl,
      contentType: 'application/json; charset=utf-8',
      httpStatus: 200,
      capturedAt: 1_753_144_000_000,
      bodyBytes: 48,
      bodySha256: 'a'.repeat(64),
      queryKeyNames: ['offset', 'offset', 'timezone'],
      body: { publicTitle: 'visible', cookie: 'never-retained' }
    }, [BILIBILI_DYNAMIC_FEED_ROUTE_ID]);
    expect(observed).toMatchObject({
      status: 'captured',
      responseUrl: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space',
      queryKeyNames: ['offset', 'timezone'],
      body: { publicTitle: 'visible' }
    });
    expect(sanitiseNetworkCaptureObservation({
      ...observed!,
      routeId: 'bilibili.other.response.v1'
    }, [BILIBILI_DYNAMIC_FEED_ROUTE_ID])).toBeNull();
  });

  test('projects the current protobuf subtitle directory and accepts its signed track route', () => {
    const track = concat(
      field(1, 0, 1897299281468062720n),
      field(2, 2, '1897299281468062720'),
      field(3, 2, 'ai-zh'),
      field(4, 2, '中文'),
      field(5, 2, '//subtitle.bilibili.com/%01%1Bopaque?auth_key=redacted'),
      field(7, 0, 1n),
      field(8, 2, '中文'),
      field(10, 0, 2n)
    );
    const responseBytes = new Uint8Array(field(1, 2, field(3, 2, track)));
    const directory = projectBilibiliTranscriptDirectoryProtobuf(responseBytes);
    expect(directory).toMatchObject({
      artifactKind: 'bilibili_transcript_track_directory',
      sourceTrackCount: 1,
      storedTrackCount: 1,
      tracks: [{ language: 'ai-zh', languageLabel: '中文', sourceRouteApproved: true }]
    });

    const responseUrl = 'https://api.bilibili.com/x/v2/subtitle/web/view?public=1';
    const route = findNetworkCaptureRoute('bilibili', responseUrl, [BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID]);
    expect(route?.responseEncoding).toBe('protobuf');
    expect(isNetworkCaptureResponseContentType(route!, 'application/octet-stream')).toBe(true);
    const observed = createNetworkCaptureFromBytes({
      platform: 'bilibili',
      route: route!,
      method: 'GET',
      responseUrl,
      contentType: 'application/octet-stream',
      httpStatus: 200
    }, responseBytes);
    expect(observed).toMatchObject({
      status: 'captured',
      routeId: BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
      body: { artifactKind: 'bilibili_transcript_track_directory', storedTrackCount: 1 }
    });
    expect(sanitiseNetworkCaptureObservation(observed, [BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID])).toMatchObject({
      status: 'captured',
      body: { artifactKind: 'bilibili_transcript_track_directory', storedTrackCount: 1 }
    });

  });
});
