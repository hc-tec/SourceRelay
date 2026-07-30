/** Raw-preserving structured views over the stable Collector response envelope. */

import { CollectorClientError } from './errors.mjs';
import { isOperation } from './validation.mjs';

function clone(value) {
  return structuredClone(value);
}
function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CollectorClientError(code, 502);
  }
  return clone(value);
}

export class ArtifactReference {
  constructor(raw) {
    const value = object(raw, 'collector_client_operation_artifact_invalid');
    if (typeof value.artifactId !== 'string' || typeof value.retrievalPath !== 'string' ||
        value.summary === null || typeof value.summary !== 'object' || Array.isArray(value.summary)) {
      throw new CollectorClientError('collector_client_operation_artifact_invalid', 502);
    }
    this.artifactId = value.artifactId;
    this.retrievalPath = value.retrievalPath;
    this.summary = clone(value.summary);
    this.raw = value;
    Object.freeze(this);
  }

  toJSON() {
    return clone(this.raw);
  }
}

export class Operation {
  constructor(raw) {
    const value = object(raw, 'collector_client_operation_invalid');
    if (!isOperation(value)) throw new CollectorClientError('collector_client_operation_invalid', 502);
    this.operationId = value.operationId;
    this.browserBindingId = typeof value.browserBindingId === 'string' ? value.browserBindingId : null;
    this.platform = typeof value.platform === 'string' ? value.platform : null;
    this.capability = value.capability;
    this.executionTarget = typeof value.executionTarget === 'string' ? value.executionTarget : null;
    this.state = value.state;
    this.queuedAt = typeof value.queuedAt === 'string' ? value.queuedAt : null;
    this.claimedAt = typeof value.claimedAt === 'string' ? value.claimedAt : null;
    this.completedAt = typeof value.completedAt === 'string' ? value.completedAt : null;
    this.errorCode = typeof value.errorCode === 'string' ? value.errorCode : null;
    this.terminalReason = typeof value.terminalReason === 'string' ? value.terminalReason : null;
    this.artifact = value.artifact && typeof value.artifact === 'object' && !Array.isArray(value.artifact)
      ? new ArtifactReference(value.artifact)
      : null;
    this.raw = value;
    Object.freeze(this);
  }

  get succeeded() {
    return this.state === 'completed' || this.state === 'partial';
  }

  toJSON() {
    return clone(this.raw);
  }
}

export class Artifact {
  constructor(raw) {
    const value = object(raw, 'collector_client_artifact_invalid');
    if (typeof value.capability !== 'string' || value.artifact === null ||
        typeof value.artifact !== 'object' || Array.isArray(value.artifact)) {
      throw new CollectorClientError('collector_client_artifact_invalid', 502);
    }
    const payload = clone(value.artifact);
    this.capability = value.capability;
    this.artifactId = typeof payload.artifactId === 'string' ? payload.artifactId : null;
    this.summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
      ? clone(payload.summary)
      : {};
    this.provenance = payload.provenance && typeof payload.provenance === 'object' && !Array.isArray(payload.provenance)
      ? clone(payload.provenance)
      : null;
    this.result = Object.hasOwn(payload, 'result') ? clone(payload.result) : clone(payload);
    this.payload = payload;
    this.raw = value;
    Object.freeze(this);
  }

  toJSON() {
    return clone(this.raw);
  }
}

export class CollectionResult {
  constructor(raw) {
    const value = object(raw, 'collector_client_collection_result_invalid');
    if (value.operation === null || typeof value.operation !== 'object' || Array.isArray(value.operation)) {
      throw new CollectorClientError('collector_client_collection_result_invalid', 502);
    }
    this.operation = new Operation(value.operation);
    this.artifact = value.artifact && typeof value.artifact === 'object' && !Array.isArray(value.artifact)
      ? new Artifact(value.artifact)
      : null;
    if (this.artifact && this.artifact.capability !== this.operation.capability) {
      throw new CollectorClientError('collector_client_collection_result_invalid', 502);
    }
    this.raw = value;
    Object.freeze(this);
  }

  get result() {
    return this.artifact?.result ?? null;
  }

  get succeeded() {
    return this.operation.succeeded;
  }

  toJSON() {
    return clone(this.raw);
  }
}
