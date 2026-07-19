import type { TranscriptCapabilityValidationRunSnapshot } from '../shared/protocol';
import { canonicalBilibiliVideoUrl } from '../shared/bilibili-video-url';

export interface TranscriptTargetWindow {
  windowId: number;
  tabId: number;
  reused: boolean;
}

const terminalStates = new Set(['completed', 'inconclusive', 'failed']);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reusableTarget(
  runs: readonly TranscriptCapabilityValidationRunSnapshot[]
): Promise<TranscriptTargetWindow | null> {
  for (const run of runs) {
    if (!terminalStates.has(run.state)) continue;
    const tab = await chrome.tabs.get(run.tabId).catch(() => null);
    if (!tab || tab.windowId !== run.windowId) continue;
    const canonicalUrl = canonicalBilibiliVideoUrl(tab.url ?? '', 'observed_document');
    if (!canonicalUrl || await sha256(canonicalUrl) !== run.navigationUrlDigest) continue;
    await chrome.windows.update(run.windowId, { focused: true }).catch(() => undefined);
    await chrome.tabs.update(run.tabId, { active: true });
    return { windowId: run.windowId, tabId: run.tabId, reused: true };
  }
  return null;
}

export async function acquireTranscriptTargetWindow(
  runs: readonly TranscriptCapabilityValidationRunSnapshot[]
): Promise<TranscriptTargetWindow> {
  const reusable = await reusableTarget(runs);
  if (reusable) return reusable;

  const createdWindow = await chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal' });
  const tab = createdWindow?.tabs?.[0];
  if (typeof createdWindow?.id !== 'number' || typeof tab?.id !== 'number') {
    if (typeof createdWindow?.id === 'number') await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw new Error('transcript_validation_window_creation_failed');
  }
  return { windowId: createdWindow.id, tabId: tab.id, reused: false };
}
