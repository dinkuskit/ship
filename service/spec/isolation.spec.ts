import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";
import { isolation, tuple, SANDBOX_ORIGIN, SANDBOX_AUDIENCE } from "../src/isolation";
import { startSignIn, finishSignIn, readSession } from "../src/session";

let site: string, issuer: string, configured: Env, signingKey: CryptoKey;
const admission = { recipient: "ship-sandbox", generation: "fixture_20261014", mode: "test" };
const headers = { "X-Ship-Recipient": admission.recipient, "X-Ship-Generation": admission.generation, "X-Ship-Mode": admission.mode };
const claims = { ship_recipient: admission.recipient, ship_generation: admission.generation, ship_mode: admission.mode };
const store = () => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));
const order = (overrides: Record<string, unknown> = {}) => ({
  schema: "dinkuskit.commerce.ship-order/v1", orderId: "order:fresh", number: 1002, version: 1,
  status: "processing", test: true, email: "fixture@example.test", completed: null,
  shipTo: { name: "Fixture", line1: "1 Test Way", city: "Example", region: "CA", postalCode: "90000", country: "US" },
  lines: [{ catalogItemId: "item", name: "Fixture parcel", quantity: 1, weightOz: 8 }], ...overrides,
});
async function setEnv(value: Env = configured) {
  await runInDurableObject(store(), async instance => { (instance as unknown as { env: Env }).env = value; });
}
async function pass(extra: Record<string, unknown> = {}, audience = configured.ACCOUNT_AUDIENCE) {
  return new SignJWT({ site_id: site, scope: "ship:orders", ...claims, ...extra })
    .setProtectedHeader({ alg: "ES256", kid: "fixture" }).setIssuer(issuer).setAudience(audience)
    .setSubject("fixture-business").setIssuedAt().setExpirationTime("5m").sign(signingKey);
}
async function call(method: string, path: string, body?: unknown, options: {
  headers?: Record<string, string>; claims?: Record<string, unknown>; audience?: string; env?: Env; origin?: string;
} = {}) {
  const response = await worker.fetch(new Request(`${options.origin ?? SANDBOX_ORIGIN}${path}`, {
    method, headers: { authorization: `Bearer ${await pass(options.claims, options.audience)}`, "content-type": "application/json", ...(options.headers ?? headers) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), options.env ?? configured);
  return { status: response.status, json: await response.json() as any };
}
async function counts() {
  return runInDurableObject(store(), async (_, state) => Object.fromEntries(
    ["orders", "label_events", "labels", "purchases", "sessions", "store_meta", "shipped_emails"].map(table =>
      [table, state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n])));
}
beforeEach(async () => {
  site = `isolated-${crypto.randomUUID()}`;
  issuer = `https://issuer-${crypto.randomUUID()}.example.test`;
  const keys = await generateKeyPair("ES256"); signingKey = keys.privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "fixture", alg: "ES256", use: "sig" };
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (new URL(String(input)).href === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    throw new Error("unexpected external fetch");
  });
  configured = { ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: SANDBOX_AUDIENCE, ACCOUNT_JWKS_URL: `${issuer}/jwks`,
    ACCOUNT_SIGNIN_URL: `${issuer}/sign-in`, ACCOUNT_TOKEN_URL: `${issuer}/token`,
    SHIP_SESSION_SECRET: "fixture-session-secret-of-more-than-32-characters", PB_ENVIRONMENT: "sandbox",
    SHIP_RECIPIENT: admission.recipient, SHIP_GENERATION: admission.generation, SHIP_SITE_ID: site,
    SHIP_ALLOWED_ORDER_ID: "order:fresh", SHIP_EXCLUDED_ORDER_ID: "order:protected",
    SHIP_EMAIL_FROM: "fixture@example.test",
    EMAIL: { send: async () => { throw new Error("isolated email must never send"); } },
  } as unknown as Env;
  await setEnv();
});
afterEach(() => vi.restoreAllMocks());

test("isolated configuration is fixed and fails closed, with intentionally empty admission", () => {
  expect(isolation({ ...configured, SHIP_ALLOWED_ORDER_ID: "" })?.allowedOrderId).toBe("");
  for (const override of [
    { SHIP_RECIPIENT: "arbitrary" }, { SHIP_GENERATION: "../generation" }, { SHIP_GENERATION: "g".repeat(129) },
    { SHIP_SITE_ID: "" }, { SHIP_EXCLUDED_ORDER_ID: "" }, { SHIP_ALLOWED_ORDER_ID: "order:protected" },
    { SHIP_ALLOWED_ORDER_ID: "line\u2028break" }, { PB_ENVIRONMENT: "production" }, { ACCOUNT_AUDIENCE: "dinkus-ship" },
  ]) expect(() => isolation({ ...configured, ...override })).toThrow();
  expect(tuple({} as Env)).toBeUndefined();
});

test("signed tuple plus matching headers admit exactly one TEST order and return a matching receipt", async () => {
  expect(await call("POST", "/v1/orders", order())).toEqual({ status: 200, json: { orderId: "order:fresh", version: 1, ...admission } });
  expect(await store().getOrder("order:fresh")).toMatchObject({ orderId: "order:fresh", test: true, ...admission });
  expect(await call("POST", "/v1/orders", order({ version: 2 }))).toEqual({ status: 200, json: { orderId: "order:fresh", version: 2, ...admission } });
  expect(await call("POST", "/v1/orders", order())).toEqual({ status: 200, json: { orderId: "order:fresh", version: 2, ...admission } });
});

test("wrong claims, headers, origin and duplicate wire tuples deny before order effects", async () => {
  const baseline = await counts();
  for (const extra of [{ ship_generation: "old" }, { ship_recipient: "other" }, { ship_mode: "live" }, { site_id: "another" }, { scope: "ship:labels" }]) {
    expect((await call("POST", "/v1/orders", order(), { claims: extra })).status).toBe(403);
  }
  expect((await call("POST", "/v1/orders", order(), { audience: "dinkus-ship" })).status).toBe(401);
  for (const fields of [{}, { ...headers, "X-Ship-Generation": "old" }, { ...headers, "X-Ship-Mode": "live" }]) {
    expect((await call("POST", "/v1/orders", order(), { headers: fields })).status).toBe(403);
  }
  expect((await call("POST", "/v1/orders", order(), { origin: "https://ship.dinkuskit.com" })).status).toBe(403);
  expect((await call("POST", "/v1/orders?generation=fixture", order())).status).toBe(403);
  expect((await call("POST", "/v1/orders", order({ ...admission }))).status).toBe(403);
  expect(await counts()).toEqual(baseline);
});

test("protected, foreign and nonTEST orders plus empty admission create no state/provider/email effects", async () => {
  const baseline = await counts();
  for (const override of [{ orderId: "order:protected", number: 1001 }, { orderId: "other" }, { test: false }]) {
    expect((await call("POST", "/v1/orders", order(override))).status).toBe(403);
    expect(await counts()).toEqual(baseline);
  }
  configured = { ...configured, SHIP_ALLOWED_ORDER_ID: "" }; await setEnv();
  expect((await call("POST", "/v1/orders", order())).status).toBe(403);
  expect(await counts()).toEqual(baseline);
});

test("events and acknowledgements require the admitted generation and event; legacy cannot consume them", async () => {
  await call("POST", "/v1/orders", order());
  const event = await store().recordLabel({ orderId: "order:fresh", version: 1, carrier: "USPS", tracking: "FIXTURE-TRACKING" });
  expect(event).toMatchObject(admission);
  expect((await call("GET", "/v1/labels")).json).toEqual([event]);
  expect((await call("GET", "/v1/labels", undefined, { headers: {} })).status).toBe(403);
  expect((await call("POST", "/v1/labels/ack", { eventId: event.eventId }, { headers: { ...headers, "X-Ship-Generation": "old" } })).status).toBe(403);
  expect((await call("GET", "/v1/labels")).json).toEqual([event]);
  expect((await call("POST", "/v1/labels/ack", { eventId: "lbl_unknown" })).status).toBe(403);
  expect(await call("POST", "/v1/labels/ack", { eventId: event.eventId })).toEqual({ status: 200, json: { eventId: event.eventId, ...admission } });
  expect((await call("GET", "/v1/labels")).json).toEqual([]);
  const legacy = { ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: `${issuer}/jwks` } as unknown as Env;
  expect((await call("GET", "/v1/labels", undefined, { env: legacy, origin: "https://ship.dinkuskit.com", audience: "dinkus-ship", headers: {} })).status).toBe(403);
  await setEnv(legacy);
  expect((await store().listLabels() as { ok: boolean }).ok).toBe(false);
});

test("isolated completion never queues or sends email even with EMAIL and sender configured", async () => {
  await call("POST", "/v1/orders", order());
  await call("POST", "/v1/orders", order({ version: 2, status: "completed", completed: { at: new Date().toISOString(), carrier: "USPS", tracking: "FIXTURE" } }));
  await runInDurableObject(store(), async instance => { await instance.alarm(); });
  expect((await counts()).shipped_emails).toBe(0);
  expect((await store().getSettings()).signupDeveloperId).toBeNull();
  expect((await store().connectPostage({ username: "fixture", password: "fixture" }, "fixture-owner") as { ok: boolean }).ok).toBe(false);
  expect((await store().disconnectPostage() as { ok: boolean }).ok).toBe(false);
});

test("a generation cannot adopt previously stamped isolated storage", async () => {
  await call("POST", "/v1/orders", order());
  configured = { ...configured, SHIP_GENERATION: "next" }; await setEnv();
  expect((await store().receiveOrder(order(), { ...admission, generation: "next" }) as { ok: boolean }).ok).toBe(false);
  await runInDurableObject(store(), async instance => {
    await expect(instance.getSettings()).rejects.toThrow("storage generation does not match");
  });
});

function cookies(response: Response | Headers): string {
  const source = response instanceof Response ? response.headers : response;
  return source.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("=")).join("; ");
}
async function begin() {
  const response = await startSignIn(configured, site, `/stores/${site}/orders`);
  const target = new URL(response.headers.get("location")!);
  const request = new Request(`${SANDBOX_ORIGIN}/auth/callback?code=fixture&state=${target.searchParams.get("state")}`, { headers: { cookie: cookies(response) } });
  return { response, target, request };
}
const tokenAnswer = async (extra: Record<string, unknown> = {}) => Response.json({
  access_token: await pass({ scope: "ship:labels", uid: "fixture-owner", email: "owner@example.test", ...extra }), refresh_token: "fixture-refresh-" + "x".repeat(40),
});

test("owner wire stays issuer-compatible while passes and sessions pin the deployment tuple", async () => {
  const start = await begin();
  expect([...start.target.searchParams.keys()].sort()).toEqual(["code_challenge", "code_challenge_method", "site_id", "state"]);
  const exchange = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(body.grant_type ? ["grant_type", "refresh_token"] : ["code", "code_verifier"]);
    return tokenAnswer();
  });
  const answer = await finishSignIn(start.request, configured, exchange);
  expect(answer.ok).toBe(true);
  if (!answer.ok) throw new Error("fixture sign-in failed");
  const request = new Request(`${SANDBOX_ORIGIN}/stores/${site}/orders`, { headers: { cookie: cookies(answer.headers) } });
  expect((await readSession(request, configured, site, exchange))?.session.uid).toBe("fixture-owner");
  await runInDurableObject(store(), async (_, state) => { state.storage.sql.exec("UPDATE sessions SET checked_at = ?", Math.floor(Date.now()/1000)-301); });
  expect((await readSession(request, configured, site, exchange))?.session.uid).toBe("fixture-owner");
  expect(exchange).toHaveBeenCalledTimes(2);
  await expect(readSession(request, { ...configured, SHIP_GENERATION: "next" }, site, exchange)).rejects.toThrow();
  expect(exchange).toHaveBeenCalledTimes(2);
});

test("pending code cannot cross generations and mismatched refreshed passes end the owner session", async () => {
  const start = await begin();
  const exchange = vi.fn(async () => tokenAnswer());
  expect((await finishSignIn(start.request, { ...configured, SHIP_GENERATION: "next" }, exchange)).ok).toBe(false);
  expect(exchange).not.toHaveBeenCalled();
  const answer = await finishSignIn(start.request, configured, exchange);
  if (!answer.ok) throw new Error("fixture sign-in failed");
  const request = new Request(SANDBOX_ORIGIN, { headers: { cookie: cookies(answer.headers) } });
  await runInDurableObject(store(), async (_, state) => { state.storage.sql.exec("UPDATE sessions SET checked_at = ?", Math.floor(Date.now()/1000)-301); });
  expect(await readSession(request, configured, site, async () => tokenAnswer({ ship_generation: "old" }))).toBeNull();
  expect((await counts()).sessions).toBe(0);
});

test("owner HTML actions cannot select excluded/nonTEST orders or invoke PB", async () => {
  const start = await begin();
  const answer = await finishSignIn(start.request, configured, async () => tokenAnswer());
  if (!answer.ok) throw new Error("fixture sign-in failed");
  const before = await counts();
  const request = new Request(`${SANDBOX_ORIGIN}/stores/${site}/orders/order%3Aprotected/labels`, {
    method: "POST", headers: { cookie: cookies(answer.headers), origin: SANDBOX_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ version: "1", service: "PM", recipient: "ship-sandbox", generation: "other", mode: "test" }),
  });
  expect((await worker.fetch(request, configured)).status).toBeGreaterThanOrEqual(400);
  expect(await counts()).toEqual(before);
  expect(vi.mocked(fetch).mock.calls.every(([input]) => String(input).endsWith("/jwks"))).toBe(true);
});


test("isolated storage refuses populated legacy records rather than upgrading their identity", async () => {
  const legacy = { ...env } as unknown as Env;
  await setEnv(legacy);
  await store().receiveOrder(order({ orderId: "order:protected", number: 1001 }));
  await setEnv();
  expect((await call("POST", "/v1/orders", order())).status).toBe(403);
  expect((await counts()).orders).toBe(1);
});

test("owner practice-label action uses verified deployment tuple and ignores caller tuple fields", async () => {
  await call("POST", "/v1/orders", order());
  const start = await begin();
  const answer = await finishSignIn(start.request, configured, async () => tokenAnswer());
  if (!answer.ok) throw new Error("fixture sign-in failed");
  await store().saveShipFrom({ name: "Fixture", line1: "1 Test Way", city: "Example", region: "CA", postalCode: "90000" });
  await store().addBox({ name: "Fixture box", lengthIn: "6", widthIn: "4", heightIn: "3", weightOz: "1" });
  const settings = await store().getSettings();
  const response = await worker.fetch(new Request(`${SANDBOX_ORIGIN}/stores/${site}/orders/order%3Afresh/labels`, {
    method: "POST", headers: { cookie: cookies(answer.headers), origin: SANDBOX_ORIGIN, "content-type": "application/x-www-form-urlencoded", "X-Ship-Generation": "foreign" },
    body: new URLSearchParams({ version: "1", service: "PM", weightOz: "9", boxId: settings.boxes[0]!.boxId, kind: "practice", recipient: "foreign", generation: "foreign", mode: "live" }),
  }), configured);
  expect(response.status).toBe(303);
  const events = (await call("GET", "/v1/labels")).json;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ ...admission, orderId: "order:fresh" });
  expect(vi.mocked(fetch).mock.calls.every(([input]) => String(input).endsWith("/jwks"))).toBe(true);
});

test("settings and box mutations stamp fresh isolated storage first and refuse cross-generation or legacy mutations without side effects", async () => {
  const replyOutcome = await store().saveReplyTo({ replyTo: "owner@example.test" });
  expect(replyOutcome).toMatchObject({ ok: true, status: 200 });

  site = `isolated-shipfrom-${crypto.randomUUID()}`;
  configured = { ...configured, SHIP_SITE_ID: site };
  await setEnv();
  const shipFromOutcome = await store().saveShipFrom({
    name: "Fixture", line1: "1 Test Way", city: "Example", region: "CA", postalCode: "90000",
  });
  expect(shipFromOutcome).toMatchObject({ ok: true, status: 200 });

  site = `isolated-box-${crypto.randomUUID()}`;
  configured = { ...configured, SHIP_SITE_ID: site };
  await setEnv();
  const boxOutcome = await store().addBox({ name: "Small", lengthIn: "6", widthIn: "4", heightIn: "3", weightOz: "1" });
  expect(boxOutcome).toMatchObject({ ok: true, status: 201 });
  const boxId = (boxOutcome as { ok: true; body: { boxId: string } }).body.boxId;
  expect((await store().getSettings()).boxes.map(box => box.boxId)).toEqual([boxId]);

  const snapshot = async () => runInDurableObject(store(), async (_, state) => ({
    meta: state.storage.sql.exec<{ key: string; value: string }>("SELECT key, value FROM store_meta ORDER BY key").toArray(),
    boxes: state.storage.sql.exec<{ box_id: string }>("SELECT box_id FROM boxes ORDER BY box_id").toArray(),
  }));
  const beforeMismatch = await snapshot();

  await setEnv({ ...configured, SHIP_GENERATION: "next" });
  for (const attempt of [
    () => store().saveReplyTo({ replyTo: "intruder@example.test" }),
    () => store().saveShipFrom({ name: "Intruder", line1: "2 Test Way", city: "Example", region: "CA", postalCode: "90000" }),
    () => store().addBox({ name: "Intruder", lengthIn: "6", widthIn: "4", heightIn: "3", weightOz: "1" }),
    () => store().removeBox(boxId),
    () => store().connectPostage({ username: "fixture", password: "fixture" }, "intruder"),
    () => store().disconnectPostage(),
  ]) {
    expect(await attempt()).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  }
  expect(await snapshot()).toEqual(beforeMismatch);

  const legacy = { ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: `${issuer}/jwks` } as unknown as Env;
  await setEnv(legacy);
  for (const attempt of [
    () => store().saveReplyTo({ replyTo: "legacy@example.test" }),
    () => store().saveShipFrom({ name: "Legacy", line1: "3 Test Way", city: "Example", region: "CA", postalCode: "90000" }),
    () => store().addBox({ name: "Legacy", lengthIn: "6", widthIn: "4", heightIn: "3", weightOz: "1" }),
    () => store().removeBox(boxId),
    () => store().connectPostage({ username: "fixture", password: "fixture" }, "legacy"),
    () => store().disconnectPostage(),
  ]) {
    expect(await attempt()).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  }
  expect(await snapshot()).toEqual(beforeMismatch);
});

