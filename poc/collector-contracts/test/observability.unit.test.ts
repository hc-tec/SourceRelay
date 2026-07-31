import { describe, expect, test } from 'vitest';
import { isExtensionDiagnosticEvent } from '../src/extension-diagnostic.js';
import { isOperationalLogEvent, sanitiseOperationalDetails } from '../src/observability.js';

describe('operational log contract', () => {
  test('keeps bounded operational metadata and redacts credential/page-content fields', () => {
    const details = sanitiseOperationalDetails({
      phase: 'navigation',
      attempt: 1,
      route: '/v2/collect',
      token: 'never-retained',
      cookie: 'never-retained',
      responseBody: 'never-retained',
      nested: { status: 200, authorization: 'never-retained' },
      values: [1, true, 'safe'],
      tooLarge: 'x'.repeat(400)
    });

    expect(details).toMatchObject({
      phase: 'navigation',
      attempt: 1,
      route: '/v2/collect',
      token: '[redacted]',
      cookie: '[redacted]',
      responseBody: '[redacted]',
      nested: { status: 200, authorization: '[redacted]' },
      values: [1, true, 'safe']
    });
    expect(String(details.tooLarge)).toHaveLength(257);
    expect(JSON.stringify(details)).not.toContain('never-retained');
  });

  test('accepts a complete event and rejects malformed event identity', () => {
    const event = {
      schemaVersion: 1,
      eventId: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-07-31T00:00:00.000Z',
      component: 'gateway',
      level: 'error',
      eventType: 'extension.work.result_rejected',
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: null,
      operationId: '33333333-3333-4333-8333-333333333333',
      workId: null,
      capability: 'bilibili.danmaku',
      durationMs: 125,
      outcome: 'failed',
      errorCode: 'work_tab_user_taken_over',
      details: { phase: 'observe' }
    } as const;

    expect(isOperationalLogEvent(event)).toBe(true);
    expect(isOperationalLogEvent({ ...event, eventType: 'not valid' })).toBe(false);
    expect(isOperationalLogEvent({ ...event, durationMs: -1 })).toBe(false);
  });

  test('validates extension diagnostics without accepting arbitrary capabilities', () => {
    const event = {
      schemaVersion: 1,
      eventId: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-07-31T00:00:00.000Z',
      browserBindingId: '22222222-2222-4222-8222-222222222222',
      workId: '33333333-3333-4333-8333-333333333333',
      operationId: '44444444-4444-4444-8444-444444444444',
      platform: 'bilibili',
      capability: 'bilibili.danmaku',
      phase: 'execution_finished',
      outcome: 'failed',
      durationMs: 80,
      errorCode: 'work_tab_user_taken_over',
      details: { phase: 'observe' }
    } as const;

    expect(isExtensionDiagnosticEvent(event)).toBe(true);
    expect(isExtensionDiagnosticEvent({ ...event, capability: 'arbitrary.script' })).toBe(false);
  });
});
