/**
 * Tracks currently in-flight external requests by object identity. A Set is
 * intentional: Playwright exposes the same Request object to start and
 * terminal events, while duplicate terminal notifications must never drive
 * the public count below zero.
 */
export class ExternalRequestCounter<T extends object = object> {
  readonly #active = new Set<T>();

  started(request: T): void {
    this.#active.add(request);
  }

  settled(request: T): void {
    this.#active.delete(request);
  }

  clear(): void {
    this.#active.clear();
  }

  get count(): number {
    return this.#active.size;
  }
}
