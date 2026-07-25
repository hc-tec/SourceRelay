import { describe, expect, test } from 'vitest';
import { consoleHtml, consoleScript, consoleStyles } from '../src/console-assets.js';

describe('Gateway Console assets', () => {
  test('keeps the local API client controls and their script parseable', () => {
    expect(consoleHtml).toContain('id="create-service-client"');
    expect(consoleHtml).toContain('id="issued-service-token"');
    expect(consoleScript).toContain('/v1/collector-service/clients');
    expect(consoleScript).toContain('/revoke');
    expect(consoleStyles).toContain('.issued-token');
    expect(() => new Function(consoleScript)).not.toThrow();
  });
});
