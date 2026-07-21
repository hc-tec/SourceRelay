import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  collectorValidationCatalog,
  validateCatalog,
  type ValidationCatalogEntry
} from './catalog.js';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(pocRoot, '..');

describe('Collector validation catalog', () => {
  test('declares a truthful boundary between local validation and live Canaries', () => {
    expect(validateCatalog()).toEqual([]);

    for (const entry of collectorValidationCatalog) {
      if (entry.tier === 'live_canary') {
        expect(entry.command).toBeNull();
        expect(entry.ci).toBe('never');
        expect(entry.platformPolicy).toBe('managed_profile_low_frequency');
      } else {
        expect(entry.command).not.toBeNull();
        expect(entry.platformPolicy).toBe('forbidden');
      }
    }
  });

  test('rejects duplicate validation IDs and a Canary accidentally made runnable in CI', () => {
    const liveCanary = collectorValidationCatalog.find((entry) => entry.tier === 'live_canary');
    expect(liveCanary).toBeDefined();
    const unsafe = {
      ...liveCanary!,
      command: 'npm run unsafe-live-canary',
      ci: 'pull_request' as const
    } satisfies ValidationCatalogEntry;

    const errors = validateCatalog([...collectorValidationCatalog, unsafe]);
    expect(errors).toContain(`duplicate_id:${unsafe.id}`);
    expect(errors).toContain(`live_canary_command_forbidden:${unsafe.id}`);
    expect(errors).toContain(`live_canary_ci_forbidden:${unsafe.id}`);
  });

  test('keeps every local catalog command and CI attached to the canonical entry point', async () => {
    const packageJson = JSON.parse(await readFile(resolve(pocRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const entry of collectorValidationCatalog.filter((candidate) => candidate.command !== null)) {
      const scriptName = /^npm run ([a-z0-9:_-]+)/i.exec(entry.command!)?.[1];
      expect(scriptName, `catalog command syntax: ${entry.id}`).toBeTruthy();
      expect(packageJson.scripts?.[scriptName!], `missing npm script: ${entry.id}`).toBeTypeOf('string');
    }

    const workflow = await readFile(
      resolve(repositoryRoot, '.github', 'workflows', 'collector-local-validation.yml'),
      'utf8'
    );
    expect(workflow).toContain('npm run verify:collector');
    expect(workflow).not.toContain('run: npm run verify:local');

    expect(packageJson.scripts?.['test:integration']).toContain('--project integration');
    expect(packageJson.scripts?.['test:e2e:local']).toContain('--project e2e-local');
    expect(packageJson.scripts?.['test:unit']).toContain('--project extension-domain');
    expect(packageJson.scripts?.['verify:collector']).toContain('--skip-playwright-owned');
    const playwrightConfig = await readFile(resolve(pocRoot, 'playwright.real-local.config.ts'), 'utf8');
    expect(playwrightConfig).toContain("name: 'integration'");
    expect(playwrightConfig).toContain("name: 'e2e-local'");
    const vitestConfig = await readFile(resolve(pocRoot, 'vitest.config.ts'), 'utf8');
    expect(vitestConfig).toContain("name: 'extension-domain'");
  });
});
