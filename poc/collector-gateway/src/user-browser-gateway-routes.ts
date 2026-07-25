import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleBrowserBindingRoute, type BrowserBindingRouteContext } from './browser-binding-routes';
import { handleExtensionWorkRoute, type ExtensionWorkRouteContext } from './extension-work-routes';
import { send, sendJson } from './gateway-http';
import {
  handleUserBrowserGatewayAdminRoute,
  type UserBrowserGatewayAdminRouteContext
} from './user-browser-gateway-admin-routes';
import {
  handleUserBrowserCollectorServiceRoute,
  type UserBrowserCollectorServiceRouteContext
} from './user-browser-collector-service-routes';
import {
  userBrowserConsoleHtml,
  userBrowserConsoleScript,
  userBrowserConsoleStyles
} from './user-browser-console-assets';

export interface UserBrowserGatewayRouteContext extends
  BrowserBindingRouteContext,
  ExtensionWorkRouteContext,
  UserBrowserCollectorServiceRouteContext,
  UserBrowserGatewayAdminRouteContext {}

/**
 * The only router mounted by the production user-browser entry point.  Its
 * context has no Browser Host, browser manager, Profile registry, or legacy
 * runner, which makes a fallback into the isolated test lane impossible.
 */
export async function handleUserBrowserGatewayRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: UserBrowserGatewayRouteContext
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/') {
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    send(response, 200, 'text/html; charset=utf-8', userBrowserConsoleHtml);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/style.css') {
    send(response, 200, 'text/css; charset=utf-8', userBrowserConsoleStyles);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/app.js') {
    send(response, 200, 'text/javascript; charset=utf-8', userBrowserConsoleScript);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/v1/status') {
    const bindings = context.pairingBroker.listBrowserBindings();
    sendJson(response, 200, {
      schemaVersion: 1,
      deploymentMode: 'user_owned_browser_extension',
      identity: context.identity.publicIdentity,
      browserBindingCount: bindings.length,
      onlineBrowserBindingCount: bindings.filter((binding) => binding.state === 'online').length,
      browserProcessControl: 'not_available'
    });
    return true;
  }

  if (await handleExtensionWorkRoute(request, response, url, context)) return true;
  if (await handleBrowserBindingRoute(request, response, url, context)) return true;
  if (await handleUserBrowserCollectorServiceRoute(request, response, url, context)) return true;
  if (await handleUserBrowserGatewayAdminRoute(request, response, url, context)) return true;

  if (isLegacyIsolatedRoute(url.pathname)) {
    sendJson(response, 410, {
      schemaVersion: 2,
      ok: false,
      error: 'user_browser_legacy_route_not_available'
    });
    return true;
  }
  return false;
}

function isLegacyIsolatedRoute(pathname: string): boolean {
  return pathname === '/v1/openapi.json' ||
    pathname === '/v1/capabilities' ||
    pathname === '/v1/collect' ||
    pathname.startsWith('/v1/profiles') ||
    pathname.startsWith('/v1/browser-host') ||
    pathname.startsWith('/v1/collector-service/profiles') ||
    pathname.startsWith('/v1/collector-service/clients') ||
    pathname.startsWith('/v1/collector-service/audit');
}
