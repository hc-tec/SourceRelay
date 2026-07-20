import { isAbsolute, resolve, sep } from 'node:path';

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function boundedIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

export function boundedPositiveInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new Error(`${name}_invalid`);
  }
  return Number(value);
}

export function childPath(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(resolvedRoot, child);
  if (!resolvedChild.startsWith(`${resolvedRoot}${sep}`)) throw new Error('path_outside_root');
  return resolvedChild;
}

export function absolutePath(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 2 || !isAbsolute(value)) {
    throw new Error(`${name}_invalid`);
  }
  return resolve(value);
}

export function safeReason(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9_]{1,100}$/.test(value) ? value : fallback;
}
