import { readTestbenchConfig, safeErrorCode } from '../src/contracts.mjs';
import { readGatewayOpenApi, readGatewayStatus } from '../src/gateway-client.mjs';

try {
  const config = readTestbenchConfig(process.env);
  const [status, openApi] = await Promise.all([readGatewayStatus(config), readGatewayOpenApi(config)]);
  const paths = openApi?.paths && typeof openApi.paths === 'object' ? Object.keys(openApi.paths) : [];
  const expected = [
    '/v2/collector-service/browser-bindings',
    '/v2/collect',
    '/v2/collect/operations/{operationId}',
    '/v1/collect/artifacts/{capability}/{artifactId}'
  ];
  if (status?.deploymentMode !== 'user_owned_browser_extension' || status?.browserProcessControl !== 'not_available' ||
    openApi?.openapi !== '3.1.0' || !expected.every((path) => paths.includes(path))) {
    throw new Error('testbench_gateway_contract_unexpected');
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    gatewayOrigin: config.gatewayOrigin,
    deploymentMode: status.deploymentMode,
    browserBindingCount: status.browserBindingCount,
    onlineBrowserBindingCount: status.onlineBrowserBindingCount,
    paths: expected
  }, null, 2)}\n`);
} catch (error) {
  const code = error instanceof Error ? safeErrorCode(error.message, 'testbench_gateway_smoke_failed') : 'testbench_gateway_smoke_failed';
  process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
  process.exitCode = 1;
}
