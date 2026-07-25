import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CollectorServiceClientRegistry,
  collectorServiceClientCreateInput
} from '../src/collector-service-clients.js';

describe('Collector service client registry', () => {
  test('issues a one-time token while persisting only a revocable hash record', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-clients-'));
    try {
      const registry = await CollectorServiceClientRegistry.create(stateDirectory);
      const issued = await registry.issue(
        collectorServiceClientCreateInput({ label: '  Local analysis app  ' }),
        new Date('2026-07-25T00:00:00.000Z')
      );
      expect(issued.token).toMatch(/^cst_[A-Za-z0-9_-]{43}$/);
      expect(issued.client).toMatchObject({
        label: 'Local analysis app',
        lastUsedAt: null,
        revokedAt: null
      });
      expect(issued.client).not.toHaveProperty('token');
      expect(issued.client).not.toHaveProperty('tokenSha256');

      const persisted = await readFile(join(stateDirectory, 'collector-service-clients.json'), 'utf8');
      expect(persisted).not.toContain(issued.token);
      expect(persisted).not.toContain('cst_');

      const authorised = await registry.authorise(`Bearer ${issued.token}`, new Date('2026-07-25T00:01:00.000Z'));
      expect(authorised).toEqual({ clientId: issued.client.clientId, label: 'Local analysis app' });
      expect(registry.list()).toEqual([expect.objectContaining({
        clientId: issued.client.clientId,
        lastUsedAt: '2026-07-25T00:01:00.000Z',
        revokedAt: null
      })]);

      const reloaded = await CollectorServiceClientRegistry.create(stateDirectory);
      expect(reloaded.list()).toEqual([expect.objectContaining({
        clientId: issued.client.clientId,
        lastUsedAt: '2026-07-25T00:01:00.000Z'
      })]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('rejects malformed tokens and makes revocation immediately effective', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-clients-'));
    try {
      const registry = await CollectorServiceClientRegistry.create(stateDirectory);
      const issued = await registry.issue(
        collectorServiceClientCreateInput({ label: 'CLI consumer' }),
        new Date('2026-07-25T00:00:00.000Z')
      );
      await expect(registry.authorise(undefined)).rejects.toThrow('collector_service_client_authorization_rejected');
      await expect(registry.authorise('Bearer not-a-service-token')).rejects.toThrow('collector_service_client_authorization_rejected');

      const revoked = await registry.revoke(issued.client.clientId, new Date('2026-07-25T00:02:00.000Z'));
      expect(revoked.revokedAt).toBe('2026-07-25T00:02:00.000Z');
      await expect(registry.authorise(`Bearer ${issued.token}`)).rejects.toThrow('collector_service_client_authorization_rejected');
      await expect(registry.revoke('not-a-client-id')).rejects.toThrow('collector_service_client_not_found');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('validates the administrative creation envelope without accepting control characters or extra fields', () => {
    expect(collectorServiceClientCreateInput({ label: 'Desktop companion' }))
      .toEqual({ label: 'Desktop companion' });
    expect(() => collectorServiceClientCreateInput({ label: '' }))
      .toThrow('collector_service_client_input_invalid');
    expect(() => collectorServiceClientCreateInput({ label: 'safe', scopes: ['all'] }))
      .toThrow('collector_service_client_input_invalid');
    expect(() => collectorServiceClientCreateInput({ label: 'bad\u0000label' }))
      .toThrow('collector_service_client_input_invalid');
  });
});
