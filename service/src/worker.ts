import { assertRequestOrigin, assertTuple, requestTuple } from "./isolation.js";
import { createAuthenticator, type ShipScope } from "./auth.js";
import { ServiceError, toOutcome, type Outcome } from "./errors.js";
import { handlePage, handlePrint } from "./owner.js";
import { ADMIN_SCOPE, buyAdminLabel, cancelAdminLabel, listAdminOrders, printLink, quoteAdminLabel, showAdminOrder } from "./admin.js";
import type { StoreShipping } from "./store.js";

export { StoreShipping } from "./store.js";

export const SERVICE_LINE = "DinkusKit Ship service";
// Commerce's largest possible order (100 lines of long multi-byte names) is about 66 KiB.
export const MAX_BODY_BYTES = 256 * 1024;

interface Call { store: DurableObjectStub<StoreShipping>; body: unknown; admission: Record<string, unknown>; params: string[]; site: string; origin: string; env: Env }
type Handler = (call: Call) => Promise<Outcome>;
interface Route { method: string; pattern: RegExp; scope: ShipScope; handle: Handler }
/** Order ids and label ids as they appear in a path segment (URL-encoded by the caller). */
const SEGMENT = "([A-Za-z0-9._:%-]{1,600})";
const route = (method: string, path: string, scope: ShipScope, handle: Handler): Route =>
  ({ method, pattern: new RegExp(`^${path.replaceAll("/", "\\/").replaceAll(":id", SEGMENT)}$`), scope, handle });

const ROUTES: Route[] = [
  // What Commerce's Orders calls (dinkuskit/commerce docs/implementation/registry-ship-sync.md).
  route("POST", "/v1/orders", "ship:orders", ({ store, body, admission }) => store.receiveOrder(body, admission)),
  route("GET", "/v1/labels", "ship:orders", ({ store, admission }) => store.listLabels(admission)),
  route("POST", "/v1/labels/ack", "ship:orders", ({ store, body, admission }) => store.ackLabel(body, admission)),
  // What the Ship Registry plugin calls (docs/contracts/ship-plugin-v1.md).
  route("GET", "/v1/admin/orders", ADMIN_SCOPE, ({ store }) => listAdminOrders(store)),
  route("GET", "/v1/admin/orders/:id", ADMIN_SCOPE, ({ store, params }) => showAdminOrder(store, params[0]!)),
  route("POST", "/v1/admin/orders/:id/prices", ADMIN_SCOPE, ({ store, params, body }) => quoteAdminLabel(store, params[0]!, body)),
  route("POST", "/v1/admin/orders/:id/labels", ADMIN_SCOPE, ({ store, params, body }) => buyAdminLabel(store, params[0]!, body)),
  route("POST", "/v1/admin/labels/:id/cancel", ADMIN_SCOPE, ({ store, params }) => cancelAdminLabel(store, params[0]!)),
  route("POST", "/v1/admin/labels/:id/print-link", ADMIN_SCOPE, ({ store, params, env, origin, site }) => printLink(env, origin, store, site, params[0]!)),
];

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ServiceError(404, "NOT_FOUND", "not found");
  }
}

const NO_STORE = { "cache-control": "no-store" };

/** The header the Ship plugin sends with its own Shipping page's address (docs/contracts/ship-plugin-v1.md). */
export const ADMIN_PAGE_HEADER = "x-ship-admin-page";

/**
 * The store admin's Shipping page as the plugin names it, accepted only when it
 * sits on the store's own origin from the pass and under EmDash's plugin admin
 * path, so a store can never be forwarded anywhere but its own admin.
 */
export function adminPageFrom(request: Request, siteOrigin: string | null): string | null {
  const value = request.headers.get(ADMIN_PAGE_HEADER);
  if (!value || !siteOrigin || value.length > 600) return null;
  try {
    const url = new URL(value);
    if (url.origin !== siteOrigin || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/_emdash\/admin\/plugins\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._\/-]{1,120}$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function respond(outcome: Outcome): Response {
  return outcome.ok
    ? Response.json(outcome.body, { status: outcome.status, headers: NO_STORE })
    : Response.json({ error: { ...outcome.detail, code: outcome.code, message: outcome.message } }, { status: outcome.status, headers: NO_STORE });
}

const tooLarge = () => new ServiceError(413, "BODY_TOO_LARGE", `request bodies are limited to ${MAX_BODY_BYTES} bytes`);

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET") return undefined;
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) throw tooLarge();
  // Stop reading at the limit, whatever Content-Length said (or if it is absent).
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  // The plugin's cancel and print-link calls carry no body.
  if (length === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length)));
  } catch {
    throw new ServiceError(400, "INVALID_INPUT", "body must be UTF-8 JSON");
  }
}

// One authenticator per configuration, so the issuer's JWKS is fetched once
// per isolate and cached by jose rather than on every request.
let cached: { key: string; authenticate: ReturnType<typeof createAuthenticator> } | undefined;
function authenticator(env: Env) {
  const key = `${env.ACCOUNT_ISSUER}\n${env.ACCOUNT_AUDIENCE}\n${env.ACCOUNT_JWKS_URL}\n${env.SHIP_RECIPIENT}\n${env.SHIP_SITE_ID}\n${env.SHIP_GENERATION}\n${env.SHIP_ALLOWED_ORDER_ID}\n${env.SHIP_EXCLUDED_ORDER_ID}\n${env.PB_ENVIRONMENT}`;
  if (cached?.key !== key) {
    let authenticate;
    try {
      authenticate = createAuthenticator({ issuer: env.ACCOUNT_ISSUER, audience: env.ACCOUNT_AUDIENCE, jwksUrl: env.ACCOUNT_JWKS_URL, env });
    } catch {
      throw new ServiceError(503, "NOT_CONFIGURED", "the Ship service is not configured");
    }
    cached = { key, authenticate };
  }
  return cached.authenticate;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try { assertRequestOrigin(env, request); } catch (error) { return respond(toOutcome(error)); }
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(`${SERVICE_LINE}\n`, { headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
  if (url.pathname.startsWith("/stores/") || url.pathname.startsWith("/auth/")) return handlePage(request, env);
  if (url.pathname.startsWith("/print/")) return handlePrint(request, env);
  try {
    const matches = ROUTES.map(candidate => ({ candidate, found: candidate.pattern.exec(url.pathname) })).filter(match => match.found);
    if (matches.length === 0) throw new ServiceError(404, "NOT_FOUND", "not found");
    const match = matches.find(({ candidate }) => candidate.method === request.method);
    if (!match) throw new ServiceError(405, "METHOD_NOT_ALLOWED", "method not allowed");
    const route = match.candidate, params = match.found!.slice(1).map(decode);
    if (!env.ACCOUNT_ISSUER || !env.ACCOUNT_AUDIENCE || !env.ACCOUNT_JWKS_URL) {
      throw new ServiceError(503, "NOT_CONFIGURED", "the Ship service is not configured");
    }
    const { siteId, siteOrigin } = await authenticator(env)(request, route.scope);
    const body = await readBody(request);
    const admission = requestTuple(request);
    assertTuple(env, admission);
    for (const key of ["recipient", "generation", "mode"]) {
      if (url.searchParams.has(key) || (body && typeof body === "object" && Object.hasOwn(body, key))) {
        throw new ServiceError(403, "FORBIDDEN", "Ship admission must use request headers");
      }
    }
    const store = env.SHIP_STORES.get(env.SHIP_STORES.idFromName(siteId));
    if (route.scope === ADMIN_SCOPE) {
      const adminPage = adminPageFrom(request, siteOrigin);
      if (adminPage) await store.rememberAdminPage(adminPage);
    }
    return respond(await route.handle({ store, body, admission, params, site: siteId, origin: url.origin, env }));
  } catch (error) {
    return respond(toOutcome(error));
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
