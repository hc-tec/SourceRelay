import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  COLLECTOR_SERVICE_CLIENT_SCOPES,
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
        scopes: COLLECTOR_SERVICE_CLIENT_SCOPES,
        lastUsedAt: null,
        revokedAt: null
      });
      expect(issued.client).not.toHaveProperty('token');
      expect(issued.client).not.toHaveProperty('tokenSha256');

      const persisted = await readFile(join(stateDirectory, 'collector-service-clients.json'), 'utf8');
      expect(persisted).not.toContain(issued.token);
      expect(persisted).not.toContain('cst_');

      const authorised = await registry.authorise(
        `Bearer ${issued.token}`,
        'profiles:read',
        new Date('2026-07-25T00:01:00.000Z')
      );
      expect(authorised).toEqual({
        clientId: issued.client.clientId,
        label: 'Local analysis app',
        scopes: COLLECTOR_SERVICE_CLIENT_SCOPES
      });
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
      await expect(registry.authorise(undefined, 'profiles:read'))
        .rejects.toThrow('collector_service_client_authorization_rejected');
      await expect(registry.authorise('Bearer not-a-service-token', 'profiles:read'))
        .rejects.toThrow('collector_service_client_authorization_rejected');

      const revoked = await registry.revoke(issued.client.clientId, new Date('2026-07-25T00:02:00.000Z'));
      expect(revoked.revokedAt).toBe('2026-07-25T00:02:00.000Z');
      await expect(registry.authorise(`Bearer ${issued.token}`, 'profiles:read'))
        .rejects.toThrow('collector_service_client_authorization_rejected');
      await expect(registry.revoke('not-a-client-id')).rejects.toThrow('collector_service_client_not_found');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('validates the administrative creation envelope without accepting control characters or extra fields', () => {
    expect(collectorServiceClientCreateInput({ label: 'Desktop companion' }))
      .toEqual({ label: 'Desktop companion', scopes: COLLECTOR_SERVICE_CLIENT_SCOPES });
    expect(collectorServiceClientCreateInput({
      label: 'Artifact reader',
      scopes: ['artifacts:read', 'profiles:read']
    })).toEqual({
      label: 'Artifact reader',
      scopes: ['profiles:read', 'artifacts:read']
    });
    expect(() => collectorServiceClientCreateInput({ label: '' }))
      .toThrow('collector_service_client_input_invalid');
    expect(() => collectorServiceClientCreateInput({ label: 'safe', scopes: ['all'] }))
      .toThrow('collector_service_client_scope_invalid');
    expect(() => collectorServiceClientCreateInput({ label: 'safe', scopes: ['profiles:read', 'profiles:read'] }))
      .toThrow('collector_service_client_scope_invalid');
    expect(() => collectorServiceClientCreateInput({ label: 'bad\u0000label' }))
      .toThrow('collector_service_client_input_invalid');
  });

  test('enforces an explicitly narrow scope without updating last-used time on denial', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-clients-'));
    try {
      const registry = await CollectorServiceClientRegistry.create(stateDirectory);
      const issued = await registry.issue(
        collectorServiceClientCreateInput({ label: 'Artifact-only app', scopes: ['artifacts:read'] }),
        new Date('2026-07-25T00:00:00.000Z')
      );

      await expect(registry.authorise(`Bearer ${issued.token}`, 'profiles:read'))
        .rejects.toThrow('collector_service_client_scope_denied');
      await expect(registry.authorise(`Bearer ${issued.token}`, 'collect:execute'))
        .rejects.toThrow('collector_service_client_scope_denied');
      expect(registry.list()).toEqual([expect.objectContaining({ lastUsedAt: null })]);

      const authorised = await registry.authorise(
        `Bearer ${issued.token}`,
        'artifacts:read',
        new Date('2026-07-25T00:03:00.000Z')
      );
      expect(authorised).toEqual({
        clientId: issued.client.clientId,
        label: 'Artifact-only app',
        scopes: ['artifacts:read']
      });
      expect(registry.list()).toEqual([expect.objectContaining({
        scopes: ['artifacts:read'],
        lastUsedAt: '2026-07-25T00:03:00.000Z'
      })]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('migrates valid schema-v1 clients to full explicit scope and ignores malformed schema-v2 scope records', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-service-clients-'));
    const registryPath = join(stateDirectory, 'collector-service-clients.json');
    try {
      await writeFile(registryPath, JSON.stringify([
        {
          schemaVersion: 1,
          clientId: '11111111-1111-4111-8111-111111111111',
          label: 'Legacy complete access',
          tokenSha256: 'a'.repeat(64),
          createdAt: '2026-07-25T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null
        },
        {
          schemaVersion: 2,
          clientId: '22222222-2222-4222-8222-222222222222',
          label: 'Invalid edited scope',
          tokenSha256: 'b'.repeat(64),
          scopes: ['profiles:read', 'not-a-scope'],
          createdAt: '2026-07-25T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null
        }
      ]), 'utf8');

      const registry = await CollectorServiceClientRegistry.create(stateDirectory);
      expect(registry.list()).toEqual([expect.objectContaining({
        clientId: '11111111-1111-4111-8111-111111111111',
        scopes: COLLECTOR_SERVICE_CLIENT_SCOPES
      })]);

      const migrated = JSON.parse(await readFile(registryPath, 'utf8')) as Array<Record<string, unknown>>;
      expect(migrated).toEqual([expect.objectContaining({
        schemaVersion: 2,
        scopes: COLLECTOR_SERVICE_CLIENT_SCOPES
      })]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
