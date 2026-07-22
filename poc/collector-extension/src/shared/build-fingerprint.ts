// The production build replaces this identifier with a deterministic
// SHA-256 of the extension's source and runtime assets.  Keeping the source
// placeholder here makes TypeScript typechecking independent from dist/.
declare const __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__: string;

export const COLLECTOR_EXTENSION_BUILD_FINGERPRINT =
  __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__;
