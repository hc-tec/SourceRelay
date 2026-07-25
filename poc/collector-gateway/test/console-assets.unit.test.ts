import { describe, expect, test } from 'vitest';
import { consoleHtml, consoleScript, consoleStyles } from '../src/console-assets.js';

describe('Gateway Console assets', () => {
  test('keeps user-browser pairing and local API client controls script-parseable', () => {
    expect(consoleHtml).toContain('id="create-browser-binding-pairing"');
    expect(consoleHtml).toContain('id="browser-binding-pairing-session"');
    expect(consoleHtml).toContain('id="browser-bindings"');
    expect(consoleHtml).toContain('id="create-service-client"');
    expect(consoleHtml).toContain('id="issued-service-token"');
    expect(consoleHtml).toContain('name="scopes"');
    expect(consoleHtml).toContain('id="service-audit"');
    expect(consoleScript).toContain('/v1/browser-bindings');
    expect(consoleScript).toContain('/v1/browser-bindings/pairing-sessions');
    expect(consoleScript).toContain('/v1/collector-service/clients');
    expect(consoleScript).toContain('/v1/collector-service/audit');
    expect(consoleScript).toContain('/revoke');
    expect(consoleScript).toContain("form.getAll('scopes')");
    expect(consoleStyles).toContain('.issued-token');
    expect(consoleStyles).toContain('.scope-selector');
    expect(consoleStyles).toContain('.audit-card');
    expect(() => new Function(consoleScript)).not.toThrow();
  });
});
