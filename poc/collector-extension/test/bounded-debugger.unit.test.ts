import { afterEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: originalChrome
  });
  vi.useRealTimers();
  vi.resetModules();
});

function installDebuggerMock() {
  const attach = vi.fn();
  const sendCommand = vi.fn();
  const detach = vi.fn();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      debugger: { attach, sendCommand, detach }
    }
  });
  return { attach, sendCommand, detach };
}

function never(): Promise<never> {
  return new Promise(() => undefined);
}

describe('bounded debugger wrappers', () => {
  test('attach resolves normally when the API responds quickly', async () => {
    const { attach } = installDebuggerMock();
    attach.mockResolvedValue(undefined);
    const debuggerModule = await import('../src/background/bounded-debugger.js');
    await expect(debuggerModule.attachDebuggerBounded({ tabId: 7 }, '1.3')).resolves.toBeUndefined();
  });

  test('attach times out instead of hanging and does not leak the session', async () => {
    vi.useFakeTimers();
    const { attach, detach } = installDebuggerMock();
    attach.mockReturnValue(never());
    detach.mockResolvedValue(undefined);
    const debuggerModule = await import('../src/background/bounded-debugger.js');

    const pending = debuggerModule.attachDebuggerBounded({ tabId: 7 }, '1.3');
    const assertion = expect(pending).rejects.toThrow('debugger_attach_timeout');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  test('sendCommand times out instead of hanging', async () => {
    vi.useFakeTimers();
    const { sendCommand } = installDebuggerMock();
    sendCommand.mockReturnValue(never());
    const debuggerModule = await import('../src/background/bounded-debugger.js');

    const pending = debuggerModule.sendDebuggerCommandBounded(
      { tabId: 7 },
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: 1, y: 2 }
    );
    const assertion = expect(pending).rejects.toThrow('debugger_command_timeout');
    await vi.advanceTimersByTimeAsync(6_000);
    await assertion;
  });

  test('detach times out instead of hanging', async () => {
    vi.useFakeTimers();
    const { detach } = installDebuggerMock();
    detach.mockReturnValue(never());
    const debuggerModule = await import('../src/background/bounded-debugger.js');

    const pending = debuggerModule.detachDebuggerBounded({ tabId: 7 });
    const assertion = expect(pending).rejects.toThrow('debugger_detach_timeout');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  test('a fast rejection is forwarded unchanged (no false timeout)', async () => {
    const { attach } = installDebuggerMock();
    attach.mockRejectedValue(new Error('debugger_attach_failed'));
    const debuggerModule = await import('../src/background/bounded-debugger.js');
    await expect(debuggerModule.attachDebuggerBounded({ tabId: 7 }, '1.3'))
      .rejects.toThrow('debugger_attach_failed');
  });
});