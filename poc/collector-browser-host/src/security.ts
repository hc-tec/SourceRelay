import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createBootstrapSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function authenticatePayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function authenticationMatches(secret: string, payload: string, candidate: string): boolean {
  const expected = Buffer.from(authenticatePayload(secret, payload));
  const actual = Buffer.from(candidate);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

export function timestampIsFresh(value: string, now = Date.now(), maximumSkewMs = 30_000): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= maximumSkewMs;
}

export function timestampIsUnexpired(value: string, now = Date.now()): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= now;
}
