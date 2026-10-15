import { assertRequestOrigin, assertTuple, requestTuple } from "./isolation.js";
import { createAuthenticator, type ShipScope } from "./auth.js";
import { ServiceError, toOutcome, type Outcome } from "./errors.js";
import { handlePage } from "./owner.js";
import type { StoreShipping } from "./store.js";

export { StoreShipping } from "./store.js";

export const SERVICE_LINE = "DinkusKit Ship service";
// Commerce's largest possible order (100 lines of long multi-byte names) is about 66 KiB.
export const MAX_BODY_BYTES = 256 * 1024;

type Handler = (store: DurableObjectStub<StoreShipping>, body: unknown, admission: Record<string, unknown>) => Promise<Outcome>;
interface Route { method: string; path: string; scope: ShipScope; handle: Handler }

/** What Commerce's Orders calls (dinkuskit/commerce docs/implementation/registry-ship-sync.md). */
const ROUTES: Route[] = [
  { method: "POST", path: "/v1/orders", scope: "ship:orders", handle: (s, body, admission) => s.receiveOrder(body, admission) },
  { method: "GET", path: "/v1/labels", scope: "ship:orders", handle: (s, _body, admission) => s.listLabels(admission) },
  { method: "POST", path: "/v1/labels/ack", scope: "ship:orders", handle: (s, body, admission) => s.ackLabel(body, admission) },
];

const NO_STORE = { "cache-control": "no-store" };

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
  try {
    const matches = ROUTES.filter(route => route.path === url.pathname);
    if (matches.length === 0) throw new ServiceError(404, "NOT_FOUND", "not found");
    const route = matches.find(candidate => candidate.method === request.method);
    if (!route) throw new ServiceError(405, "METHOD_NOT_ALLOWED", "method not allowed");
    if (!env.ACCOUNT_ISSUER || !env.ACCOUNT_AUDIENCE || !env.ACCOUNT_JWKS_URL) {
      throw new ServiceError(503, "NOT_CONFIGURED", "the Ship service is not configured");
    }
    const siteId = await authenticator(env)(request, route.scope);
    const body = await readBody(request);
    const admission = requestTuple(request);
    assertTuple(env, admission);
    for (const key of ["recipient", "generation", "mode"]) {
      if (url.searchParams.has(key) || (body && typeof body === "object" && Object.hasOwn(body, key))) {
        throw new ServiceError(403, "FORBIDDEN", "Ship admission must use request headers");
      }
    }
    return respond(await route.handle(env.SHIP_STORES.get(env.SHIP_STORES.idFromName(siteId)), body, admission));
  } catch (error) {
    return respond(toOutcome(error));
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
