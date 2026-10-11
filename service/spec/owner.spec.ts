import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";

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

const configured = () => ({
  ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: jwksUrl,
  ACCOUNT_SIGNIN_URL: `${issuer}/ship-sign-in`, ACCOUNT_TOKEN_URL: `${issuer}/token`, SHIP_SESSION_SECRET: sessionKey,
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
  tokenAnswer = async () => Response.json({ access_token: await pass(ownerClaims), token_type: "Bearer", expires_in: 300, refresh_token: `refresh-${++refreshes}-${"r".repeat(40)}` });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input)).href;
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/jwks-down`) return new Response("busy", { status: 503 });
    if (url === `${issuer}/token`) return tokenAnswer(JSON.parse(String(init?.body)));
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

function cookies(response: Response): string {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("=")).join("; ");
}

async function request(method: string, path: string, options: { cookie?: string; form?: Record<string, string>; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
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

test("a TEST order goes from Commerce to a practice label to a label event Commerce picks up", async () => {
  await sendOrder();
  const cookie = await signedIn();
  const list = await request("GET", `/stores/${site}/orders`, { cookie });
  expect(await list.text()).toContain("#1001");
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const page = await (await request("GET", orderPath, { cookie })).text();
  expect(page).toContain("Make practice label");
  expect(page).toContain('value="28"'); // 2 × 12.5 oz plus the 3 oz box
  expect(page).toContain("$12.50");
  const bought = await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA" } });
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
  const again = await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "GA" } });
  expect(again.status).toBe(409);
  expect((await request("POST", `/stores/${site}/labels/${label.labelId}/cancel`, { cookie })).status).toBe(303);
  expect((await request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "28", service: "PM" } })).status).toBe(303);
  expect(await labels()).toHaveLength(2);
});

test("labels are refused for a changed, live, unaddressable or completed order", async () => {
  const cookie = await signedIn();
  const boxId = await setUp(cookie);
  const orderPath = `/stores/${site}/orders/${encodeURIComponent("order:abc")}`;
  const buy = (form: Record<string, string> = {}) => request("POST", `${orderPath}/labels`, { cookie, form: { version: "1", boxId, weightOz: "20", service: "GA", ...form } });
  await sendOrder({ test: false });
  const live = await buy();
  expect(live.status).toBe(409);
  expect(await live.text()).toContain("Pitney Bowes comes in the next Ship update");
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
