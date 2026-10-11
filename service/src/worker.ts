import { createAuthenticator, type ShipScope } from "./auth.js";
import { ServiceError, toOutcome, type Outcome } from "./errors.js";
import type { StoreShipping } from "./store.js";

export { StoreShipping } from "./store.js";

export const SERVICE_LINE = "DinkusKit Ship service";
// Commerce's largest possible order (100 lines of long multi-byte names) is about 66 KiB.
export const MAX_BODY_BYTES = 256 * 1024;

type Handler = (store: DurableObjectStub<StoreShipping>, body: unknown) => Promise<Outcome>;
interface Route { method: string; path: string; scope: ShipScope; handle: Handler }

/** What Commerce's Orders calls (dinkuskit/commerce docs/implementation/registry-ship-sync.md). */
const ROUTES: Route[] = [
  { method: "POST", path: "/v1/orders", scope: "ship:orders", handle: (s, body) => s.receiveOrder(body) },
  { method: "GET", path: "/v1/labels", scope: "ship:orders", handle: s => s.listLabels() },
  { method: "POST", path: "/v1/labels/ack", scope: "ship:orders", handle: (s, body) => s.ackLabel(body) },
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
  const key = `${env.ACCOUNT_ISSUER}\n${env.ACCOUNT_AUDIENCE}\n${env.ACCOUNT_JWKS_URL}`;
  if (cached?.key !== key) {
    let authenticate;
    try {
      authenticate = createAuthenticator({ issuer: env.ACCOUNT_ISSUER, audience: env.ACCOUNT_AUDIENCE, jwksUrl: env.ACCOUNT_JWKS_URL });
    } catch {
      throw new ServiceError(503, "NOT_CONFIGURED", "the Ship service is not configured");
    }
    cached = { key, authenticate };
  }
  return cached.authenticate;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(`${SERVICE_LINE}\n`, { headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
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
    return respond(await route.handle(env.SHIP_STORES.get(env.SHIP_STORES.idFromName(siteId)), body));
  } catch (error) {
    return respond(toOutcome(error));
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
