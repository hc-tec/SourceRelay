import { describe, expect, test } from 'vitest';
import { compareCoreCapabilityMatrix, readCoreCapabilityMatrix } from '../scripts/core-capability-matrix.mjs';

describe('Collector Core cross-language capability matrix', () => {
  test('all executable declarations match while the extension keeps only browser capabilities', async () => {
    const matrix = await readCoreCapabilityMatrix();
    expect(matrix.registry).toHaveLength(18);
    expect(matrix.officialRegistry).toHaveLength(3);
    expect(matrix.officialContract).toEqual(expect.arrayContaining(matrix.officialRegistry));
    expect(matrix.extension).toHaveLength(15);
    expect(compareCoreCapabilityMatrix(matrix)).toEqual([]);
  });

  test('detects a missing SDK registration before release', () => {
    const matrix = {
      registry: ['one', 'two'],
      artifacts: ['one', 'two'],
      openapiRequests: ['one', 'two'],
      openapiOperations: ['one', 'two'],
      openapiArtifacts: ['one', 'two'],
      javascript: ['one'],
      python: ['one', 'two']
    };
    expect(compareCoreCapabilityMatrix(matrix)).toEqual([
      { source: 'javascript', expected: ['one', 'two'], actual: ['one'] }
    ]);
  });
});
