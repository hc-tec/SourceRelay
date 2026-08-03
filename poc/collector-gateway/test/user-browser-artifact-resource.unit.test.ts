import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { FoundUserBrowserArtifact } from '../src/user-browser-artifact-reader-registry.js';
import {
  USER_BROWSER_ARTIFACT_MAX_WINDOW_BYTES,
  userBrowserArtifactContentWindow,
  userBrowserArtifactMetadata
} from '../src/user-browser-artifact-resource.js';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';

function found(): FoundUserBrowserArtifact {
  return {
    capability: 'bilibili.video_detail',
    artifactId: ARTIFACT_ID,
    view: {
      summary: {
        artifactId: ARTIFACT_ID,
        runId: OPERATION_ID,
        capturedAt: '2026-08-03T00:00:00.000Z',
        state: 'completed'
      },
      result: { title: '中文与 emoji 😀', lines: ['第一行', 'second'] }
    }
  };
}

describe('user-browser Artifact Resources', () => {
  test('projects metadata without a local path or full body', () => {
    const metadata = userBrowserArtifactMetadata(found());
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      artifactId: ARTIFACT_ID,
      operationId: OPERATION_ID,
      capability: 'bilibili.video_detail',
      mediaType: 'application/json',
      representation: 'canonical_json_utf8',
      capturedAt: '2026-08-03T00:00:00.000Z',
      terminalStatus: 'completed',
      retentionClass: 'core_managed_local',
      retainedUntil: null,
      deletionState: 'retained',
      available: true
    });
    expect(metadata.byteLength).toBeGreaterThan(0);
    expect(metadata.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(metadata).not.toHaveProperty('path');
    expect(metadata).not.toHaveProperty('text');
  });

  test('reassembles bounded UTF-8 windows with stable whole and chunk hashes', () => {
    const chunks: string[] = [];
    let offset = 0;
    let wholeSha256: string | null = null;
    while (true) {
      const window = userBrowserArtifactContentWindow(found(), offset, 17);
      expect(Buffer.byteLength(window.text, 'utf8')).toBeLessThanOrEqual(17);
      expect(window.chunkSha256).toBe(
        `sha256:${createHash('sha256').update(window.text, 'utf8').digest('hex')}`
      );
      wholeSha256 ??= window.sha256;
      expect(window.sha256).toBe(wholeSha256);
      chunks.push(window.text);
      if (window.nextOffset === null) break;
      expect(window.nextOffset).toBeGreaterThan(offset);
      offset = window.nextOffset;
    }
    const text = chunks.join('');
    expect(text).toContain('中文与 emoji 😀');
    expect(Buffer.byteLength(text, 'utf8')).toBe(userBrowserArtifactMetadata(found()).byteLength);
    expect(wholeSha256).toBe(`sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`);
  });

  test('rejects non-boundary, out-of-range and oversized windows', () => {
    const full = userBrowserArtifactContentWindow(found(), 0, USER_BROWSER_ARTIFACT_MAX_WINDOW_BYTES);
    const bytes = Buffer.from(full.text, 'utf8');
    const emojiStart = bytes.indexOf(Buffer.from('😀', 'utf8'));
    expect(emojiStart).toBeGreaterThan(0);
    expect(() => userBrowserArtifactContentWindow(found(), emojiStart + 1, 16))
      .toThrow('collector_service_artifact_offset_not_utf8_boundary');
    expect(() => userBrowserArtifactContentWindow(found(), bytes.length + 1, 16))
      .toThrow('collector_service_artifact_read_out_of_bounds');
    expect(() => userBrowserArtifactContentWindow(found(), 0, USER_BROWSER_ARTIFACT_MAX_WINDOW_BYTES + 1))
      .toThrow('collector_service_artifact_window_invalid');
  });
});
