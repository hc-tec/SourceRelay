export class CollectorClientError extends Error {
  constructor(code, status = 502, details = undefined) {
    super(code);
    this.name = 'CollectorClientError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
