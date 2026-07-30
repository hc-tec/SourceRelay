import { describe, expect, test } from 'vitest';
import { findCoreBoundaryViolations } from '../scripts/core-boundaries.mjs';

describe('Collector Core import boundaries', () => {
  test('Core packages do not import upper applications or browser-control internals across layers', async () => {
    await expect(findCoreBoundaryViolations()).resolves.toEqual([]);
  });
});

