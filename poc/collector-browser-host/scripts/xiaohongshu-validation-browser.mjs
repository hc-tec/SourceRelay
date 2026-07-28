/**
 * A dedicated, persistent validation browser for Xiaohongshu public-content
 * reconnaissance. It deliberately shares no state directory, endpoint or
 * Chromium user-data directory with the generic validation fixture, and it
 * disables test-only extension-control commands.
 */
process.env.COLLECTOR_VALIDATION_BROWSER_INSTANCE = 'xiaohongshu-validation';
process.env.COLLECTOR_VALIDATION_PROFILE_ID = 'xiaohongshu_validation';
process.env.COLLECTOR_VALIDATION_EXTENSION_CONTROL = 'disabled';
process.env.COLLECTOR_XIAOHONGSHU_VALIDATION_EXTENSION_CONTROL = 'enabled';

await import('./validation-browser.mjs');
