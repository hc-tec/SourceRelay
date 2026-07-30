import { assertCoreCapabilityMatrix } from './core-capability-matrix.mjs';

const matrix = await assertCoreCapabilityMatrix();
console.log(`collector core capability matrix: ok (${matrix.registry.length} direct capabilities)`);
