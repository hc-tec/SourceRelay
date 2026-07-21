import { describe, expect, test } from 'vitest';
import {
  collectorValidationCatalog,
  validateCatalog,
  type ValidationCatalogEntry
} from './catalog.js';

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
});
