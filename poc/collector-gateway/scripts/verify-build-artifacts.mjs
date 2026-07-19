import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(root, 'dist', 'server.js');
await access(artifact);
const source = await readFile(artifact, 'utf8');

assert.match(source, /127\.0\.0\.1/, 'Gateway artifact must bind an IPv4 loopback address');
assert.doesNotMatch(source, /0\.0\.0\.0/, 'Gateway artifact must not contain an all-interface bind address');
assert.doesNotMatch(source, /express|fastify|koa/i, 'Gateway build must remain on the reviewed Node HTTP surface');
assert.match(source, /from\s+["']playwright["']/, 'Gateway artifact must keep Playwright as an installed runtime dependency');
assert.match(source, /launchPersistentContext/, 'Gateway artifact must launch a persistent browser context');
assert.match(
  source,
  /launchPersistentProfileContext\([^\n]{0,160},\s*false\)/,
  'Gateway artifact must launch exactly one user-visible browser after readiness'
);
assert.match(
  source,
  /launchPersistentProfileContext\([^\n]{0,160},\s*true\)/,
  'Gateway artifact must adopt changed unpacked extensions in a headless prewarm context'
);
assert.match(source, /--load-extension=/, 'Gateway artifact must automatically load the production extension');
assert.match(source, /--autoplay-policy=user-gesture-required/, 'managed collection browsers must suppress autoplay');
assert.match(source, /controlPagePromise/, 'control-page creation must be single-flight');
assert.match(source, /controlVerification/, 'control-version verification must be single-flight');
assert.match(source, /prewarmRuntimeReloadAttempted/, 'headless worker adoption must be observable');
assert.match(source, /collector_extension_worker_version_mismatch/, 'worker adoption must fail with an explicit version error');
assert.match(
  source,
  /controlSurfaceRevision\s*===\s*COLLECTOR_CONTROL_SURFACE_REVISION|controlSurfaceRevision\s*===\s*2/,
  'stale persistent workers must be rejected by control-surface revision'
);
assert.match(
  source,
  /extensionPages\.filter\([\s\S]{0,120}page\d*\s*!==\s*existing[\s\S]{0,120}\.map\(/,
  'duplicate extension control tabs must be closed'
);
assert.doesNotMatch(source, /chrome:\/\/extensions\//, 'Gateway must not open the visible extensions page for recovery');
assert.doesNotMatch(source, /validation_extension_ui_reload_failed/, 'Gateway must not retain Chrome UI reload recovery');
assert.match(source, /collector\.startCapabilityValidation/, 'Gateway artifact must include the validation-run control path');
assert.match(source, /collector\.startDetailCapabilityValidation/, 'Gateway artifact must include detail validation control');
assert.match(
  source,
  /parallel_dom_and_network_metadata/,
  'Gateway artifact must include the isolated parallel DOM and network-metadata reconnaissance mode'
);
assert.match(
  source,
  /productionResponseRoutes:\s*["']unchanged_empty["']/,
  'Source reconnaissance must not admit or modify production response routes'
);
assert.match(
  source,
  /responseBody:\s*["']not_read["']/,
  'Metadata-only reconnaissance must not read response bodies'
);
assert.match(
  source,
  /authenticated_bounded_interaction_network_metadata/,
  'Gateway artifact must include bounded authenticated interaction reconnaissance'
);
assert.match(
  source,
  /maximumSemanticActions:\s*5/,
  'Authenticated interaction reconnaissance must keep a fixed semantic-action budget'
);
assert.match(
  source,
  /schema_only_explicit_research_allowlist/,
  'Response body mapping must remain an explicit research-only schema projection'
);
assert.match(
  source,
  /captionMenuReadyTimeoutMs:\s*CAPTION_MENU_READY_TIMEOUT_MS/,
  'Caption-menu delivery must expose its bounded postcondition window'
);
assert.match(
  source,
  /prerequisite_unmet/,
  'Caption-language selection must be skipped when the menu postcondition is not met'
);
assert.match(
  source,
  /objective\.status\s*!==\s*["']satisfied["']/,
  'Interaction run success must be derived from the complete scope objective'
);
assert.match(
  source,
  /interaction-reconnaissance-runs\.json/,
  'Safe interaction reconnaissance artifacts must be persisted atomically in runtime state'
);
assert.match(
  source,
  /authenticated_interaction_reconnaissance/,
  'Persisted interaction artifacts must retain their explicit research-only kind'
);
assert.match(
  source,
  /\/v1\/reconnaissance\/interactions/,
  'Gateway artifact must expose compact interaction summaries and explicit record detail lookup'
);
assert.match(
  source,
  /MAX_MAPPED_RESPONSE_BYTES\s*=\s*512\s*\*\s*1024/,
  'Research response mapping must keep a per-response byte limit'
);
assert.match(
  source,
  /previous_run_interrupted_manual_review_required/,
  'Interrupted authenticated runs must become a persistent manual-review lock after restart'
);
assert.match(
  source,
  /account_safety_action_already_attempted/,
  'Authenticated semantic actions must be at-most-once within a run'
);
assert.match(
  source,
  /captchaAndRiskControl:\s*["']stop_and_persist_lock["']/,
  'Captcha and risk-control signals must stop the run and persist a lock'
);
assert.match(
  source,
  /networkFailure:\s*["']stop_without_action_retry["']/,
  'Network failures must stop without retrying platform actions'
);
assert.match(
  source,
  /account_safety_\$\{safety\.state\}/,
  'Formal task dispatch must honor the persistent account-safety state'
);
assert.match(
  source,
  /waiting_for_user_resume/,
  'Multi-stage tasks must expose a non-dispatchable explicit user-resume state'
);
assert.match(
  source,
  /resumeAfterUserConfirmation/,
  'Gateway artifact must expose the exact Console-origin-protected task resume route'
);
assert.match(
  source,
  /user_resumed/,
  'Task resumption must remain an explicit user-recorded state transition'
);
assert.match(
  source,
  /record\.state\s*=\s*hardLock\s*\?\s*["']locked["']\s*:\s*["']ready["']/,
  'Normal run completion must return directly to ready without a timed cooldown'
);
for (const removedPath of [
  ['account_safety', 'cooldown', 'active'].join('_'),
  ['waiting', 'for', 'account_safety'].join('_'),
  ['resume', 'after', 'account-safety'].join('-')
]) {
  assert.equal(
    source.includes(removedPath),
    false,
    `Gateway artifact must not retain timed-cooldown runtime path: ${removedPath}`
  );
}
assert.match(
  source,
  /bilibili-transcript/,
  'Gateway artifact must expose the Console-origin-protected transcript validation route'
);
assert.match(
  source,
  /authenticated_transcript_validation/,
  'Authenticated transcript validation must use the persistent account-safety circuit breaker'
);
assert.match(
  source,
  /collector\.startTranscriptCapabilityValidation/,
  'Gateway must drive the production MV3 transcript protocol instead of calling platform APIs directly'
);
assert.match(
  source,
  /collector\.getTranscriptCapabilityValidation/,
  'A lost local response must recover through transcript run lookup'
);
assert.match(
  source,
  /collector\.completeTranscriptCapabilityValidation/,
  'Gateway must complete the transcript run through the extension-owned control surface'
);
assert.match(
  source,
  /reveal_player_controls/,
  'Gateway transcript interaction must model the human control-reveal action explicitly'
);
assert.match(
  source,
  /transcript_validation_caption_hover_input_failed/,
  'Gateway transcript interaction must use browser-level caption hover input'
);
assert.match(
  source,
  /transcript_validation_chinese_caption_click_failed/,
  'Gateway transcript interaction must use one browser-level language click'
);
assert.match(
  source,
  /navigate_transcript_target/,
  'Transcript navigation must enter the persistent account-safety action ledger'
);
assert.match(
  source,
  /transcript-document\.json/,
  'Gateway must persist the public subtitle document as a local raw-first JSON artifact'
);
assert.match(
  source,
  /track-directory\.json/,
  'Gateway must persist only the projected subtitle track directory'
);
assert.match(
  source,
  /profileAndBrowserRuntimeIds:\s*["']omitted["']/,
  'Transcript artifacts must omit Profile and browser runtime identifiers'
);
assert.match(
  source,
  /productionResponseRoutes:\s*["']unchanged_empty["']/,
  'Transcript artifacts must not expand production response routes'
);
assert.match(
  source,
  /var MAX_RUN_MS\s*=\s*6e4|const MAX_RUN_MS\s*=\s*60_000/,
  'Authenticated interaction runs must define a fixed 60-second total deadline'
);
assert.match(
  source,
  /runDeadlineMs:\s*MAX_RUN_MS/,
  'Authenticated interaction safeguards must expose the fixed run deadline'
);
assert.match(
  source,
  /MAX_FAILED_XHR_FETCH_PER_PHASE\s*=\s*3/,
  'Repeated failed Fetch/XHR requests must stop the current run'
);
assert.match(
  source,
  /resume_authenticated_platform_actions/,
  'Account-safety unlock must require an explicit typed acknowledgement'
);
assert.match(
  source,
  /protocol\s*===\s*["']http:["']\s*\|\|\s*protocol\s*===\s*["']https:["']/,
  'Managed Profile launch must identify restored HTTP(S) tabs for closure'
);
assert.match(source, /admittedToStrategyRegistry/, 'Gateway artifact must preserve explicit validation admission state');
assert.match(source, /\/v1\/extension\/evidence/, 'Gateway artifact must authenticate formal evidence submissions');
assert.match(source, /responseObservation:\s*["']disabled["']/, 'Evidence batches must keep response observation disabled');
assert.match(source, /collector\.pollGatewayTasks/, 'Gateway artifact must expose explicit managed-profile polling');
assert.match(
  source,
  /progress\.state\s*===\s*["']completed["'][\s\S]{0,320}return this\.#summary\(record\)/,
  'completed-stage Evidence must not regress task state'
);

console.log(JSON.stringify({
  ok: true,
  gate: 'collector-gateway-build-artifact',
  artifact: 'dist/server.js'
}, null, 2));
