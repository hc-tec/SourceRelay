import { DIRECT_CAPABILITY_NAMES } from './constants.mjs';

export { DIRECT_CAPABILITY_NAMES };

/**
 * Returns the capability names this client is allowed to submit through the
 * direct user-owned-browser API. The returned array is detached from the
 * internal validator state.
 */
export function listDirectCapabilities() {
  return [...DIRECT_CAPABILITY_NAMES];
}
