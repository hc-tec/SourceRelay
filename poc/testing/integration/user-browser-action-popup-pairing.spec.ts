import { expect, test } from '@playwright/test';
import type { CDPSession } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProductionExtension } from '../../collector-extension/scripts/extension-test-harness.mjs';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(pocRoot, 'collector-extension', 'dist');

test('the real Chrome action popup persists pairing input after popup destruction', async () => {
  test.skip(process.platform !== 'win32', 'headed action-popup lifecycle is validated on the Windows runner');
  test.setTimeout(60_000);

  const values = {
    loopbackOrigin: 'http://127.0.0.1:43127',
    identityFingerprint: 'a'.repeat(64),
    pairingSessionId: '11111111-1111-4111-8111-111111111111',
    pairingCode: '12345678'
  } as const;
  const launched = await launchProductionExtension(extensionPath, 'collector-action-popup-', { forceHeaded: true });
  try {
    const hostPage = launched.context.pages()[0];
    if (!hostPage) throw new Error('action_popup_host_page_missing');
    const browserCdp = await launched.context.newCDPSession(hostPage);

    await launched.worker.evaluate(async () => {
      await chrome.action.openPopup();
    });
    const firstPopup = await attachPopup(browserCdp);
    await expect.poll(async () => await evaluatePopup(browserCdp, firstPopup.sessionId, 'document.documentElement.dataset.collectorControlReady'))
      .toBe('true');
    for (const [name, value] of Object.entries(values)) {
      await fillPopupInput(browserCdp, firstPopup.sessionId, `input[name="${name}"]`, value);
    }

    // This is the real MV3 action target, not a copied control-page fixture.
    // Closing its target models the same document destruction caused by focus
    // leaving the Chrome action bubble.
    await browserCdp.send('Target.closeTarget', { targetId: firstPopup.targetId });
    await expect.poll(async () => await popupTarget(browserCdp)).toBeNull();
    await expect.poll(async () => await launched.worker.evaluate(async () => (
      await chrome.storage.local.get('collector.user-browser.gateway-pairing-draft.v1')
    )['collector.user-browser.gateway-pairing-draft.v1'])).toMatchObject({
      schemaVersion: 1,
      ...values
    });

    await launched.worker.evaluate(async () => {
      await chrome.action.openPopup();
    });
    const reopenedPopup = await attachPopup(browserCdp);
    for (const [name, value] of Object.entries(values)) {
      await expect.poll(async () => await evaluatePopup(
        browserCdp,
        reopenedPopup.sessionId,
        `document.querySelector('input[name="${name}"]').value`
      )).toBe(value);
    }
    await browserCdp.send('Target.closeTarget', { targetId: reopenedPopup.targetId });
  } finally {
    await launched.close();
  }
});

interface PopupTarget {
  targetId: string;
  sessionId: string;
}

async function popupTarget(browserCdp: CDPSession): Promise<string | null> {
  const targets = (await browserCdp.send('Target.getTargets')).targetInfos as Array<{
    targetId: string;
    type: string;
    url: string;
  }>;
  return targets.find((target) => target.type === 'page' && target.url.endsWith('/control.html'))?.targetId ?? null;
}

async function attachPopup(browserCdp: CDPSession): Promise<PopupTarget> {
  await expect.poll(async () => await popupTarget(browserCdp)).not.toBeNull();
  const targets = (await browserCdp.send('Target.getTargets')).targetInfos as Array<{
    targetId: string;
    type: string;
    url: string;
  }>;
  const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.endsWith('/control.html'));
  if (!target) throw new Error('action_popup_target_missing');
  const attached = await browserCdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false
  });
  return { targetId: target.targetId, sessionId: attached.sessionId };
}

async function evaluatePopup(browserCdp: CDPSession, sessionId: string, expression: string): Promise<unknown> {
  const result = await sendToPopup(browserCdp, sessionId, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });
  return (result as { result?: { value?: unknown } } | undefined)?.result?.value;
}

async function fillPopupInput(browserCdp: CDPSession, sessionId: string, selector: string, value: string): Promise<void> {
  const found = await evaluatePopup(
    browserCdp,
    sessionId,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`
  );
  if (found !== true) throw new Error('action_popup_input_missing');
  await evaluatePopup(browserCdp, sessionId, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  await sendToPopup(browserCdp, sessionId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17
  });
  await sendToPopup(browserCdp, sessionId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  await sendToPopup(browserCdp, sessionId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  await sendToPopup(browserCdp, sessionId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17
  });
  await sendToPopup(browserCdp, sessionId, 'Input.insertText', { text: value });
}

async function sendToPopup(
  browserCdp: CDPSession,
  sessionId: string,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const messageId = nextPopupMessageId();
  const response = new Promise<unknown>((resolveResponse, rejectResponse) => {
    let timeout: ReturnType<typeof setTimeout>;
    const listener = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message) as { id?: number; result?: unknown; error?: unknown };
      if (message.id !== messageId) return;
      clearTimeout(timeout);
      browserCdp.off('Target.receivedMessageFromTarget', listener);
      if (message.error) rejectResponse(new Error('action_popup_cdp_error'));
      else resolveResponse(message.result);
    };
    browserCdp.on('Target.receivedMessageFromTarget', listener);
    timeout = setTimeout(() => {
      browserCdp.off('Target.receivedMessageFromTarget', listener);
      rejectResponse(new Error('action_popup_cdp_timeout'));
    }, 5_000);
  });
  await browserCdp.send('Target.sendMessageToTarget', {
    sessionId,
    message: JSON.stringify({ id: messageId, method, params })
  });
  return await response;
}

let popupMessageId = 1;
function nextPopupMessageId(): number {
  return popupMessageId++;
}
