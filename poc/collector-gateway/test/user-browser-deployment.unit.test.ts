import { describe, expect, test } from 'vitest';
import {
  userBrowserConsoleHtml,
  userBrowserConsoleScript,
  userBrowserConsoleStyles
} from '../src/user-browser-console-assets.js';
import { userBrowserCollectorServiceOpenApiDocument } from '../src/user-browser-collector-service-openapi.js';

describe('user-owned browser deployment surface', () => {
  test('exposes pairing, scoped-client and direct-only controls without isolated-browser controls', () => {
    expect(userBrowserConsoleHtml).toContain('id="create-browser-binding-pairing"');
    expect(userBrowserConsoleHtml).toContain('id="browser-binding-pairing-session"');
    expect(userBrowserConsoleHtml).toContain('id="create-service-client"');
    expect(userBrowserConsoleHtml).toContain('id="service-audit"');
    expect(userBrowserConsoleHtml).not.toContain('Collection Profile');
    expect(userBrowserConsoleScript).toContain('/v2/collector-service/clients');
    expect(userBrowserConsoleScript).toContain('/v2/collector-service/audit');
    expect(userBrowserConsoleScript).not.toContain('/v1/profiles');
    expect(userBrowserConsoleScript).not.toContain('/v1/browser-host');
    expect(userBrowserConsoleStyles).toContain('.pairing-ticket');
    expect(() => new Function(userBrowserConsoleScript)).not.toThrow();
  });

  test('documents capability-bound artifact retrieval in the production OpenAPI surface', () => {
    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    const artifactRoute = document.paths['/v1/collect/artifacts/{capability}/{artifactId}'];
    expect(artifactRoute.get['x-collector-required-scope']).toBe('artifacts:read');
    expect(artifactRoute.get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'capability' }),
      expect.objectContaining({ name: 'artifactId' })
    ]));
    const capabilityParameter = artifactRoute.get.parameters.find((parameter: { name?: string }) =>
      parameter.name === 'capability');
    expect(capabilityParameter.schema.enum).toEqual(expect.arrayContaining([
      'xiaohongshu.search.public_notes.v1',
      'xiaohongshu.account.public_notes.v1',
      'xiaohongshu.note.public_detail.v1',
      'xiaohongshu.note.public_comments.v1',
      'xiaohongshu.note.public_comment_replies.v1'
    ]));
    expect(Object.keys(document.paths)).not.toContain('/v1/profiles');
    expect(Object.keys(document.paths)).not.toContain('/v1/collect');
    expect(JSON.stringify(artifactRoute.get.parameters)).not.toContain('profileId');
  });
});
