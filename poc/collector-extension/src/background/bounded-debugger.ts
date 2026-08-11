/**
 * Bounded wrappers around the Chrome DevTools Protocol extension API.
 *
 * chrome.debugger.attach / sendCommand / detach are the only unbounded
 * platform-facing calls in the Collector runtime. When the target renderer is
 * unresponsive, mid-navigation, or wedged, these promises can stay pending
 * forever. One pending call then keeps pollInFlight true, holds the managed
 * work-tab lease, and makes the Gateway binding busy for every later probe
 * with no recovery short of a manual extension reload.
 *
 * These wrappers race every call against a fixed local timer. A timed-out
 * attach also attempts one short best-effort detach so a late-attached
 * session is not leaked onto the managed tab. Executors therefore always
 * terminate, release their lease, and deliver a terminal result.
 */

export const DEBUGGER_ATTACH_TIMEOUT_MS = 10_000;
export const DEBUGGER_COMMAND_TIMEOUT_MS = 6_000;
export const DEBUGGER_DETACH_TIMEOUT_MS = 5_000;
export const DEBUGGER_CLEANUP_TIMEOUT_MS = 2_000;

export async function attachDebuggerBounded(
  debuggee: chrome.debugger.Debuggee,
  version: string,
  timeoutMs: number = DEBUGGER_ATTACH_TIMEOUT_MS
): Promise<void> {
  try {
    await withTimeout(chrome.debugger.attach(debuggee, version), timeoutMs, 'debugger_attach_timeout');
  } catch (error) {
    await detachDebuggerBounded(debuggee, DEBUGGER_CLEANUP_TIMEOUT_MS).catch(() => undefined);
    throw error;
  }
}

export async function sendDebuggerCommandBounded(
  debuggee: chrome.debugger.Debuggee,
  method: string,
  params?: { [key: string]: unknown },
  timeoutMs: number = DEBUGGER_COMMAND_TIMEOUT_MS
): Promise<unknown> {
  return await withTimeout(
    chrome.debugger.sendCommand(debuggee, method, params),
    timeoutMs,
    'debugger_command_timeout'
  );
}

export async function detachDebuggerBounded(
  debuggee: chrome.debugger.Debuggee,
  timeoutMs: number = DEBUGGER_DETACH_TIMEOUT_MS
): Promise<void> {
  await withTimeout(chrome.debugger.detach(debuggee), timeoutMs, 'debugger_detach_timeout');
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
