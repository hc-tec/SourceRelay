import { describe, expect, test } from 'vitest';
import { withTimeout } from '../src/background/extension-work-bilibili-passive.js';

describe('Bilibili passive extension command bounds', () => {
  test('returns a settled command before its local deadline', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 50, 'command_timeout')).resolves.toBe('ready');
  });

  test('turns a command that never settles into one explicit error', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(withTimeout(never, 5, 'command_timeout')).rejects.toThrow('command_timeout');
  });

  test('rejects an unbounded timeout configuration', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 0, 'command_timeout')).rejects.toThrow(
      'extension_work_timeout_invalid'
    );
  });
});
