import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { assertUserBrowserStateIsolation } from '../src/user-browser-config.js';

describe('user-owned browser Gateway state isolation', () => {
  test('accepts a fresh direct state root and rejects isolated-runtime markers', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'collector-user-browser-state-'));
    try {
      await expect(assertUserBrowserStateIsolation(root)).resolves.toBeUndefined();
      for (const marker of ['profiles', 'browser-host']) {
        await mkdir(resolve(root, marker), { recursive: true });
        await expect(assertUserBrowserStateIsolation(root))
          .rejects.toThrow('user_browser_state_contains_legacy_runtime');
        await rm(resolve(root, marker), { recursive: true, force: true });
      }
      await writeFile(resolve(root, 'browser-profiles.json'), '{}\n', 'utf8');
      await expect(assertUserBrowserStateIsolation(root))
        .rejects.toThrow('user_browser_state_contains_legacy_runtime');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
