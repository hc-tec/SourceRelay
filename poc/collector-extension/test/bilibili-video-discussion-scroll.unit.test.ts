import { afterEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
  vi.resetModules();
});

function installChromeMock(input: {
  probe?: Partial<{ found: boolean; inViewport: boolean; x: number; y: number; deltaY: number }>;
  fail?: 'attach' | 'input' | 'detach';
} = {}) {
  const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  const attach = vi.fn(async () => {
    if (input.fail === 'attach') throw new Error('attach failed');
  });
  const detach = vi.fn(async () => {
    if (input.fail === 'detach') throw new Error('detach failed');
  });
  const sendCommand = vi.fn(async (_debuggee: unknown, method: string, params: Record<string, unknown>) => {
    commands.push({ method, params });
    if (input.fail === 'input') throw new Error('input failed');
    return {};
  });
  const executeScript = vi.fn(async () => [{ result: {
    found: true,
    inViewport: false,
    x: 640,
    y: 576,
    deltaY: 810,
    ...input.probe
  } }]);
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      scripting: { executeScript },
      debugger: { attach, detach, sendCommand }
    } as unknown as typeof chrome
  });
  return { attach, detach, sendCommand, executeScript, commands };
}

describe('Bilibili discussion trusted scroll boundary', () => {
  test('uses one bounded foreground wheel and detaches', async () => {
    const chrome = installChromeMock();
    const strategy = await import('../src/background/strategies/bilibili-video-discussion-dom-projection.js');

    await expect(strategy.scrollBilibiliVideoDiscussionIntoView(11, 'document-1'))
      .resolves.toEqual({ found: true, inViewport: false });
    expect(chrome.attach).toHaveBeenCalledTimes(1);
    expect(chrome.detach).toHaveBeenCalledTimes(1);
    expect(chrome.commands.map(({ method }) => method)).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent'
    ]);
    expect(chrome.commands[0]?.params).toMatchObject({ type: 'mouseMoved', x: 640, y: 576 });
    expect(chrome.commands[1]?.params).toMatchObject({ type: 'mouseWheel', x: 640, y: 576, deltaX: 0, deltaY: 810 });
  });

  test('does not attach when the host is absent or already visible', async () => {
    const absent = installChromeMock({ probe: { found: false } });
    const strategy = await import('../src/background/strategies/bilibili-video-discussion-dom-projection.js');
    await expect(strategy.scrollBilibiliVideoDiscussionIntoView(11, 'document-1'))
      .resolves.toEqual({ found: false, inViewport: false });
    expect(absent.attach).not.toHaveBeenCalled();

    vi.resetModules();
    const visible = installChromeMock({ probe: { inViewport: true } });
    const visibleStrategy = await import('../src/background/strategies/bilibili-video-discussion-dom-projection.js');
    await expect(visibleStrategy.scrollBilibiliVideoDiscussionIntoView(11, 'document-1'))
      .resolves.toEqual({ found: true, inViewport: true });
    expect(visible.attach).not.toHaveBeenCalled();
  });

  test('maps input failure and still detaches once', async () => {
    const chrome = installChromeMock({ fail: 'input' });
    const strategy = await import('../src/background/strategies/bilibili-video-discussion-dom-projection.js');
    await expect(strategy.scrollBilibiliVideoDiscussionIntoView(11, 'document-1'))
      .rejects.toThrow('bilibili_video_discussion_scroll_debugger_input_failed');
    expect(chrome.detach).toHaveBeenCalledTimes(1);
  });

  test('does not claim success when detach fails', async () => {
    const chrome = installChromeMock({ fail: 'detach' });
    const strategy = await import('../src/background/strategies/bilibili-video-discussion-dom-projection.js');
    await expect(strategy.scrollBilibiliVideoDiscussionIntoView(11, 'document-1'))
      .rejects.toThrow('bilibili_video_discussion_scroll_debugger_detach_failed');
    expect(chrome.detach).toHaveBeenCalledTimes(1);
  });
});
