import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createUserBrowserServiceRouteHarness } from './support/user-browser-service-route-harness.js';

describe('Collector Service Artifact resources', () => {
  test('serves authenticated metadata and bounded UTF-8 windows without exposing a path', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const artifact = await harness.recordDiscussionArtifact();
      const unauthorised = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}`
      );
      expect(unauthorised.status).toBe(401);

      const metadataResponse = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}`,
        harness.token
      );
      expect(metadataResponse.status).toBe(200);
      expect(metadataResponse.body).toMatchObject({
        schemaVersion: 3,
        metadata: {
          schemaVersion: 1,
          artifactId: artifact.artifactId,
          operationId: artifact.operationId,
          capability: 'bilibili.discussion',
          mediaType: 'application/json',
          representation: 'canonical_json_utf8',
          retentionClass: 'core_managed_local',
          deletionState: 'retained',
          available: true
        }
      });
      const metadata = metadataResponse.body.metadata as Record<string, any>;
      expect(JSON.stringify(metadata)).not.toMatch(/(?:file|directory|path|profile)/i);

      let offset = 0;
      let reconstructed = '';
      do {
        const windowResponse = await readJson(
          `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}/content?offset=${offset}&maxBytes=64`,
          harness.token
        );
        expect(windowResponse.status).toBe(200);
        const window = windowResponse.body.window as Record<string, any>;
        expect(window).toMatchObject({
          schemaVersion: 1,
          artifactId: artifact.artifactId,
          capability: 'bilibili.discussion',
          representation: 'canonical_json_utf8',
          encoding: 'utf-8',
          offset,
          maximumBytes: 64
        });
        expect(Buffer.byteLength(window.text, 'utf8')).toBeLessThanOrEqual(64);
        reconstructed += window.text;
        if (window.nextOffset === null) break;
        expect(window.nextOffset).toBeGreaterThan(offset);
        offset = window.nextOffset;
      } while (true);
      expect(Buffer.byteLength(reconstructed, 'utf8')).toBe(metadata.byteLength);
      expect(reconstructed).toContain('公开评论与中文边界');
      expect(JSON.parse(reconstructed)).toMatchObject({
        schemaVersion: 3,
        capability: 'bilibili.discussion'
      });

      const chineseStart = Buffer.from(reconstructed, 'utf8').indexOf(Buffer.from('公开'));
      expect(chineseStart).toBeGreaterThan(0);
      const nonBoundary = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}/content?offset=${chineseStart + 1}&maxBytes=64`,
        harness.token
      );
      expect(nonBoundary).toMatchObject({
        status: 416,
        body: { error: 'collector_service_artifact_offset_not_utf8_boundary' }
      });
      const outOfRange = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}/content?offset=${metadata.byteLength + 1}&maxBytes=64`,
        harness.token
      );
      expect(outOfRange).toMatchObject({
        status: 416,
        body: { error: 'collector_service_artifact_read_out_of_bounds' }
      });
      const invalidWindow = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}/content?offset=0&maxBytes=0`,
        harness.token
      );
      expect(invalidWindow).toMatchObject({
        status: 400,
        body: { error: 'collector_service_artifact_window_invalid' }
      });
      const metadataQuery = await readJson(
        `${harness.origin}/v2/collect/artifacts/${artifact.artifactId}?offset=0`,
        harness.token
      );
      expect(metadataQuery).toMatchObject({
        status: 400,
        body: { error: 'collector_service_artifact_metadata_query_invalid' }
      });

      const missing = await readJson(
        `${harness.origin}/v2/collect/artifacts/${randomUUID()}`,
        harness.token
      );
      expect(missing).toMatchObject({
        status: 404,
        body: { error: 'collector_service_artifact_not_found' }
      });
      const callerNamedCapability = await readJson(
        `${harness.origin}/v2/collect/artifacts/bilibili.discussion/${artifact.artifactId}`,
        harness.token
      );
      expect(callerNamedCapability.status).toBe(404);

      const auditText = JSON.stringify(harness.context.collectorServiceAudit.list());
      expect(auditText).toContain(artifact.artifactId);
      expect(auditText).toContain('bilibili.discussion');
      expect(auditText).not.toContain('公开评论与中文边界');
      expect(auditText).not.toContain('canonicalVideoUrl');
      expect(auditText).not.toContain('bilibili.com');
    } finally {
      await harness.close();
    }
  });
});

async function readJson(
  url: string,
  token?: string
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
