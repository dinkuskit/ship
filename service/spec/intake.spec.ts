import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";

const audience = "dinkus-ship";
let site: string;
let issuer: string;
let sign: (claims?: { site?: unknown; scope?: string; audience?: string; age?: number }) => Promise<string>;
const configured = () => ({ ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: audience, ACCOUNT_JWKS_URL: `${issuer}/jwks` }) as unknown as Env;

beforeEach(async () => {
  site = `site-${crypto.randomUUID()}`;
  // A fresh issuer per test, since the Worker caches each issuer's keys.
  issuer = `https://accounts-${crypto.randomUUID()}.example.invalid`;
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "synthetic", alg: "ES256", use: "sig" };
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (new URL(String(input)).href === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${String(input)}`);
  });
  sign = ({ site: claimSite = site, scope = "ship:orders", audience: claimAudience = audience, age = 0 } = {}) =>
    new SignJWT({ site_id: claimSite, scope })
      .setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience(claimAudience)
      .setSubject("synthetic-business").setIssuedAt(Math.floor(Date.now() / 1000) - age)
      .setExpirationTime(Math.floor(Date.now() / 1000) - age + 300).sign(privateKey);
});
afterEach(() => vi.restoreAllMocks());

async function call(method: string, path: string, body?: unknown, token?: string | null) {
  const bearer = token === undefined ? await sign() : token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await worker.fetch(new Request(`https://ship.example.invalid${path}`, {
    method, headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), configured());
  return { status: response.status, json: await response.json() as any };
}

const order = (overrides: Record<string, unknown> = {}) => ({
  schema: "dinkuskit.commerce.ship-order/v1",
  orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
  shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "CA", postalCode: "90000", country: "US" },
  email: "shopper@example.test", completed: null,
  lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 2, weightOz: 12.5, unitPrice: { currency: "USD", minor: "1250" } }],
  ...overrides,
});

const store = (siteId = site) => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(siteId));

test("the bare origin names the service and nothing else", async () => {
  const response = await worker.fetch(new Request("https://ship.example.invalid/"), configured());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("DinkusKit Ship service\n");
});

test("an unconfigured service refuses every Commerce call", async () => {
  const response = await worker.fetch(new Request("https://ship.example.invalid/v1/labels"), env as unknown as Env);
  expect(response.status).toBe(503);
  expect((await response.json() as any).error.code).toBe("NOT_CONFIGURED");
});

test("Commerce's example order is kept under the pass's store, with only the fields Ship uses", async () => {
  const sent = order({ phone: "not kept", total: { currency: "USD", minor: "2500" } });
  (sent.shipTo as Record<string, unknown>).company = "Ignored Co";
  expect(await call("POST", "/v1/orders", sent)).toEqual({ status: 200, json: { orderId: "order:abc", version: 1 } });
  const kept = await store().getOrder("order:abc");
  expect(kept).toEqual({
    orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
    shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "CA", postalCode: "90000", country: "US" },
    email: "shopper@example.test", completed: null,
    lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 2, weightOz: 12.5, unitPrice: { currency: "USD", minor: "1250" } }],
  });
  // Another store's pass never sees it.
  expect(await store(`other-${site}`).getOrder("order:abc")).toBeNull();
});

test("lines without a price, weight or region are kept: Commerce sends prices only after commerce#98", async () => {
  const sent = order({ number: null, email: null, lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 1 }] });
  delete (sent.shipTo as Record<string, unknown>).region;
  expect((await call("POST", "/v1/orders", sent)).status).toBe(200);
  const kept = await store().getOrder("order:abc");
  expect(kept?.lines).toEqual([{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 1 }]);
  expect(kept?.shipTo.region).toBeUndefined();
});

test("a newer version replaces the order, an older retry changes nothing, a repeat is still a success", async () => {
  expect((await call("POST", "/v1/orders", order({ version: 2 }))).json).toEqual({ orderId: "order:abc", version: 2 });
  expect((await call("POST", "/v1/orders", order({ version: 1, shipTo: { ...order().shipTo, line1: "Old Street" } }))).json)
    .toEqual({ orderId: "order:abc", version: 2 });
  expect((await store().getOrder("order:abc"))?.shipTo.line1).toBe("1 Example Way");
  const completed = order({ version: 3, status: "completed", completed: { at: "2026-10-10T20:00:00.000Z", carrier: "USPS", tracking: "9400" } });
  expect((await call("POST", "/v1/orders", completed)).status).toBe(200);
  expect((await call("POST", "/v1/orders", completed)).status).toBe(200);
  expect(await store().getOrder("order:abc")).toMatchObject({ version: 3, status: "completed", completed: { carrier: "USPS", tracking: "9400" } });
});

test("orders Ship can never label are 422, so Commerce waits for the order to change", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [order({ shipTo: { ...order().shipTo, country: "CA" } }), "NOT_SERVED"],
    [order({ schema: "dinkuskit.commerce.ship-order/v2" }), "INVALID_ORDER"],
    [order({ status: "shipped" }), "INVALID_ORDER"],
    [order({ status: "completed", completed: null }), "INVALID_ORDER"],
    [order({ completed: { at: "2026-10-10T20:00:00.000Z" } }), "INVALID_ORDER"],
    [order({ version: 0 }), "INVALID_ORDER"],
    [order({ test: "yes" }), "INVALID_ORDER"],
    [order({ shipTo: { ...order().shipTo, name: "Line\nbreak" } }), "INVALID_ORDER"],
    [order({ lines: [{ catalogItemId: "item_demo", name: "Mug", quantity: 0 }] }), "INVALID_ORDER"],
    [order({ lines: [{ catalogItemId: "item_demo", name: "Mug", quantity: 1, weightOz: -1 }] }), "INVALID_ORDER"],
    [order({ lines: [{ catalogItemId: "item_demo", name: "Mug", quantity: 1, unitPrice: { currency: "USD", minor: "12.50" } }] }), "INVALID_ORDER"],
    [order({ email: "not an email" }), "INVALID_ORDER"],
  ];
  for (const [body, code] of cases) {
    const answer = await call("POST", "/v1/orders", body);
    expect([answer.status, answer.json.error.code]).toEqual([422, code]);
  }
  expect(await store().getOrder("order:abc")).toBeNull();
});

test("labels are listed oldest first until Commerce acknowledges them, and repeats acknowledge cleanly", async () => {
  expect(await call("GET", "/v1/labels")).toEqual({ status: 200, json: [] });
  const first = await store().recordLabel({ orderId: "order:abc", version: 1, carrier: "USPS", tracking: "EXAMPLE-TRACKING-1" });
  const second = await store().recordLabel({ orderId: "order:def", version: 2, carrier: "USPS", tracking: "EXAMPLE-TRACKING-2" });
  expect((await call("GET", "/v1/labels")).json).toEqual([first, second]);
  expect(await call("POST", "/v1/labels/ack", { eventId: first.eventId })).toEqual({ status: 200, json: { eventId: first.eventId } });
  expect((await call("POST", "/v1/labels/ack", { eventId: first.eventId })).status).toBe(200);
  expect((await call("POST", "/v1/labels/ack", { eventId: "lbl_never_issued" })).status).toBe(200);
  expect((await call("GET", "/v1/labels")).json).toEqual([second]);
  expect((await call("POST", "/v1/labels/ack", { eventId: 7 })).status).toBe(400);
  // Another store has its own, empty list.
  expect((await call("GET", "/v1/labels", undefined, await sign({ site: `other-${site}` }))).json).toEqual([]);
});

test("Commerce reads at most 100 labels at a time", async () => {
  for (let index = 0; index < 101; index++) {
    await store().recordLabel({ orderId: `order:${index}`, version: 1, carrier: "USPS", tracking: `9400${index}` });
  }
  const listed = (await call("GET", "/v1/labels")).json;
  expect(listed).toHaveLength(100);
  expect(listed[0].orderId).toBe("order:0");
});

test("only a current ship:orders pass from DinkusKit.com for some store gets in", async () => {
  expect((await call("GET", "/v1/labels", undefined, null)).status).toBe(401);
  expect((await call("GET", "/v1/labels", undefined, "not-a-token")).status).toBe(401);
  expect((await call("GET", "/v1/labels", undefined, await sign({ audience: "dinkus-coupons" }))).status).toBe(401);
  expect((await call("GET", "/v1/labels", undefined, await sign({ age: 3600 }))).status).toBe(401);
  expect((await call("GET", "/v1/labels", undefined, await sign({ scope: "coupons:checkout" }))).status).toBe(403);
  expect((await call("GET", "/v1/labels", undefined, await sign({ site: 42 }))).status).toBe(403);
  expect((await call("GET", "/v1/labels", undefined, await sign({ site: "bad/site" }))).status).toBe(403);
});

test("requests Commerce never makes are refused before any store is touched", async () => {
  expect((await call("GET", "/v1/orders")).status).toBe(405);
  expect((await call("GET", "/v1/nothing")).status).toBe(404);
  expect((await call("POST", "/v1/orders", "{not json")).status).toBe(400);
  expect((await call("POST", "/v1/orders", JSON.stringify({ pad: "x".repeat(70 * 1024) }))).status).toBe(413);
});
