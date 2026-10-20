import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";
import { trackingIndex } from "../src/tracking";
import { pitneyConfig } from "../src/pitney";
import { addLabelColumns, addPurchaseColumns } from "../src/store";

const ORIGIN = "https://ship.example.invalid";
let site: string;
let issuer: string;
let sessionKey: string;
let privateKey: CryptoKey;
let signingKey: CryptoKey;
let ownerClaims: Record<string, unknown>;
let tokenAnswer: (body: Record<string, string>) => Promise<Response>;
let refreshes: number;
let jwksUrl: string;
/** Per-test changes to the Worker's settings, such as Pitney Bowes being off. */
let envOverrides: Record<string, unknown>;

const PB = "https://shipping-api-sandbox.pitneybowes.com";
const LABEL_URL = "https://stg-labels-cls.gcs.pitneybowes.com/usps/sample/outbound/label/sample.pdf";
const PB_PRICES: Record<string, number> = { UGA: 5.1, PM: 9.35, EM: 31.2 };
interface PbCall { method: string; url: URL; headers: Headers; body: any }
let pbCalls: PbCall[];
/** The stand-in Pitney Bowes sandbox; a test swaps in its own answer for one route. */
let pbAnswer: (call: PbCall) => Response | Promise<Response>;
const sandbox = (call: PbCall): Response => {
  const route = `${call.method} ${call.url.pathname}`;
  if (route === "POST /oauth/token") return Response.json({ access_token: "synthetic-pb-pass", tokenType: "BearerToken", expiresIn: 36000 });
  if (route === "POST /shippingservices/v1/rates") return Response.json({ rates: [{ ...call.body.rates[0], totalCarrierCharge: PB_PRICES[call.body.rates[0].serviceId], currencyCode: "USD" }] });
  if (route === "POST /shippingservices/v1/shipments") return Response.json(pbLabel(call.body.rates[0].serviceId));
  if (route === "GET /shippingservices/v1/shipments") return Response.json({ errors: [{ errorCode: "PB-SHIPMENT-NOT-FOUND", message: "not found" }] }, { status: 404 });
  if (call.method === "DELETE" && call.url.pathname.startsWith("/shippingservices/v1/shipments/")) return Response.json({ carrier: "USPS", status: "INITIATED", totalCarrierCharge: 9.35 });
  if (route === "POST /shippingservices/v1/developers/synthetic-developer/merchants/credentials") {
    if (call.body.username !== "owner@example.test" || call.body.password !== "not-a-real-login") {
      return Response.json({ errors: [{ errorCode: "PB-SYNTHETIC", message: "Invalid credentials" }] }, { status: 401 });
    }
    return Response.json(merchant);
  }
  if (call.url.href === LABEL_URL) return new Response("%PDF-1.4 sandbox label", { headers: { "content-type": "application/pdf" } });
  throw new Error(`unexpected Pitney Bowes call ${route}`);
};
/** The store owner's own PB postage account, as PB describes it after they sign up. */
let merchant: Record<string, unknown>;
const ownMerchant = () => ({
  company: "Demo Store", fullName: "Demo Owner", email: "owner@example.test", developerId: "synthetic-developer",
  merchantStatus: "ACTIVE", merchantStatusReason: null, merchantType: "INDIVIDUAL", paymentAccountNumber: "SANDBOX-ACCT-0042",
  paymentServicesAccountId: "synthetic-payments", paymentServicesAccountIdActive: true, postalReportingNumber: "SANDBOX-OWNER-SHIPPER",
});
const pbLabel = (serviceId: string) => ({
  shipmentId: "SANDBOX-SHIPMENT-A", parcelTrackingNumber: "SANDBOX-TRACKING-A",
  rates: [{ carrier: "USPS", serviceId, parcelType: "PKG", totalCarrierCharge: PB_PRICES[serviceId], currencyCode: "USD" }],
  documents: [{ type: "SHIPPING_LABEL", contentType: "URL", fileFormat: "PDF", size: "DOC_8X11", contents: LABEL_URL }],
});

const configured = () => ({
  ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: jwksUrl,
  ACCOUNT_SIGNIN_URL: `${issuer}/ship-sign-in`, ACCOUNT_TOKEN_URL: `${issuer}/token`, SHIP_SESSION_SECRET: sessionKey, ...envOverrides,
}) as unknown as Env;

const pass = (claims: Record<string, unknown>) => new SignJWT(claims)
  .setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience("dinkus-ship")
  .setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(signingKey);

beforeEach(async () => {
  site = `site-${crypto.randomUUID()}`;
  issuer = `https://accounts-${crypto.randomUUID()}.example.invalid`;
  jwksUrl = `${issuer}/jwks`;
  sessionKey = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  signingKey = privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "synthetic", alg: "ES256", use: "sig" };
  ownerClaims = { site_id: site, scope: "ship:labels", uid: "user-1", email: "owner@example.test" };
  refreshes = 0;
  pbCalls = [];
  pbAnswer = sandbox;
  merchant = ownMerchant();
  envOverrides = {};
  tokenAnswer = async () => Response.json({ access_token: await pass(ownerClaims), token_type: "Bearer", expires_in: 300, refresh_token: `refresh-${++refreshes}-${"r".repeat(40)}` });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    // Validate options with workerd itself; a pure fetch stub hides unsupported modes.
    const nativeRequest = new Request(input, init);
    const url = nativeRequest.url;
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/jwks-down`) return new Response("busy", { status: 503 });
    if (url === `${issuer}/token`) return tokenAnswer(JSON.parse(String(init?.body)));
    if (url.startsWith(`${PB}/`) || url === LABEL_URL) {
      const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
      const call = { method: init?.method ?? "GET", url: new URL(url), headers: new Headers(init?.headers), body };
      pbCalls.push(call);
      return pbAnswer(call);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

function cookies(response: Response): string {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("=")).join("; ");
}

async function request(method: string, path: string, options: { cookie?: string; form?: Record<string, string>; origin?: string | null; from?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.from) headers["sec-fetch-site"] = options.from;
  if (options.form) headers["content-type"] = "application/x-www-form-urlencoded";
  if (method === "POST" && options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, redirect: "manual", ...(options.form ? { body: new URLSearchParams(options.form).toString() } : {}),
  }), configured());
}

/** Runs the whole Sign in with DinkusKit.com round trip and returns Ship's session cookie. */
async function signIn(path = `/stores/${site}/orders`) {
  const start = await request("GET", path);
  expect(start.status).toBe(303);
  const target = new URL(start.headers.get("location")!);
  expect(`${target.origin}${target.pathname}`).toBe(`${issuer}/ship-sign-in`);
  expect(target.searchParams.get("site_id")).toBe(site);
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  const back = await request("GET", `/auth/callback?code=one-time&state=${target.searchParams.get("state")}`, { cookie: cookies(start) });
  return { back, start, target };
}

async function signedIn() {
  const { back } = await signIn();
  expect(back.status).toBe(303);
  return cookies(back);
}

async function sendOrder(overrides: Record<string, unknown> = {}) {
  const token = await new SignJWT({ site_id: site, scope: "ship:orders" }).setProtectedHeader({ alg: "ES256", kid: "synthetic" })
    .setIssuer(issuer).setAudience("dinkus-ship").setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const response = await worker.fetch(new Request(`${ORIGIN}/v1/orders`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      schema: "dinkuskit.commerce.ship-order/v1", orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
      shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "California", postalCode: "90000", country: "US" },
      email: "shopper@example.test", completed: null,
      lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 2, weightOz: 12.5, unitPrice: { currency: "USD", minor: "1250" } }],
      ...overrides,
    }),
  }), configured());
  expect(response.status).toBe(200);
}

async function labels() {
  const token = await new SignJWT({ site_id: site, scope: "ship:orders" }).setProtectedHeader({ alg: "ES256", kid: "synthetic" })
    .setIssuer(issuer).setAudience("dinkus-ship").setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return (await worker.fetch(new Request(`${ORIGIN}/v1/labels`, { headers: { authorization: `Bearer ${token}` } }), configured())).json() as Promise<any[]>;
}

async function setUp(cookie: string) {
  expect((await request("POST", `/stores/${site}/settings/ship-from`, { cookie, form: { name: "Demo Store", line1: "2 Warehouse Rd", city: "Shiptown", region: "ny", postalCode: "10001" } })).status).toBe(303);
  expect((await request("POST", `/stores/${site}/settings/boxes`, { cookie, form: { name: "Small", lengthIn: "8", widthIn: "6", heightIn: "4", weightOz: "3" } })).status).toBe(303);
  const settings = await env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site)).getSettings();
  return settings.boxes[0]!.boxId;
}

test("the label page is unreachable until Ship's sign-in is configured", async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/stores/${site}/orders`), env as unknown as Env);
  expect(response.status).toBe(503);
});

test("signing in goes through DinkusKit.com with PKCE and comes back to the page first asked for", async () => {
  let traded: { code: string; code_verifier: string } | undefined;
  tokenAnswer = async body => {
    traded = body as typeof traded;
    return Response.json({ access_token: await pass(ownerClaims), refresh_token: "r".repeat(40) });
  };
  const { back, target } = await signIn(`/stores/${site}/settings`);
  expect(back.status).toBe(303);
  expect(back.headers.get("location")).toBe(`/stores/${site}/settings`);
  expect(back.headers.getSetCookie().join("\n")).toMatch(/__Host-ship-session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax/);
  const challenge = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(traded!.code_verifier)));
  expect(btoa(String.fromCharCode(...challenge)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")).toBe(target.searchParams.get("code_challenge"));
  expect(traded!.code).toBe("one-time");
  const settings = await env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site)).getSettings();
  // The first sign-in fills the reply-to address; the store name comes with Commerce's orders.
  expect([settings.storeName, settings.replyTo]).toEqual([null, "owner@example.test"]);
  const page = await request("GET", `/stores/${site}/settings`, { cookie: cookies(back) });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("owner@example.test");
});

test("a callback without the browser's sign-in cookie offers to start again", async () => {
  const response = await request("GET", "/auth/callback?code=one-time&state=elsewhere");
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("Start again");
});

test("DinkusKit.com's refusals and bad passes never start a session", async () => {
  const start = await request("GET", `/stores/${site}/orders`);
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const refused = await request("GET", `/auth/callback?error=ship_not_enabled&state=${state}`, { cookie: cookies(start) });
  expect(refused.status).toBe(403);
  expect(await refused.text()).toContain("Ship is turned off for this store");
  expect(refused.headers.getSetCookie().join()).not.toContain("ship-session=");
  for (const claims of [{ ...ownerClaims, site_id: "another-store" }, { ...ownerClaims, scope: "ship:orders" }, { ...ownerClaims, uid: undefined }]) {
    ownerClaims = claims;
    const { back } = await signIn();
    expect(back.status).toBe(502);
    expect(back.headers.getSetCookie().join()).not.toContain("ship-session=");
  }
  tokenAnswer = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  expect((await signIn()).back.status).toBe(502);
});

test("a session is for one store only, and a forged cookie is ignored", async () => {
  const cookie = await signedIn();
  expect((await request("GET", `/stores/other-${site}/orders`, { cookie })).status).toBe(303);
  // A well-formed session for this store whose signature was not made with Ship's secret.
  // It names the real session, so only the signature check can refuse it.
  const genuine = JSON.parse(atob(cookie.split("=")[1]!.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"))) as { sessionId: string };
  const payload = btoa(JSON.stringify({ site, sessionId: genuine.sessionId, exp: Math.floor(Date.now() / 1000) + 600 }))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const forged = cookie.replace(/=([^.]+)\./, `=${payload}.`);
  expect(forged).not.toBe(cookie);
  expect((await request("GET", `/stores/${site}/orders`, { cookie: forged })).status).toBe(303);
});

test("a TEST order goes from Commerce to a practice label, when the owner asks for one, to a label event Commerce picks up", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const list = await request("GET", `/stores/${site}/orders`, { cookie });
  expect(await list.text()).toContain("#1001");
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const page = await (await request("GET", orderPath, { cookie })).text();
  expect(page).toContain('name="kind" value="practice"');
  expect(page).toContain('value="28"'); // 2 × 12.5 oz plus the 3 oz box
  expect(page).toContain("$12.50");
  const bought = await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA", kind: "practice" } });
  expect(bought.status).toBe(303);
  const [event] = await labels();
  expect(event).toMatchObject({ orderId: "order:abc", version: 1, carrier: "USPS" });
  expect(event.tracking).toMatch(/^TEST\d{18}$/);
  const summary = await env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site)).orderSummary("order:abc");
  const label = summary!.labels[0]!;
  const pdf = await request("GET", `/stores/${site}/labels/${label.labelId}.pdf`, { cookie });
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  const text = await pdf.text();
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text).toContain("TEST - NOT POSTAGE");
  expect(text).toContain("TO: Demo Shopper");
  expect(label).toMatchObject({ test: true, practice: true, priceCents: null });
  expect(await (await request("GET", orderPath, { cookie })).text()).toContain("PRACTICE");
  const again = await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA", kind: "practice" } });
  expect(again.status).toBe(409);
  expect((await request("POST", `/stores/${site}/labels/${label.labelId}/cancel`, { cookie })).status).toBe(303);
  expect((await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM", kind: "practice" } })).status).toBe(303);
  expect(await labels()).toHaveLength(2);
  expect(pbCalls).toEqual([]);
});

test("a TEST order gets a free Pitney Bowes sandbox label that stays TEST, shows sandbox prices, and cancels with a void", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const page = await (await request("GET", orderPath, { cookie })).text();
  expect(page).toContain("free Pitney Bowes sandbox label");
  expect(page).toContain("Make sandbox label");
  expect(page).not.toContain("Postage is paid from your Pitney Bowes postage account");
  const form = { version: "1", boxId, weightOz: "28", service: "PM" };
  const prices = await request("POST", `${orderPath}/prices`, { cookie, form });
  expect(prices.status).toBe(200);
  expect(await prices.text()).toContain("USPS Priority Mail: $9.35");

  expect((await request("POST", `${orderPath}/labels`, { cookie, form })).status).toBe(303);
  expect(creates()).toHaveLength(1);
  expect(creates()[0]!.url.origin).toBe(PB);
  expect(await labels()).toMatchObject([{ orderId: "order:abc", version: 1, carrier: "USPS", tracking: "SANDBOX-TRACKING-A" }]);
  const label = (await shipStore().orderSummary("order:abc"))!.labels[0]!;
  expect(label).toMatchObject({ test: true, practice: false, priceCents: 935, status: "bought" });
  expect(await (await request("GET", `/stores/${site}/labels/${label.labelId}.pdf`, { cookie })).text()).toBe("%PDF-1.4 sandbox label");
  const withLabel = await (await request("GET", orderPath, { cookie })).text();
  expect(withLabel).toContain("TEST SANDBOX");
  expect(withLabel).toContain("(sandbox, not charged)");

  expect((await request("POST", `/stores/${site}/labels/${label.labelId}/cancel`, { cookie })).status).toBe(303);
  expect(pbCalls.find(call => call.method === "DELETE")!.url.pathname).toBe("/shippingservices/v1/shipments/SANDBOX-SHIPMENT-A");
  expect((await shipStore().orderSummary("order:abc"))!.labels[0]).toMatchObject({ test: true, status: "cancelled", refund: "INITIATED" });
  expect(await (await request("GET", orderPath, { cookie })).text()).not.toContain("USPS refunds your postage account");
});

test("Ground Advantage and Priority Mail ask Pitney Bowes for USPS Tracking, which Express already has", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  // "See prices" asks Pitney Bowes about every service Ship offers.
  expect((await request("POST", `${orderPath}/prices`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA" } })).status).toBe(200);
  // Without a trackable service PB refuses the package ("must be trackable", error 1022026).
  expect(pbCalls.filter(call => call.url.pathname === "/shippingservices/v1/rates").map(call => call.body.rates[0])).toEqual([
    { carrier: "USPS", serviceId: "UGA", parcelType: "PKG", specialServices: [{ specialServiceId: "DelCon" }] },
    { carrier: "USPS", serviceId: "PM", parcelType: "PKG", specialServices: [{ specialServiceId: "DelCon" }] },
    { carrier: "USPS", serviceId: "EM", parcelType: "PKG" },
  ]);
});

test("a TEST order whose sandbox answer was lost stays TEST when Ship finds the label", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const buy = () => request("POST", `/stores/${site}/orders/${encodeURIComponent("order:abc")}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM" } });
  pbAnswer = call => {
    if (call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments") throw new Error("connection reset");
    if (call.method === "GET" && call.url.pathname === "/shippingservices/v1/shipments") return Response.json(pbLabel("PM"));
    return sandbox(call);
  };
  expect((await buy()).status).toBe(502);
  const practice = await request("POST", `/stores/${site}/orders/${encodeURIComponent("order:abc")}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM", kind: "practice" } });
  expect(practice.status).toBe(409);
  expect((await buy()).status).toBe(303);
  expect((await shipStore().orderSummary("order:abc"))!.labels).toMatchObject([{ test: true, practice: false }]);
});

test("a TEST order never reaches Pitney Bowes unless Ship runs on its sandbox with every key set", async () => {
  for (const off of [{ PB_ENVIRONMENT: "production" }, { PB_SHIPPER_ID: "" }]) {
    envOverrides = off;
    site = `site-${crypto.randomUUID()}`;
    ownerClaims = { ...ownerClaims, site_id: site };
    // The store's Durable Object reads its own settings, not the Worker's.
    await runInDurableObject(shipStore(), instance => {
      const store = instance as unknown as { env: Env };
      store.env = { ...store.env, ...off };
    });
    await sendOrder();
    const cookie = await signedIn();
    const boxId = await setUp(cookie);
    const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
    const page = await (await request("GET", orderPath, { cookie })).text();
    expect(page).toContain("Ship makes a practice label");
    expect(page).not.toContain("Make sandbox label");
    const form = { version: "1", boxId, weightOz: "28", service: "GA" };
    expect((await request("POST", `${orderPath}/prices`, { cookie, form })).status).toBe(409);
    expect((await request("POST", `${orderPath}/labels`, { cookie, form })).status).toBe(303);
    expect((await shipStore().orderSummary("order:abc"))!.labels).toMatchObject([{ test: true, practice: true }]);
  }
  expect(pbCalls).toEqual([]);
});

test("labels are refused for a changed, unaddressable or completed order", async () => {
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const buy = (form: Record<string, string> = {}) => request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "20", service: "GA", ...form } });
  await sendOrder();
  await sendOrder({ version: 2, shipTo: { name: "A", line1: "B", city: "C", postalCode: "00901", country: "US", region: "PR" } });
  expect((await buy()).status).toBe(409);
  expect(await (await buy({ version: "2" })).text()).toContain("customs forms");
  await sendOrder({ version: 3, status: "completed", completed: { at: "2026-10-10T20:00:00.000Z" } });
  expect(await (await buy({ version: "3" })).text()).toContain("already Completed");
  expect(await labels()).toEqual([]);
});

test("forms from anywhere but Ship's own pages are refused", async () => {
  const cookie = await signedIn();
  for (const origin of [null, "https://evil.example.invalid"]) {
    const response = await request("POST", `/stores/${site}/settings/boxes`, { cookie, origin, form: { name: "Big", lengthIn: "1", widthIn: "1", heightIn: "1", weightOz: "1" } });
    expect(response.status).toBe(403);
  }
  expect((await env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site)).getSettings()).boxes).toEqual([]);
});

test("settings explain what is wrong instead of saving it", async () => {
  const cookie = await signedIn();
  const bad = await request("POST", `/stores/${site}/settings/ship-from`, { cookie, form: { name: "Demo", line1: "1 Road", city: "Town", region: "Atlantis", postalCode: "10001" } });
  expect(bad.status).toBe(400);
  expect(await bad.text()).toContain("The address has no US state.");
  const box = await request("POST", `/stores/${site}/settings/boxes`, { cookie, form: { name: "Huge", lengthIn: "500", widthIn: "1", heightIn: "1", weightOz: "1" } });
  expect(await box.text()).toContain("Length (in) must be a number from 0.1 to 108.");
});

test("page text from Commerce is escaped", async () => {
  await sendOrder({ lines: [{ catalogItemId: "x", name: "<script>alert(1)</script>", quantity: 1 }] });
  const cookie = await signedIn();
  const page = await (await request("GET", `/stores/${site}/orders/${encodeURIComponent("order:abc")}`, { cookie })).text();
  expect(page).not.toContain("<script>alert");
  expect(page).toContain("&lt;script&gt;");
});

const shipStore = () => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));

/** Moves every session's last check with DinkusKit.com back by this many seconds. */
async function age(seconds: number) {
  await runInDurableObject(shipStore(), async (_, state) => {
    state.storage.sql.exec("UPDATE sessions SET checked_at = checked_at - ?", seconds);
  });
}

test("Ship stays signed in by checking with DinkusKit.com every few minutes", async () => {
  const cookie = await signedIn();
  const sent: Record<string, string>[] = [];
  const answer = tokenAnswer;
  tokenAnswer = async body => (sent.push(body), answer(body));
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).headers.getSetCookie()).toEqual([]);
  expect(sent).toEqual([]);
  await age(6 * 60);
  const checked = await request("GET", `/stores/${site}/orders`, { cookie });
  expect(checked.status).toBe(200);
  expect(checked.headers.getSetCookie().join()).toContain("__Host-ship-session=");
  expect(sent).toEqual([{ grant_type: "refresh_token", refresh_token: `refresh-1-${"r".repeat(40)}` }]);
  // DinkusKit.com hands out a new refresh token each time; the next check uses it.
  await age(6 * 60);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(200);
  expect(sent[1]!.refresh_token).toBe(`refresh-2-${"r".repeat(40)}`);
});

test("signing out of DinkusKit.com, or losing access, signs Ship out at the next check", async () => {
  const cookie = await signedIn();
  await age(6 * 60);
  tokenAnswer = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
  tokenAnswer = async () => { throw new Error("no second check: the session is gone"); };
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

test("a pass for another person never continues the session", async () => {
  const cookie = await signedIn();
  await age(6 * 60);
  ownerClaims = { ...ownerClaims, uid: "user-2" };
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

test("while DinkusKit.com is down Ship waits up to 20 minutes, then asks for sign-in", async () => {
  const cookie = await signedIn();
  tokenAnswer = async () => new Response("busy", { status: 503 });
  await age(6 * 60);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(200);
  await age(15 * 60);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

test("signing out of Ship ends the session even for a copied cookie", async () => {
  const cookie = await signedIn();
  const out = await request("POST", "/auth/sign-out", { cookie });
  expect(out.status).toBe(200);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

test("the shipped email's reply-to is the owner's to change, and the sender name is the store's Site title", async () => {
  await sendOrder({ storeName: "  Demo Site Title  " });
  const cookie = await signedIn();
  const bad = await request("POST", `/stores/${site}/settings/reply-to`, { cookie, form: { replyTo: "not an email" } });
  expect(bad.status).toBe(400);
  expect((await request("POST", `/stores/${site}/settings/reply-to`, { cookie, form: { replyTo: "help@example.test" } })).status).toBe(303);
  const settings = await shipStore().getSettings();
  expect([settings.storeName, settings.replyTo]).toEqual(["Demo Site Title", "help@example.test"]);
  // A later sign-in keeps what the owner chose.
  await signedIn();
  expect((await shipStore().getSettings()).replyTo).toBe("help@example.test");
  expect(await (await request("GET", `/stores/${site}/settings`, { cookie })).text()).toContain("Demo Site Title");
});

test("a key set DinkusKit.com cannot serve right now keeps the session in its grace window", async () => {
  const cookie = await signedIn();
  await age(6 * 60);
  jwksUrl = `${issuer}/jwks-down`;
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(200);
  await age(15 * 60);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

test("a pass DinkusKit.com did not sign ends the session at the next check", async () => {
  const cookie = await signedIn();
  await age(6 * 60);
  signingKey = (await generateKeyPair("ES256")).privateKey;
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
  signingKey = privateKey;
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(303);
});

const creates = () => pbCalls.filter(call => call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments");

const connect = (cookie: string, form = { username: "owner@example.test", password: "not-a-real-login" }) =>
  request("POST", `/stores/${site}/settings/postage`, { cookie, form });

async function liveOrder() {
  await sendOrder({ test: false });
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  expect((await connect(cookie)).status).toBe(303);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const buy = (form: Record<string, string> = {}) => request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM", ...form } });
  return { cookie, boxId, orderPath, buy };
}

test("a real order's label is bought from the store's Pitney Bowes postage account and can be cancelled for a refund", async () => {
  const { cookie, boxId, orderPath, buy } = await liveOrder();
  const prices = await request("POST", `${orderPath}/prices`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM" } });
  expect(prices.status).toBe(200);
  const pricePage = await prices.text();
  expect(pricePage).toContain("USPS Ground Advantage: $5.10");
  expect(pricePage).toContain("USPS Priority Mail: $9.35");
  expect(pricePage).toContain("USPS Priority Mail Express: $31.20");
  expect(pricePage).toMatch(/<option value="PM" selected>/);

  expect((await buy()).status).toBe(303);
  const [create] = creates();
  expect(create!.headers.get("x-pb-transactionid")).toMatch(/^shp[a-z0-9]{22}$/);
  expect(create!.headers.get("authorization")).toBe("Bearer synthetic-pb-pass");
  // The store's own postage account pays, never the sandbox test merchant DinkusKit holds.
  expect(create!.body.shipmentOptions).toEqual([{ name: "SHIPPER_ID", value: "SANDBOX-OWNER-SHIPPER" }]);
  expect(create!.body.rates).toEqual([{ carrier: "USPS", serviceId: "PM", parcelType: "PKG", specialServices: [{ specialServiceId: "DelCon" }] }]);
  expect(create!.body.parcel).toEqual({ weight: { unitOfMeasurement: "OZ", weight: 28 }, dimension: { unitOfMeasurement: "IN", length: 8, width: 6, height: 4 } });
  expect(create!.body.fromAddress).toMatchObject({ name: "Demo Store", stateProvince: "NY", postalCode: "10001", countryCode: "US" });
  expect(create!.body.toAddress).toMatchObject({ name: "Demo Shopper", addressLines: ["1 Example Way"], stateProvince: "CA", postalCode: "90000" });
  expect(await labels()).toMatchObject([{ orderId: "order:abc", version: 1, carrier: "USPS", tracking: "SANDBOX-TRACKING-A" }]);

  const label = (await shipStore().orderSummary("order:abc"))!.labels[0]!;
  expect(label).toMatchObject({ test: false, priceCents: 935, status: "bought", delivery: null });
  // A live label's number is in the tracking index, so Pitney Bowes's updates find this store.
  expect(await trackingIndex(env as unknown as Env).find("SANDBOX-TRACKING-A")).toEqual({ tracking: "SANDBOX-TRACKING-A", site, labelId: label.labelId });
  const pdf = await request("GET", `/stores/${site}/labels/${label.labelId}.pdf`, { cookie });
  expect(await pdf.text()).toBe("%PDF-1.4 sandbox label");
  expect(pbCalls.filter(call => call.url.href === LABEL_URL)).toHaveLength(1);
  expect(await (await request("GET", orderPath, { cookie })).text()).toContain("$9.35");
  expect((await buy()).status).toBe(409);

  expect((await request("POST", `/stores/${site}/labels/${label.labelId}/cancel`, { cookie })).status).toBe(303);
  const cancel = pbCalls.find(call => call.method === "DELETE")!;
  expect(cancel.url.pathname).toBe("/shippingservices/v1/shipments/SANDBOX-SHIPMENT-A");
  expect(cancel.url.searchParams.get("cancelInitiator")).toBe("SHIPPER");
  expect((await shipStore().orderSummary("order:abc"))!.labels[0]).toMatchObject({ status: "cancelled", refund: "INITIATED" });
  expect(await trackingIndex(env as unknown as Env).find("SANDBOX-TRACKING-A")).toBeNull();
  expect(await (await request("GET", orderPath, { cookie })).text()).toContain("USPS refunds your postage account");
});

test("Pitney Bowes refusing a label buys nothing and tells the owner why", async () => {
  const { buy } = await liveOrder();
  pbAnswer = call => call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments"
    ? Response.json({ errors: [{ errorCode: "PB-SYNTHETIC", message: "Insufficient funds in the postage account." }] }, { status: 400 })
    : sandbox(call);
  const refused = await buy();
  expect(refused.status).toBe(422);
  expect(await refused.text()).toContain("Pitney Bowes said: Insufficient funds in the postage account.");
  expect(await labels()).toEqual([]);
  pbAnswer = sandbox;
  expect((await buy()).status).toBe(303);
  expect(creates()).toHaveLength(2);
});

test("when Pitney Bowes's answer is lost, Ship finds the label it bought instead of buying again", async () => {
  const { buy } = await liveOrder();
  pbAnswer = call => {
    if (call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments") throw new Error("connection reset");
    if (call.method === "GET" && call.url.pathname === "/shippingservices/v1/shipments") return Response.json(pbLabel("PM"));
    return sandbox(call);
  };
  const lost = await buy();
  expect(lost.status).toBe(502);
  expect(await lost.text()).toContain("does not buy a second label without asking");
  expect(await labels()).toEqual([]);
  expect((await buy({ service: "GA" })).status).toBe(303);
  expect(creates()).toHaveLength(1);
  const lookup = pbCalls.find(call => call.method === "GET" && call.url.pathname === "/shippingservices/v1/shipments")!;
  expect(lookup.url.searchParams.get("originalTransactionId")).toBe(creates()[0]!.headers.get("x-pb-transactionid"));
  expect(await labels()).toMatchObject([{ tracking: "SANDBOX-TRACKING-A" }]);
  // The label is the one Pitney Bowes sold (Priority Mail), not the service on the second form.
  expect((await shipStore().orderSummary("order:abc"))!.labels).toMatchObject([{ service: "PM", priceCents: 935 }]);
});

test("when Pitney Bowes has no record of a lost purchase, the owner decides whether to buy again", async () => {
  const { buy } = await liveOrder();
  pbAnswer = call => {
    if (call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments") return new Response("gateway timeout", { status: 504 });
    return sandbox(call);
  };
  const lost = await buy();
  expect(lost.status).toBe(502);
  // The page says what came back, so a failed journey names it without anyone reading PB's answer.
  expect(await lost.text()).toContain("Pitney Bowes did not confirm the label (it answered 504), so Ship does not know yet");
  pbAnswer = sandbox;
  const ask = await buy();
  expect(ask.status).toBe(409);
  expect(await ask.text()).toContain('name="buyAgain"');
  expect(creates()).toHaveLength(1);
  expect((await buy({ buyAgain: "yes" })).status).toBe(303);
  expect(creates()).toHaveLength(2);
  expect(creates()[1]!.headers.get("x-pb-transactionid")).not.toBe(creates()[0]!.headers.get("x-pb-transactionid"));
  expect(await labels()).toHaveLength(1);
});

test("a label whose PDF Pitney Bowes could not hand over yet is fetched when opened", async () => {
  const { cookie, buy } = await liveOrder();
  pbAnswer = call => call.url.href === LABEL_URL ? new Response("busy", { status: 503 }) : sandbox(call);
  expect((await buy()).status).toBe(303);
  expect(await labels()).toHaveLength(1);
  const label = (await shipStore().orderSummary("order:abc"))!.labels[0]!;
  const waiting = await request("GET", `/stores/${site}/labels/${label.labelId}.pdf`, { cookie });
  expect(waiting.status).toBe(503);
  expect(await waiting.text()).toContain("Label PDF not ready");
  pbAnswer = sandbox;
  expect(await (await request("GET", `/stores/${site}/labels/${label.labelId}.pdf`, { cookie })).text()).toBe("%PDF-1.4 sandbox label");
});

test("postage stays off until the Pitney Bowes sandbox keys are all set", () => {
  const keys = { PB_ENVIRONMENT: "sandbox", PB_API_KEY: "k", PB_API_SECRET: "s", PB_SHIPPER_ID: "m" };
  expect(pitneyConfig(keys as unknown as Env)).toEqual({ apiKey: "k", apiSecret: "s", shipperId: "m", origin: "https://shipping-api-sandbox.pitneybowes.com" });
  for (const off of [{ PB_ENVIRONMENT: "" }, { PB_ENVIRONMENT: "live" }, { PB_SHIPPER_ID: "" }, { PB_API_SECRET: undefined }]) {
    expect(pitneyConfig({ ...keys, ...off } as unknown as Env)).toBeNull();
  }
});

test("a purchase Ship started before TEST orders reached the sandbox finishes as a real order's label", async () => {
  await runInDurableObject(shipStore(), async (_, state) => {
    const sql = state.storage.sql;
    sql.exec("DROP TABLE purchases");
    sql.exec(`CREATE TABLE purchases (
      transaction_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version INTEGER NOT NULL, service TEXT NOT NULL, box TEXT NOT NULL,
      weight_oz REAL NOT NULL, state TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec("INSERT INTO purchases VALUES ('shp-old', 'order:abc', 1, 'PM', '{}', 28, 'unknown', 'user-1', 0)");
    addPurchaseColumns(sql);
    addPurchaseColumns(sql);
    expect(sql.exec("SELECT test FROM purchases").one().test).toBe(0);
  });
});

test("a store whose labels were kept before Pitney Bowes postage gets the new label columns", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  expect((await request("POST", `/stores/${site}/orders/${encodeURIComponent("order:abc")}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA", kind: "practice" } })).status).toBe(303);
  await runInDurableObject(shipStore(), async (_, state) => {
    const sql = state.storage.sql;
    // The labels table exactly as the label page (PR 24) made it.
    sql.exec("ALTER TABLE labels RENAME TO labels_now");
    sql.exec(`CREATE TABLE labels (
      label_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version INTEGER NOT NULL, test INTEGER NOT NULL,
      service TEXT NOT NULL, box TEXT NOT NULL, weight_oz REAL NOT NULL, carrier TEXT NOT NULL, tracking TEXT NOT NULL,
      pdf BLOB NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_at TEXT)`);
    sql.exec(`INSERT INTO labels SELECT label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at, cancelled_at FROM labels_now`);
    sql.exec("DROP TABLE labels_now");
    addLabelColumns(sql);
    addLabelColumns(sql);
  });
  expect((await shipStore().orderSummary("order:abc"))!.labels).toMatchObject([{ test: true, practice: true, priceCents: null, refund: null }]);
  expect((await request("GET", `/stores/${site}/orders`, { cookie })).status).toBe(200);
});

test("an owner creates their own Pitney Bowes account from Ship's link and connects it without Ship keeping the password", async () => {
  const cookie = await signedIn();
  await setUp(cookie);
  const page = await (await request("GET", `/stores/${site}/settings`, { cookie })).text();
  expect(page).toContain("you need your own Pitney Bowes postage account");
  const link = new URL(page.match(/href="([^"]+)" target="_blank"/)![1]!.replaceAll("&amp;", "&"));
  expect(`${link.origin}${link.pathname}`).toBe("https://developer.pbshippingmerchant.pitneybowes.com/create/accountInfo");
  expect(Object.fromEntries(link.searchParams)).toEqual({
    developerID: "synthetic-developer", fName: "Demo", lName: "Store", email: "owner@example.test",
    addressLine1: "2 Warehouse Rd", city: "Shiptown", state: "NY", postalCode: "10001",
  });

  const refused = await connect(cookie, { username: "owner@example.test", password: "wrong-login" });
  expect(refused.status).toBe(422);
  const refusedPage = await refused.text();
  expect(refusedPage).toContain("did not accept that username and password");
  expect(refusedPage).not.toContain("wrong-login");
  expect((await shipStore().getSettings()).postageAccount).toBeNull();

  expect((await connect(cookie)).status).toBe(303);
  const call = pbCalls.filter(item => item.url.pathname.endsWith("/merchants/credentials")).at(-1)!;
  expect(call.method).toBe("POST");
  expect(call.headers.get("authorization")).toBe("Bearer synthetic-pb-pass");
  expect((await shipStore().getSettings()).postageAccount).toMatchObject({
    shipperId: "SANDBOX-OWNER-SHIPPER", company: "Demo Store", email: "owner@example.test", accountEnding: "0042", connectedBy: "user-1",
  });
  const connected = await (await request("GET", `/stores/${site}/settings`, { cookie })).text();
  expect(connected).toContain("Connected to Pitney Bowes: Demo Store · postage account ending 0042 · owner@example.test");
  expect(connected).not.toContain('name="password"');
  await runInDurableObject(shipStore(), async (_, state) => {
    const kept = JSON.stringify(state.storage.sql.exec("SELECT * FROM store_meta").toArray());
    expect(kept).toContain("SANDBOX-OWNER-SHIPPER");
    expect(kept).not.toContain("not-a-real-login");
  });

  expect((await request("POST", `/stores/${site}/settings/postage/disconnect`, { cookie })).status).toBe(303);
  expect((await shipStore().getSettings()).postageAccount).toBeNull();
});

test("a Pitney Bowes account that is not active or cannot pay yet is not connected", async () => {
  const cookie = await signedIn();
  const refusals: [Record<string, unknown>, string][] = [
    [{ merchantStatus: "INACTIVE" }, "not active yet"],
    [{ paymentServicesAccountIdActive: false }, "no working way to pay"],
    // PB has to say the payment account works; a missing or odd answer is not a yes.
    [{ paymentServicesAccountIdActive: undefined }, "no working way to pay"],
    [{ paymentServicesAccountIdActive: "true" }, "no working way to pay"],
  ];
  for (const [change, words] of refusals) {
    merchant = { ...ownMerchant(), ...change };
    const response = await connect(cookie);
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(words);
  }
  expect((await shipStore().getSettings()).postageAccount).toBeNull();
});

test("a real order gets no label until the owner connects their own Pitney Bowes account, while TEST orders still use the sandbox", async () => {
  await sendOrder({ test: false });
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const form = { version: "1", boxId, weightOz: "28", service: "PM" };
  expect(await (await request("GET", orderPath, { cookie })).text()).toContain("Connect your Pitney Bowes postage account in <a");
  for (const action of ["labels", "prices"]) {
    const refused = await request("POST", `${orderPath}/${action}`, { cookie, form });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Connect your Pitney Bowes postage account in Settings");
  }
  expect(pbCalls).toEqual([]);

  expect((await connect(cookie)).status).toBe(303);
  await sendOrder({ orderId: "order:test", number: 1002 });
  expect((await request("POST", `/stores/${site}/orders/${encodeURIComponent("order:test")}/labels`, { cookie, form })).status).toBe(303);
  expect(creates()[0]!.body.shipmentOptions).toEqual([{ name: "SHIPPER_ID", value: "synthetic-shipper" }]);
  expect((await request("POST", `${orderPath}/labels`, { cookie, form })).status).toBe(303);
  expect(creates()[1]!.body.shipmentOptions).toEqual([{ name: "SHIPPER_ID", value: "SANDBOX-OWNER-SHIPPER" }]);
});

test("a token endpoint redirect is refused without forwarding the sign-in code", async () => {
  tokenAnswer = async () => new Response(null, { status: 302, headers: { location: "https://redirect-target.example.invalid/token" } });
  const { back } = await signIn();
  expect(back.status).toBe(502);
  const tokenCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input) === `${issuer}/token`);
  expect(tokenCall?.[1]?.redirect).toBe("manual");
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).startsWith("https://redirect-target.example.invalid/"))).toBe(false);
});

test("once the store's Ship plugin has called, Commerce's label button lands a signed-in owner on the store admin's Shipping page", async () => {
  await sendOrder();
  const adminPage = "https://shop.example.invalid/_emdash/admin/plugins/dinkus-ship-1/shipping";
  const orderPath = `/stores/${site}/orders/order%3Aabc`;
  const store = env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));
  // Before the plugin has called, Ship's own order page is the only page: sign-in first.
  const before = await request("GET", orderPath, { from: "cross-site" });
  expect(before.status).toBe(303);
  expect(before.headers.get("location")).toContain("/ship-sign-in");
  await store.rememberAdminPage(adminPage);
  // Anyone not signed in to Ship still signs in first, and queues nothing.
  const anonymous = await request("GET", orderPath, { from: "cross-site" });
  expect(anonymous.headers.get("location")).toContain("/ship-sign-in");
  expect(await store.takeAdminOpen()).toBeNull();
  // The signed-in owner arriving from Commerce (another site) is forwarded, and the order waits for the Shipping page.
  const cookie = await signedIn();
  const forwarded = await request("GET", orderPath, { cookie, from: "cross-site" });
  expect(forwarded.status).toBe(303);
  expect(forwarded.headers.get("location")).toBe(adminPage);
  expect(forwarded.headers.get("cache-control")).toBe("no-store");
  expect(await store.takeAdminOpen()).toBe("order:abc");
  // The way back from DinkusKit.com's sign-in counts as from outside Ship too.
  expect((await request("GET", orderPath, { cookie, from: "same-site" })).headers.get("location")).toBe(adminPage);
  // Ship's own links and redirects, and a browser that does not say where it came from, keep Ship's page.
  for (const from of ["same-origin", undefined]) expect((await request("GET", orderPath, { cookie, from })).status).toBe(200);
  // The plugin's own "Open in Ship" link asks for the full version and gets Ship's page, so the two never bounce.
  expect((await request("GET", `${orderPath}?view=full`, { cookie, from: "cross-site" })).status).toBe(200);
  // The list and settings pages are never forwarded.
  expect((await request("GET", `/stores/${site}/orders`, { cookie, from: "cross-site" })).status).toBe(200);
  expect((await request("GET", `/stores/${site}/settings`, { cookie, from: "cross-site" })).status).toBe(200);
  // A plugin that has not called in a week is forgotten: Commerce's button is back on Ship's own page.
  await runInDurableObject(store, async (_, state) => state.storage.sql.exec("UPDATE store_meta SET value = ? WHERE key = 'admin_page_at'", new Date(Date.now() - 8 * 86_400_000).toISOString()));
  expect(await store.adminPage()).toBeNull();
  expect((await request("GET", orderPath, { cookie, from: "cross-site" })).status).toBe(200);
  // The plugin's next call brings it back.
  await store.rememberAdminPage(adminPage);
  expect((await request("GET", orderPath, { cookie, from: "cross-site" })).headers.get("location")).toBe(adminPage);
});

test("an answer Ship cannot read as a label says which part was missing, in plain words and never a link", async () => {
  const { buy } = await liveOrder();
  const answers: [Record<string, unknown>, string][] = [
    [{ ...pbLabel("PM"), documents: [{ ...(pbLabel("PM").documents as Record<string, unknown>[])[0], contents: "https://labels-cls.gcs.pitneybowes.com/usps/x/label.pdf?token=secret" }] }, "(its label link was on another host, labels-cls.gcs.pitneybowes.com)"],
    [{ ...pbLabel("PM"), documents: [] }, "(it gave no label document)"],
    [{ ...pbLabel("PM"), parcelTrackingNumber: "" }, "(it gave no tracking number)"],
    [{ ...pbLabel("PM"), rates: [{ carrier: "USPS", serviceId: "PM", totalCarrierCharge: 0 }] }, "(it gave no price)"],
    [{ ...pbLabel("PM"), shipmentId: undefined }, "(it gave no shipment id)"],
  ];
  for (const [answer, expected] of answers) {
    pbAnswer = call => call.method === "POST" && call.url.pathname === "/shippingservices/v1/shipments" ? Response.json(answer) : sandbox(call);
    const page = await buy({ buyAgain: "yes" });
    expect(page.status).toBe(502);
    const text = await page.text();
    expect(text).toContain(expected);
    expect(text).not.toContain("token=secret");
  }
});
