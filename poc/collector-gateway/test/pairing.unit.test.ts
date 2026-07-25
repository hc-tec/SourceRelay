import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { PairingBroker } from '../src/pairing.js';

const EXTENSION_ID = 'a'.repeat(32);
const EXTENSION_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const BASE_TIME = new Date('2026-07-25T00:00:00.000Z').getTime();

function identity(): LoadedGatewayIdentity {
  return {
    publicIdentity: {
      schemaVersion: 1,
      protocolVersion: 1,
      gatewayInstanceId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Local Collector Gateway',
      loopbackOrigin: 'http://127.0.0.1:43127',
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      identityFingerprint: 'c'.repeat(64)
    },
    signPayload: () => 'd'.repeat(86)
  } as LoadedGatewayIdentity;
}

async function temporaryState(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'collector-browser-bindings-'));
}

function authorisation(input: { authorization: string; nonce: string; timestamp: string }) {
  const bodySha256 = createHash('sha256').update('').digest('hex');
  const payload = ['GET', '/v1/extension/browser-binding', input.timestamp, input.nonce, bodySha256].join('\n');
  return {
    origin: `chrome-extension://${EXTENSION_ID}`,
    extensionId: EXTENSION_ID,
    extensionInstanceId: EXTENSION_INSTANCE_ID,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256,
    authorization: createHmac('sha256', input.authorization).update(payload).digest('base64url'),
    method: 'GET',
    pathname: '/v1/extension/browser-binding',
    body: ''
  } as const;
}

describe('user-owned browser binding pairing', () => {
  test('pairs an installed extension without persisting or exposing browser-profile data', async () => {
    const stateDirectory = await temporaryState();
    try {
      const broker = await PairingBroker.create(identity(), stateDirectory);
      const session = broker.createSession(BASE_TIME);
      const claim = await broker.claim({
        schemaVersion: 1,
        pairingSessionId: session.pairingSessionId,
        pairingCode: session.pairingCode,
        extensionId: EXTENSION_ID,
        extensionInstanceId: EXTENSION_INSTANCE_ID,
        extensionChallenge: 'e'.repeat(43)
      }, BASE_TIME + 1);

      expect(claim.browserBindingId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(claim.challenge.gateway.loopbackOrigin).toBe('http://127.0.0.1:43127');
      expect(broker.listBrowserBindings(BASE_TIME + 2)).toEqual([{
        schemaVersion: 1,
        browserBindingId: claim.browserBindingId,
        extensionId: EXTENSION_ID,
        state: 'paired',
        pairedAt: '2026-07-25T00:00:00.001Z',
        lastSeenAt: null
      }]);

      const persisted = await readFile(join(stateDirectory, 'extension-pairings.json'), 'utf8');
      expect(persisted).toContain(claim.browserBindingId);
      expect(persisted).not.toMatch(/profile|cookie|token|password/i);
      expect(JSON.stringify(broker.listBrowserBindings())).not.toContain(claim.pairingAuthorization);
      expect(JSON.stringify(broker.listBrowserBindings())).not.toContain(EXTENSION_INSTANCE_ID);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('authenticates a binding once, rejects replay, and exposes only an online summary', async () => {
    const stateDirectory = await temporaryState();
    try {
      const broker = await PairingBroker.create(identity(), stateDirectory);
      const session = broker.createSession(BASE_TIME);
      const claim = await broker.claim({
        schemaVersion: 1,
        pairingSessionId: session.pairingSessionId,
        pairingCode: session.pairingCode,
        extensionId: EXTENSION_ID,
        extensionInstanceId: EXTENSION_INSTANCE_ID,
        extensionChallenge: 'f'.repeat(43)
      }, BASE_TIME + 1);
      const request = authorisation({
        authorization: claim.pairingAuthorization,
        nonce: 'g'.repeat(43),
        timestamp: String(BASE_TIME + 2)
      });

      await expect(broker.authoriseRequest(request, BASE_TIME + 2)).resolves.toMatchObject({
        browserBindingId: claim.browserBindingId,
        extensionId: EXTENSION_ID,
        extensionInstanceId: EXTENSION_INSTANCE_ID
      });
      await expect(broker.authoriseRequest(request, BASE_TIME + 3)).rejects.toThrow('pairing_nonce_replayed');
      expect(broker.getBrowserBinding(claim.browserBindingId, BASE_TIME + 3)).toEqual(expect.objectContaining({
        browserBindingId: claim.browserBindingId,
        state: 'online',
        lastSeenAt: '2026-07-25T00:00:00.002Z'
      }));
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('migrates old pairing state into a new browser binding without retaining a Profile field', async () => {
    const stateDirectory = await temporaryState();
    try {
      await writeFile(join(stateDirectory, 'extension-pairings.json'), JSON.stringify([{
        schemaVersion: 1,
        extensionId: EXTENSION_ID,
        extensionInstanceId: EXTENSION_INSTANCE_ID,
        pairingAuthorization: 'h'.repeat(43),
        pairedAt: '2026-07-24T00:00:00.000Z'
      }]), 'utf8');
      const broker = await PairingBroker.create(identity(), stateDirectory);
      const bindings = broker.listBrowserBindings(BASE_TIME);
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toMatchObject({ schemaVersion: 1, extensionId: EXTENSION_ID, state: 'paired' });

      const persisted = await readFile(join(stateDirectory, 'extension-pairings.json'), 'utf8');
      expect(persisted).toContain('"schemaVersion": 2');
      expect(persisted).toContain('browserBindingId');
      expect(persisted).not.toContain('profileId');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
