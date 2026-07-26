import { describe, expect, test } from 'vitest';
import { ExternalRequestCounter } from '../src/profile-runtime/external-request-counter.js';

describe('external request counter', () => {
  test('counts an in-flight request once and settles it idempotently', () => {
    const counter = new ExternalRequestCounter();
    const request = {};

    counter.started(request);
    counter.started(request);
    expect(counter.count).toBe(1);

    counter.settled(request);
    counter.settled(request);
    expect(counter.count).toBe(0);
  });

  test('keeps concurrent requests separate and clears them when a session closes', () => {
    const counter = new ExternalRequestCounter();
    const first = {};
    const second = {};
    counter.started(first);
    counter.started(second);
    counter.settled(first);
    expect(counter.count).toBe(1);

    counter.clear();
    expect(counter.count).toBe(0);
  });
});
