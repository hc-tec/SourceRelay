import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CollectorServiceAuditLog,
  collectorServiceProfileIdDigest
} from '../src/collector-service-audit.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

describe('Collector service audit log', () => {
  test('persists only the narrow de-identified call envelope and survives reload', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-audit-'));
    const token = 'cst_this_must_never_be_persisted_or_logged_123456';
    const query = '不得写入审计的搜索词';
    const canonicalUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa?private=never-store';
    try {
      const audit = await CollectorServiceAuditLog.create(stateDirectory);
      const event = await audit.record({
        actor: { kind: 'client', clientId: '44444444-4444-4444-8444-444444444444' },
        action: 'collect',
        capability: 'bilibili.video_detail',
        profileIdDigest: collectorServiceProfileIdDigest(PROFILE_ID),
        artifactId: ARTIFACT_ID,
        operationId: OPERATION_ID,
        operationKind: 'run',
        outcome: 'completed',
        errorCode: null
      }, new Date('2026-07-25T01:00:00.000Z'));

      expect(event).toMatchObject({
        schemaVersion: 1,
        actor: { kind: 'client', clientId: '44444444-4444-4444-8444-444444444444' },
        profileIdDigest: collectorServiceProfileIdDigest(PROFILE_ID),
        artifactId: ARTIFACT_ID,
        operationId: OPERATION_ID,
        operationKind: 'run',
        outcome: 'completed'
      });
      expect(event).not.toHaveProperty('input');
      expect(event).not.toHaveProperty('token');
      expect(event).not.toHaveProperty('profileId');

      const persisted = await readFile(join(stateDirectory, 'collector-service-audit.json'), 'utf8');
      expect(persisted).not.toContain(PROFILE_ID);
      expect(persisted).not.toContain(token);
      expect(persisted).not.toContain(query);
      expect(persisted).not.toContain(canonicalUrl);
      expect(persisted).not.toContain('authorization');
      expect(persisted).not.toContain('cookie');

      const reloaded = await CollectorServiceAuditLog.create(stateDirectory);
      expect(reloaded.list()).toEqual([event]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('rejects invalid call envelopes and ignores malformed persisted records without blocking startup', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-audit-'));
    try {
      await writeFile(join(stateDirectory, 'collector-service-audit.json'), JSON.stringify([
        { schemaVersion: 1, auditId: 'not-a-uuid', rawInput: 'must not be accepted' }
      ]), 'utf8');
      const audit = await CollectorServiceAuditLog.create(stateDirectory);
      expect(audit.list()).toEqual([]);
      await expect(audit.record({
        actor: { kind: 'console', clientId: null },
        action: 'profiles_read',
        capability: null,
        profileIdDigest: 'not-a-digest',
        artifactId: null,
        operationId: null,
        operationKind: null,
        outcome: 'completed',
        errorCode: null
      })).rejects.toThrow('collector_service_audit_input_invalid');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
