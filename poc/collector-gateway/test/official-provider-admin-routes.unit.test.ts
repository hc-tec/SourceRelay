import { describe, expect, test } from 'vitest';
import { createUserBrowserServiceRouteHarness } from './support/user-browser-service-route-harness.js';

const CONSOLE_HEADERS = {
  origin: 'http://127.0.0.1:43127',
  'sec-fetch-site': 'same-origin'
};

describe('Official Provider Console configuration', () => {
  test('reports, configures and clears the Gateway-only Zhihu credential', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const initial = await getJson(harness.origin, '/v2/official-providers');
      expect(initial.status).toBe(200);
      expect(initial.body).toMatchObject({
        providers: [{
          provider: 'zhihu_open_platform',
          runtimeState: 'credential_required',
          configurationMode: 'none',
          credentialLocation: 'gateway_only'
        }]
      });

      const configured = await fetch(`${harness.origin}/v2/official-providers/zhihu/credential`, {
        method: 'POST',
        headers: { ...CONSOLE_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ accessSecret: 'console-route-secret-123456' })
      });
      expect(configured.status).toBe(200);
      const configuredBody = await configured.json() as Record<string, any>;
      expect(configuredBody).toMatchObject({
        provider: {
          provider: 'zhihu_open_platform',
          runtimeState: 'ready',
          configurationMode: 'console_session',
          credentialLocation: 'gateway_only'
        }
      });
      expect(JSON.stringify(configuredBody)).not.toContain('console-route-secret-123456');
      expect(JSON.stringify(harness.context.operationalLog.list()))
        .not.toContain('console-route-secret-123456');

      const capabilities = await getJson(harness.origin, '/v2/capabilities');
      expect(capabilities.body.capabilities.filter((item: any) =>
        item.executionProvider === 'zhihu_open_platform'
      )).toHaveLength(3);
      expect(capabilities.body.capabilities
        .filter((item: any) => item.executionProvider === 'zhihu_open_platform')
        .every((item: any) => item.runtimeState === 'ready')).toBe(true);

      const cleared = await fetch(`${harness.origin}/v2/official-providers/zhihu/credential/clear`, {
        method: 'POST',
        headers: { ...CONSOLE_HEADERS, 'content-type': 'application/json' },
        body: '{}'
      });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        provider: { runtimeState: 'credential_required', configurationMode: 'none' }
      });
    } finally {
      await harness.close();
    }
  });

  test('rejects cross-origin Console credential writes before reading the secret', async () => {
    const harness = await createUserBrowserServiceRouteHarness();
    try {
      const response = await fetch(`${harness.origin}/v2/official-providers/zhihu/credential`, {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ accessSecret: 'cross-origin-secret-123456' })
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'console_origin_rejected' });
      expect(harness.context.zhihuOfficialApiProvider.configured()).toBe(false);
    } finally {
      await harness.close();
    }
  });
});

async function getJson(origin: string, pathname: string): Promise<{ status: number; body: any }> {
  const response = await fetch(origin + pathname, { headers: CONSOLE_HEADERS });
  return { status: response.status, body: await response.json() };
}
