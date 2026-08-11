import { afterEach, describe, expect, test, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: originalFetch
  });
  vi.useRealTimers();
  vi.resetModules();
});

async function loadClient() {
  (globalThis as unknown as { __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__: string })
    .__COLLECTOR_EXTENSION_BUILD_FINGERPRINT__ = 'a'.repeat(64);
  const module = await import('../src/background/user-browser-gateway-client.js');
  return module;
}

function installFetch(value: unknown) {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: vi.fn(async () => new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
  });
}

describe('loopback gateway transport timeout', () => {
  test('resolves a fast Gateway response', async () => {
    installFetch({ ok: true });
    const client = await loadClient();
    await expect(client.fetchGatewayJson('http://127.0.0.1:43127/v1/extension/work-items/next', { method: 'POST' }))
      .resolves.toEqual({ ok: true });
  });

  test('times out and aborts the underlying request instead of hanging forever', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn((_url: string, init: RequestInit & { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }))
    });
    const client = await loadClient();

    const pending = client.fetchGatewayJson('http://127.0.0.1:43127/v1/extension/work-items/next', { method: 'POST' });
    const assertion = expect(pending).rejects.toThrow('gateway_request_timeout');
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  test('maps a network rejection to gateway_unreachable', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(async () => { throw new TypeError('Failed to fetch'); })
    });
    const client = await loadClient();
    await expect(client.fetchGatewayJson('http://127.0.0.1:43127/x', {}))
      .rejects.toThrow('gateway_unreachable');
  });

  test('propagates the Gateway error code from a non-OK response', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(async () => new Response(JSON.stringify({ error: 'extension_work_binding_busy' }), {
        status: 409,
        headers: { 'content-type': 'application/json' }
      }))
    });
    const client = await loadClient();
    await expect(client.fetchGatewayJson('http://127.0.0.1:43127/x', {}))
      .rejects.toThrow('extension_work_binding_busy');
  });
});