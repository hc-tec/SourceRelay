import { readFile } from 'node:fs/promises';

const TOKEN_PATTERN = /^cst_[A-Za-z0-9_-]{43}$/;
const ARTIFACT_RETRIEVAL_PATH = /^\/v1\/collect\/artifacts\/([a-z0-9._-]{1,120})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ERROR_CODE_PATTERN = /^[a-z0-9_.-]{1,120}$/i;
const REQUEST_DEADLINE_MS = 50_000;

class CollectorServiceClientError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * A deliberately small native-process reference consumer for the loopback
 * Collector Service.  It has no route for browser lifecycle, Profile paths,
 * arbitrary URLs, selectors, scripts, Network traffic, or audit reads.
 *
 * Set COLLECTOR_SERVICE_TOKEN in the process environment rather than a
 * command-line argument so normal process listings do not expose it.
 */
const [command, ...arguments_] = process.argv.slice(2);

if (command === '--help' || command === 'help' || command === undefined) {
  printHelp();
  process.exitCode = command === undefined ? 1 : 0;
} else {
  try {
    const origin = collectorServiceOrigin(process.env.COLLECTOR_SERVICE_ORIGIN);
    const result = await execute(origin, command, arguments_);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const clientError = asClientError(error);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      status: clientError.status,
      error: clientError.code
    })}\n`);
    process.exitCode = 1;
  }
}

async function execute(origin, commandName, args) {
  switch (commandName) {
    case 'capabilities':
      requireExactArguments(args, 0);
      return await request(origin, '/v1/capabilities');
    case 'profiles':
      requireExactArguments(args, 0);
      return await request(origin, '/v1/collector-service/profiles', { token: collectorServiceToken() });
    case 'collect': {
      requireExactArguments(args, 1);
      const requestBody = await collectorRequestFromFile(args[0]);
      return await request(origin, '/v1/collect', {
        method: 'POST',
        token: collectorServiceToken(),
        body: requestBody
      });
    }
    case 'artifact': {
      requireExactArguments(args, 1);
      const retrievalPath = artifactRetrievalPath(args[0]);
      return await request(origin, retrievalPath, { token: collectorServiceToken() });
    }
    default:
      throw new CollectorServiceClientError('collector_service_client_command_invalid');
  }
}

function collectorServiceOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value ?? '');
  } catch {
    throw new CollectorServiceClientError('collector_service_client_origin_invalid');
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !Number.isInteger(port) || port < 1024 || port > 65535 ||
    parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash
  ) {
    throw new CollectorServiceClientError('collector_service_client_origin_invalid');
  }
  return parsed.origin;
}

function collectorServiceToken() {
  const token = process.env.COLLECTOR_SERVICE_TOKEN ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new CollectorServiceClientError('collector_service_client_token_invalid');
  }
  return token;
}

async function collectorRequestFromFile(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new CollectorServiceClientError('collector_service_client_request_file_unreadable');
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not_an_object');
    }
    return parsed;
  } catch {
    throw new CollectorServiceClientError('collector_service_client_request_invalid');
  }
}

function artifactRetrievalPath(value) {
  const match = ARTIFACT_RETRIEVAL_PATH.exec(value ?? '');
  if (!match) throw new CollectorServiceClientError('collector_service_client_artifact_path_invalid');
  return `/v1/collect/artifacts/${match[1]}/${match[2]}`;
}

async function request(origin, path, options = {}) {
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_DEADLINE_MS)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new CollectorServiceClientError('collector_service_client_deadline_exceeded');
    }
    throw new CollectorServiceClientError('collector_service_client_network_failed');
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new CollectorServiceClientError('collector_service_client_response_invalid', response.status);
  }
  if (!response.ok) {
    const error = typeof payload?.error === 'string' && ERROR_CODE_PATTERN.test(payload.error)
      ? payload.error
      : 'collector_service_client_request_failed';
    throw new CollectorServiceClientError(error, response.status);
  }
  return payload;
}

function requireExactArguments(args, count) {
  if (args.length !== count) throw new CollectorServiceClientError('collector_service_client_command_invalid');
}

function asClientError(error) {
  return error instanceof CollectorServiceClientError
    ? error
    : new CollectorServiceClientError('collector_service_client_failed');
}

function printHelp() {
  process.stdout.write(`Collector Service reference client\n\n` +
    `Environment:\n` +
    `  COLLECTOR_SERVICE_ORIGIN=http://127.0.0.1:<port>\n` +
    `  COLLECTOR_SERVICE_TOKEN=cst_...  (required except capabilities)\n\n` +
    `Commands:\n` +
    `  capabilities\n` +
    `  profiles\n` +
    `  collect <request.json>\n` +
    `  artifact <artifact.retrievalPath>\n`);
}
