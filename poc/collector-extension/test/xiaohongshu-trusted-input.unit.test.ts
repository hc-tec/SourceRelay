import { afterEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
  vi.useRealTimers();
  vi.resetModules();
});

function validAction(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    actionId: 'action-1',
    workId: 'work-1',
    runId: 'run-1',
    browserBindingId: 'binding-1',
    query: '咖',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides
  };
}

function installChromeMock(input: {
  tabs?: Array<Record<string, unknown>>;
  persisted?: Record<string, unknown> | Array<Record<string, unknown>>;
  risk?: 'verification' | 'rate_limit' | 'login' | 'source';
  failCommand?: string;
} = {}) {
  const storage = new Map<string, unknown>();
  if (input.persisted) storage.set(
    'collector.xiaohongshu.trusted-input-action.v1',
    Array.isArray(input.persisted) ? input.persisted : [input.persisted]
  );
  const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  const tabs = input.tabs ?? [{
    id: 11,
    windowId: 22,
    incognito: false,
    active: false,
    status: 'complete',
    url: 'https://www.xiaohongshu.com/explore'
  }];
  const query = vi.fn(async () => tabs);
  const update = vi.fn(async () => ({ ...tabs[0], active: true }));
  const get = vi.fn(async () => ({ ...tabs[0], active: true }));
  const getFrame = vi.fn(async () => ({
    documentId: 'document-1',
    frameId: 0,
    parentFrameId: -1,
    url: 'https://www.xiaohongshu.com/explore'
  }));
  const executeScript = vi.fn(async (details: { func: (...args: never[]) => unknown }) => {
    const source = String(details.func);
    if (source.includes('renderedCardCount')) {
      return [{ result: {
        publicSurface: 'search',
        queryEchoed: true,
        renderedCardCount: 19,
        pathname: input.risk === 'verification' ? '/website-login/captcha' : '/search_result_ai',
        title: input.risk === 'verification' ? '安全验证' : '人工智能 - 小红书搜索',
        visibleText: input.risk === 'login' ? '请登录后继续' :
          input.risk === 'verification' ? '请完成安全验证' :
            input.risk === 'rate_limit' ? '请求过于频繁，请稍后再试' :
              input.risk === 'source' ? '页面不存在' :
                '人工智能在金融风控、风险识别和客户服务中的应用'
      } }];
    }
    if (source.includes('text.trim() === expected') || source.includes('input.value === expected')) {
      return [{ result: true }];
    }
    return [{ result: { x: 100, y: 50, width: 240, height: 36 } }];
  });
  const attach = vi.fn(async () => undefined);
  const detach = vi.fn(async () => undefined);
  const sendCommand = vi.fn(async (_target: unknown, method: string, params: Record<string, unknown>) => {
    commands.push({ method, params });
    if (input.failCommand === method) throw new Error('debugger_command_failed');
    return {};
  });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: { query, update, get },
      webNavigation: { getFrame },
      scripting: { executeScript },
      debugger: { attach, detach, sendCommand },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, structuredClone(value));
          })
        }
      }
    } as unknown as typeof chrome
  });
  return { storage, commands, query, update, get, getFrame, executeScript, attach, detach, sendCommand };
}

describe('Xiaohongshu extension trusted input boundary', () => {
  test('accepts only the fixed query action and rejects URL, selector, tab and CDP carriers', async () => {
    const chrome = installChromeMock();
    const module = await import('../src/background/xiaohongshu-trusted-input.js');
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/search_result?keyword=x' },
      { selector: 'input' },
      { tabId: 11 },
      { coordinate: { x: 1, y: 2 } },
      { script: 'document.body.innerHTML' },
      { debuggerCommand: 'Runtime.evaluate' }
    ]) {
      await expect(module.executeXiaohongshuTrustedInputSearch({ ...validAction(), ...extra }))
        .rejects.toThrow('xiaohongshu_trusted_input_action_invalid');
    }
    expect(chrome.query).not.toHaveBeenCalled();
    expect(chrome.attach).not.toHaveBeenCalled();
  });

  test('uses one existing Explore document, enters once and always detaches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const chrome = installChromeMock();
    const module = await import('../src/background/xiaohongshu-trusted-input.js');
    const result = await module.executeXiaohongshuTrustedInputSearch(validAction());

    expect(result).toEqual({
      schemaVersion: 1,
      actionId: 'action-1',
      state: 'completed',
      errorCode: null,
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { queryEchoed: true, enterAttempted: true },
      page: { publicSurface: 'search', renderedCardCount: 19 },
      debuggerDetached: true
    });
    expect(chrome.query).toHaveBeenCalledWith({
      url: ['https://www.xiaohongshu.com/explore', 'https://www.xiaohongshu.com/explore/']
    });
    expect(chrome.update).toHaveBeenCalledTimes(1);
    expect(chrome.attach).toHaveBeenCalledTimes(1);
    expect(chrome.detach).toHaveBeenCalledTimes(1);
    expect(chrome.commands.filter(({ method, params }) =>
      method === 'Input.dispatchKeyEvent' && params.key === 'Enter' && params.type === 'rawKeyDown'
    )).toHaveLength(1);
    expect(chrome.commands.filter(({ method }) => method === 'Input.insertText')).toHaveLength(1);
    expect(chrome.commands.every(({ method }) => [
      'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText'
    ].includes(method))).toBe(true);
    expect((globalThis.chrome.tabs as unknown as Record<string, unknown>).create).toBeUndefined();
  });

  test('will not reclaim an unexpired action after a worker interruption', async () => {
    const persisted = {
      schemaVersion: 1,
      actionId: 'action-1',
      workId: 'work-1',
      runId: 'run-1',
      browserBindingId: 'binding-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      phase: 'semantic_action_intent_recorded',
      semanticActionAttempted: true
    };
    const chrome = installChromeMock({ persisted });
    const module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction()))
      .rejects.toThrow('xiaohongshu_trusted_input_action_already_claimed');
    expect(chrome.query).not.toHaveBeenCalled();
    expect(chrome.sendCommand).not.toHaveBeenCalled();
  });

  test('will not replay a terminal action after newer actions have entered the bounded ledger', async () => {
    const base = {
      schemaVersion: 1,
      workId: 'work-1',
      runId: 'run-1',
      browserBindingId: 'binding-1',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      phase: 'terminal',
      semanticActionAttempted: true
    };
    const chrome = installChromeMock({ persisted: [
      { ...base, actionId: 'action-1' },
      { ...base, actionId: 'newer-action', workId: 'newer-work' }
    ] });
    const module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction()))
      .rejects.toThrow('xiaohongshu_trusted_input_action_already_claimed');
    expect(chrome.query).not.toHaveBeenCalled();
    expect(chrome.sendCommand).not.toHaveBeenCalled();
  });

  test('does not attach when the existing Explore document is absent or ambiguous', async () => {
    const absent = installChromeMock({ tabs: [] });
    let module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction())).resolves.toMatchObject({
      state: 'stopped', errorCode: 'xiaohongshu_trusted_input_explore_tab_required',
      semanticAction: { attempted: false, attemptCount: 0 }
    });
    expect(absent.attach).not.toHaveBeenCalled();

    vi.resetModules();
    const ambiguous = installChromeMock({ tabs: [
      { id: 11, windowId: 22, incognito: false, status: 'complete', url: 'https://www.xiaohongshu.com/explore' },
      { id: 12, windowId: 22, incognito: false, status: 'complete', url: 'https://www.xiaohongshu.com/explore/' }
    ] });
    module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction({ actionId: 'action-2' })))
      .resolves.toMatchObject({ state: 'stopped', errorCode: 'xiaohongshu_trusted_input_explore_tab_ambiguous' });
    expect(ambiguous.attach).not.toHaveBeenCalled();
  });

  test('stops after one attempted action on risk or command failure and detaches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const risk = installChromeMock({ risk: 'verification' });
    let module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction())).resolves.toMatchObject({
      state: 'stopped', errorCode: 'xiaohongshu_verification_required',
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { enterAttempted: true }
    });
    expect(risk.detach).toHaveBeenCalledTimes(1);
    expect(risk.commands.filter(({ method, params }) =>
      method === 'Input.dispatchKeyEvent' && params.key === 'Enter' && params.type === 'rawKeyDown'
    )).toHaveLength(1);

    vi.resetModules();
    const failure = installChromeMock({ failCommand: 'Input.insertText' });
    module = await import('../src/background/xiaohongshu-trusted-input.js');
    await expect(module.executeXiaohongshuTrustedInputSearch(validAction({ actionId: 'action-2' })))
      .resolves.toMatchObject({
        state: 'stopped', errorCode: 'debugger_input_failed',
        semanticAction: { attempted: true, attemptCount: 1 },
        input: { enterAttempted: false }
      });
    expect(failure.detach).toHaveBeenCalledTimes(1);
  });
});
