import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BrowserProfileRegistry, createBrowserProfileInput } from '../src/profiles.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directories(): Promise<{ state: string; profiles: string }> {
  const root = await mkdtemp(join(tmpdir(), 'collector-profiles-unit-'));
  temporaryDirectories.push(root);
  return { state: join(root, 'state'), profiles: join(root, 'profiles') };
}

describe('Browser profile domain boundaries', () => {
  test('normalises allowed profile input and rejects collection access without a managed account', () => {
    expect(createBrowserProfileInput({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: '  Research   account  ',
      expectedVisibleIdentity: '  Display Name '
    })).toEqual({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'Research account',
      expectedVisibleIdentity: 'Display Name'
    });
    expect(() => createBrowserProfileInput({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'anonymous',
      accountLabel: 'not allowed'
    })).toThrow('profile_collection_requires_user_managed_account');
    expect(() => createBrowserProfileInput({
      kind: 'validation',
      platform: 'bilibili',
      accountCategory: 'anonymous',
      accountLabel: 'valid',
      unknown: true
    })).toThrow('profile_input_invalid');
  });

  test('persists a collection binding, prevents duplicate identity bindings, and preserves launch metadata', async () => {
    const { state, profiles } = await directories();
    const registry = await BrowserProfileRegistry.create(profiles, state);
    const collection = await registry.createProfile(createBrowserProfileInput({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'Primary collection profile'
    }), new Date('2026-07-22T00:00:00.000Z'));
    await expect(registry.createProfile(createBrowserProfileInput({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'primary COLLECTION profile'
    }))).rejects.toThrow('profile_binding_already_exists');

    expect(registry.collectionBindings(['bilibili'], { bilibili: collection.profileId })).toEqual({
      bilibili: {
        profileId: collection.profileId,
        kind: 'collection',
        platform: 'bilibili',
        account: { category: 'user_managed', label: 'Primary collection profile' }
      }
    });
    await registry.markLaunched(collection.profileId, '0.7.7', new Date('2026-07-22T00:01:00.000Z'));

    const restarted = await BrowserProfileRegistry.create(profiles, state);
    expect(restarted.get(collection.profileId)).toMatchObject({
      profileId: collection.profileId,
      lastExtensionVersion: '0.7.7',
      lastLaunchedAt: '2026-07-22T00:01:00.000Z'
    });
    expect(restarted.userDataDirectory(collection.profileId)).toContain(collection.profileId);
  });

  test('does not let a validation profile satisfy a collection task binding', async () => {
    const { state, profiles } = await directories();
    const registry = await BrowserProfileRegistry.create(profiles, state);
    const validation = await registry.createProfile(createBrowserProfileInput({
      kind: 'validation',
      platform: 'bilibili',
      accountCategory: 'anonymous',
      accountLabel: 'isolated validation profile'
    }));

    expect(() => registry.collectionBindings(['bilibili'], { bilibili: validation.profileId })).toThrow(
      'task_profile_kind_invalid'
    );
  });
});
