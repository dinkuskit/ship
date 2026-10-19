import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";
import { PRINT_LINK_SECONDS } from "../src/admin";

// What the Ship Registry plugin does with a ship:admin store pass: list orders, see
// prices, buy, print through a five-minute link, and cancel. Pitney Bowes's sandbox
// is stood in for, as in owner.spec.ts.

const ORIGIN = "https://ship.example.invalid";
const PB = "https://shipping-api-sandbox.pitneybowes.com";
const LABEL_URL = "https://stg-labels-cls.gcs.pitneybowes.com/usps/sample/outbound/label/sample.pdf";
const PB_PRICES: Record<string, number> = { UGA: 5.1, PM: 9.35, EM: 31.2 };
let site: string;
let issuer: string;
let privateKey: CryptoKey;
let sessionKey: string;
let pbCalls: { method: string; path: string; body: any }[];

const configured = () => ({
  ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: `${issuer}/jwks`,
  ACCOUNT_SIGNIN_URL: `${issuer}/ship-sign-in`, ACCOUNT_TOKEN_URL: `${issuer}/token`, SHIP_SESSION_SECRET: sessionKey,
}) as unknown as Env;

beforeEach(async () => {
  site = `site-${crypto.randomUUID()}`;
  issuer = `https://accounts-${crypto.randomUUID()}.example.invalid`;
  sessionKey = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "synthetic", alg: "ES256", use: "sig" };
  pbCalls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new Request(input, init).url;
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === LABEL_URL) return new Response("%PDF-1.4 sandbox label", { headers: { "content-type": "application/pdf" } });
    if (!url.startsWith(`${PB}/`)) throw new Error(`unexpected fetch ${url}`);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    const path = new URL(url).pathname, method = init?.method ?? "GET";
    pbCalls.push({ method, path, body });
    if (path === "/oauth/token") return Response.json({ access_token: "synthetic-pb-pass", tokenType: "BearerToken", expiresIn: 36000 });
    if (path === "/shippingservices/v1/rates") return Response.json({ rates: [{ ...body.rates[0], totalCarrierCharge: PB_PRICES[body.rates[0].serviceId], currencyCode: "USD" }] });
    if (path === "/shippingservices/v1/shipments" && method === "POST") return Response.json({
      shipmentId: "SANDBOX-SHIPMENT-A", parcelTrackingNumber: "SANDBOX-TRACKING-A",
      rates: [{ carrier: "USPS", serviceId: body.rates[0].serviceId, parcelType: "PKG", totalCarrierCharge: PB_PRICES[body.rates[0].serviceId], currencyCode: "USD" }],
      documents: [{ type: "SHIPPING_LABEL", contentType: "URL", fileFormat: "PDF", size: "DOC_8X11", contents: LABEL_URL }],
    });
    if (method === "DELETE" && path.startsWith("/shippingservices/v1/shipments/")) return Response.json({ carrier: "USPS", status: "INITIATED", totalCarrierCharge: 9.35 });
    throw new Error(`unexpected Pitney Bowes call ${method} ${path}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const pass = (scope: string, claimSite = site) => new SignJWT({ site_id: claimSite, scope })
  .setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience("dinkus-ship")
  .setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(privateKey);

async function call(method: string, path: string, options: { body?: unknown; scope?: string; site?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${await pass(options.scope ?? "ship:admin", options.site)}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }), configured());
  return { status: response.status, json: await response.json() as any };
}

const shipStore = () => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));

async function sendOrder(overrides: Record<string, unknown> = {}) {
  const { status } = await call("POST", "/v1/orders", { scope: "ship:orders", body: {
    schema: "dinkuskit.commerce.ship-order/v1", orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
    shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "California", postalCode: "90000", country: "US" },
    email: "shopper@example.test", completed: null,
    lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 2, weightOz: 12.5, unitPrice: { currency: "USD", minor: "1250" } }],
    ...overrides,
  } });
  expect(status).toBe(200);
}

/** The owner's one-time setup on Ship's own page: a ship-from address and a box. */
async function setUp(): Promise<string> {
  await shipStore().saveShipFrom({ name: "Demo Store", line1: "2 Warehouse Rd", city: "Shiptown", region: "ny", postalCode: "10001" });
  await shipStore().addBox({ name: "Small", lengthIn: "8", widthIn: "6", heightIn: "4", weightOz: "3" });
  const settings = await shipStore().getSettings();
  expect(settings.boxes).toHaveLength(1);
  return settings.boxes[0]!.boxId;
}

test("the admin routes take only a ship:admin pass, and Commerce's routes still take only ship:orders", async () => {
  expect((await call("GET", "/v1/admin/orders", { scope: "ship:orders" })).status).toBe(403);
  expect((await call("GET", "/v1/labels", { scope: "ship:admin" })).status).toBe(403);
  expect((await call("GET", "/v1/admin/orders")).json).toEqual({ orders: [], settings: { shipFrom: false, boxes: [], postageConnected: true, testSandbox: true } });
  expect((await call("DELETE", "/v1/admin/orders")).status).toBe(405);
  expect((await call("GET", "/v1/admin/orders/nope")).json.error.code).toBe("NOT_FOUND");
  expect((await call("POST", "/v1/admin/labels/nope/print-link")).json.error.code).toBe("NOT_FOUND");
});

test("the plugin sees the order, prices it, buys a sandbox label, prints it through a five-minute link, and cancels it", async () => {
  await sendOrder();
  const before = await call("GET", "/v1/admin/orders");
  expect(before.json.orders).toMatchObject([{ orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
    shipTo: { name: "Demo Shopper", lines: ["1 Example Way"], city: "Testville", region: "California", postalCode: "90000" },
    addressProblem: null, lines: [{ name: "Demo Mug", quantity: 2, weightOz: 12.5 }], itemsWeightOz: 25, label: null, labels: [] }]);
  expect(before.json.settings.shipFrom).toBe(false);
  // Nothing from the owner's PB account crosses to the plugin.
  expect(Object.keys(before.json.settings).sort()).toEqual(["boxes", "postageConnected", "shipFrom", "testSandbox"]);

  const boxId = await setUp();
  const form = { version: 1, boxId, weightOz: 28 };
  const prices = await call("POST", "/v1/admin/orders/order%3Aabc/prices", { body: form });
  expect(prices.status).toBe(200);
  expect(prices.json).toEqual({ prices: { GA: 510, PM: 935, EM: 3120 } });

  expect((await call("POST", "/v1/admin/orders/order%3Aabc/labels", { body: { ...form, service: "PM" } })).json.error.code).toBe("INVALID_INPUT");
  const bought = await call("POST", "/v1/admin/orders/order%3Aabc/labels", { body: { ...form, service: "PM", by: "staff@example.test" } });
  expect(bought.status).toBe(201);
  expect(bought.json.label).toMatchObject({ orderId: "order:abc", version: 1, test: true, practice: false, service: "PM", tracking: "SANDBOX-TRACKING-A", status: "bought", priceCents: 935, createdBy: "admin:staff@example.test" });
  expect(pbCalls.filter(c => c.method === "POST" && c.path === "/shippingservices/v1/shipments")).toHaveLength(1);
  // Commerce picks the label up exactly as it does from Ship's own page.
  expect((await call("GET", "/v1/labels", { scope: "ship:orders" })).json).toMatchObject([{ orderId: "order:abc", version: 1, carrier: "USPS", tracking: "SANDBOX-TRACKING-A" }]);
  const shown = await call("GET", "/v1/admin/orders/order%3Aabc");
  expect(shown.json.order.label.labelId).toBe(bought.json.label.labelId);
  expect((await call("POST", "/v1/admin/orders/order%3Aabc/labels", { body: { ...form, service: "PM", by: "staff@example.test" } })).json.error.code).toBe("ALREADY_LABELED");

  const link = await call("POST", `/v1/admin/labels/${bought.json.label.labelId}/print-link`);
  expect(link.status).toBe(200);
  expect(link.json.url).toMatch(new RegExp(`^${ORIGIN}/print/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`));
  expect(Date.parse(link.json.expiresAt) - Date.now()).toBeGreaterThan((PRINT_LINK_SECONDS - 5) * 1000);
  const pdf = await worker.fetch(new Request(link.json.url), configured());
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect(pdf.headers.get("cache-control")).toBe("private, no-store");
  expect(await pdf.text()).toBe("%PDF-1.4 sandbox label");

  const cancelled = await call("POST", `/v1/admin/labels/${bought.json.label.labelId}/cancel`);
  expect(cancelled.json).toEqual({ labelId: bought.json.label.labelId, refund: "INITIATED" });
  expect(pbCalls.find(c => c.method === "DELETE")!.path).toBe("/shippingservices/v1/shipments/SANDBOX-SHIPMENT-A");
  const after = await call("GET", "/v1/admin/orders/order%3Aabc");
  expect(after.json.order.label).toBeNull();
  expect(after.json.order.labels).toMatchObject([{ status: "cancelled", refund: "INITIATED" }]);
  expect((await call("POST", `/v1/admin/labels/${bought.json.label.labelId}/cancel`)).json.error.code).toBe("NOT_FOUND");
});

test("a print link opens only while it lasts, only for a link Ship made, and only one label", async () => {
  await sendOrder();
  const boxId = await setUp();
  const bought = await call("POST", "/v1/admin/orders/order%3Aabc/labels", { body: { version: 1, boxId, weightOz: 28, service: "GA", kind: "practice", by: "staff@example.test" } });
  expect(bought.json.label).toMatchObject({ practice: true, priceCents: null });
  const { url } = (await call("POST", `/v1/admin/labels/${bought.json.label.labelId}/print-link`)).json;
  const open = (href: string, settings = configured()) => worker.fetch(new Request(href), settings);
  expect((await open(url)).status).toBe(200);
  expect((await open(`${url}x`)).status).toBe(410);
  // Not after it expires: the clock moves past five minutes.
  const now = Date.now;
  Date.now = () => now() + (PRINT_LINK_SECONDS + 1) * 1000;
  try { expect((await open(url)).status).toBe(410); } finally { Date.now = now; }
  // Not for a Worker with another session secret.
  expect((await open(url, { ...configured(), SHIP_SESSION_SECRET: `${crypto.randomUUID()}${crypto.randomUUID()}` })).status).toBe(410);
  // A session cookie's payload is not a print link, even when signed with the same secret.
  const [payload] = new URL(url).pathname.slice("/print/".length).split(".");
  expect(JSON.parse(atob(payload!.replaceAll("-", "+").replaceAll("_", "/")))).toMatchObject({ kind: "print", site, labelId: bought.json.label.labelId });
  expect((await worker.fetch(new Request(`${ORIGIN}/print/`), configured())).status).toBe(410);
  // Without the session secret Ship can mint no links.
  const unconfigured = await worker.fetch(new Request(`${ORIGIN}/v1/admin/labels/${bought.json.label.labelId}/print-link`, {
    method: "POST", headers: { authorization: `Bearer ${await pass("ship:admin")}` },
  }), { ...configured(), SHIP_SESSION_SECRET: "" });
  expect(unconfigured.status).toBe(503);
});

test("a pass for another store sees nothing of this one", async () => {
  await sendOrder();
  expect((await call("GET", "/v1/admin/orders", { site: `other-${site}` })).json.orders).toEqual([]);
  expect((await call("GET", "/v1/admin/orders/order%3Aabc", { site: `other-${site}` })).status).toBe(404);
});

test("bad label input is refused before Pitney Bowes hears of it", async () => {
  await sendOrder();
  const boxId = await setUp();
  for (const body of [[], "x", { version: "1\n", boxId, weightOz: 28 }, { version: 1, boxId: { a: 1 }, weightOz: 28 }, { version: 1, boxId, weightOz: "lots" }]) {
    const { status, json } = await call("POST", "/v1/admin/orders/order%3Aabc/prices", { body });
    expect([status, json.error.code]).toEqual([400, "INVALID_INPUT"]);
  }
  expect((await call("POST", "/v1/admin/orders/order%3Aabc/prices", { body: { version: 2, boxId, weightOz: 28 } })).json.error.code).toBe("ORDER_CHANGED");
  expect(pbCalls).toEqual([]);
});
