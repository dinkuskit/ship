import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../../service/src/worker";
// The plugin exactly as the Registry bundle ships it (npm run build at the repository root).
import plugin from "../../dist/plugin.mjs";

/**
 * Authority chain for the Shipping settings page's Pitney Bowes connection (ship-settings-in-admin-129,
 * ship-pitney-connect-in-admin-138): the built plugin's admin route, as EmDash calls it for a user of a
 * given role, drives hosted Ship's real Worker and per-store Durable Object, which call Pitney Bowes and
 * keep the paying account. Later label purchases, made through the plugin's Shipments page, show which
 * account pays.
 *
 * Stand-ins, and only these: the transport (https://ship.dinkuskit.com is this Worker's fetch handler),
 * DinkusKit.com's store-passes (signs an ES256 pass for a known store key; Ship verifies it against the
 * published key set like any other), Commerce's order push (Ship's real POST /v1/orders with a signed
 * ship:orders pass), and Pitney Bowes's sandbox API (answers and records each call).
 */

const SHIP = "https://ship.dinkuskit.com";
const ISSUER = "https://dinkuskit.com/account";
const JWKS = "https://dinkuskit.com/account/.well-known/jwks.json";
const PB = "https://shipping-api-sandbox.pitneybowes.com";
const LABEL_URL = "https://stg-labels-cls.gcs.pitneybowes.com/usps/sample/outbound/label/sample.pdf";
const trace: string[] = [];
const note = (line: string) => { trace.push(line); };

let signingKey: CryptoKey;
const ship = () => ({ ...env, ACCOUNT_ISSUER: ISSUER, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: JWKS }) as unknown as Env;

/** Two stores, each with the plugin connected under its own DinkusKit store key. */
const STORES = {
  a: { siteId: `site_proof_a_${crypto.randomUUID().slice(0, 8)}`, key: `dk_store_${"a".repeat(43)}`, origin: "https://shop-a.example.test" },
  b: { siteId: `site_proof_b_${crypto.randomUUID().slice(0, 8)}`, key: `dk_store_${"b".repeat(43)}`, origin: "https://shop-b.example.test" },
};
type StoreName = keyof typeof STORES;

/** Pitney Bowes postage accounts, found by the owner's own username and password. */
const ACCOUNTS: Record<string, { password: string; shipperId: string; company: string; account: string }> = {
  "owner-a@example.test": { password: "synthetic-login-a", shipperId: "SHIPPER-OWNER-A", company: "Acme Goods", account: "SANDBOX-ACCT-1111" },
  "owner-a-new@example.test": { password: "synthetic-login-a2", shipperId: "SHIPPER-OWNER-A2", company: "Acme Goods LLC", account: "SANDBOX-ACCT-2222" },
  "owner-b@example.test": { password: "synthetic-login-b", shipperId: "SHIPPER-OWNER-B", company: "Beta Wares", account: "SANDBOX-ACCT-3333" },
};
interface PbCall { method: string; path: string; body: any }
const pbCalls: PbCall[] = [];
const creates = () => pbCalls.filter(call => call.method === "POST" && call.path === "/shippingservices/v1/shipments");
const payers = (calls: PbCall[]) => calls.map(call => call.body.shipmentOptions?.find((option: any) => option.name === "SHIPPER_ID")?.value);
const shipCalls: { store: StoreName; method: string; path: string }[] = [];

function pitneyBowes(method: string, path: string, body: any): Response {
  pbCalls.push({ method, path, body });
  if (path === "/oauth/token") return Response.json({ access_token: "synthetic-pb-pass", tokenType: "BearerToken", expiresIn: 36000 });
  if (path === "/shippingservices/v1/developers/synthetic-developer/merchants/credentials") {
    const found = ACCOUNTS[body.username];
    if (!found || found.password !== body.password) return Response.json({ errors: [{ errorCode: "PB-SYNTHETIC", message: "Invalid credentials" }] }, { status: 401 });
    return Response.json({ company: found.company, fullName: "Synthetic Owner", email: body.username, developerId: "synthetic-developer", merchantStatus: "ACTIVE",
      merchantStatusReason: null, merchantType: "INDIVIDUAL", paymentAccountNumber: found.account, paymentServicesAccountId: "synthetic-payments",
      paymentServicesAccountIdActive: true, postalReportingNumber: found.shipperId });
  }
  if (path === "/shippingservices/v1/rates") return Response.json({ rates: [{ ...body.rates[0], totalCarrierCharge: 9.35, currencyCode: "USD" }] });
  if (path === "/shippingservices/v1/shipments" && method === "POST") return Response.json({
    shipmentId: `SANDBOX-SHIPMENT-${creates().length}`, parcelTrackingNumber: `SANDBOXTRACK${creates().length}`,
    rates: [{ carrier: "USPS", serviceId: body.rates[0].serviceId, parcelType: "PKG", totalCarrierCharge: 9.35, currencyCode: "USD" }],
    documents: [{ type: "SHIPPING_LABEL", contentType: "URL", fileFormat: "PDF", size: "DOC_8X11", contents: LABEL_URL }],
  });
  throw new Error(`unexpected Pitney Bowes call ${method} ${path}`);
}

beforeAll(async () => {
  const keys = await generateKeyPair("ES256");
  signingKey = keys.privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "proof", alg: "ES256", use: "sig" };
  // Ship's own outbound calls: DinkusKit.com's published keys and Pitney Bowes.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === JWKS) return Response.json({ keys: [jwk] });
    if (request.url === LABEL_URL) return new Response("%PDF-1.4 sandbox label", { headers: { "content-type": "application/pdf" } });
    if (!request.url.startsWith(`${PB}/`)) throw new Error(`unexpected fetch ${request.url}`);
    const text = await request.text();
    return pitneyBowes(request.method, new URL(request.url).pathname, text.startsWith("{") ? JSON.parse(text) : undefined);
  });
});
afterAll(() => vi.restoreAllMocks());

const signPass = (claims: Record<string, unknown>) => new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "proof" })
  .setIssuer(ISSUER).setAudience("dinkus-ship").setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(signingKey);

/** DinkusKit.com's store-passes, standing in: a pass only for a store key it issued, for that key's store. */
async function storePasses(init: RequestInit): Promise<Response> {
  const key = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
  const store = Object.values(STORES).find(candidate => candidate.key === key);
  const body = JSON.parse(String(init.body));
  if (!store || body.site_id !== store.siteId) return Response.json({ error: "invalid_store_key" }, { status: 401 });
  const access_token = await signPass({ site_id: store.siteId, scope: body.scope, site_origin: store.origin });
  return Response.json({ access_token, token_type: "Bearer", expires_in: 300 });
}

/** One store's EmDash host for the plugin: its encrypted connection setting, its KV and its network. */
function host(name: StoreName) {
  const store = STORES[name];
  const settings = new Map([["connection", { value: JSON.stringify({ siteId: store.siteId, storeKey: store.key }), revision: "1" }]]);
  const kv = new Map<string, unknown>();
  return {
    plugin: { id: "dinkus-ship", version: "0.4.0" },
    site: { url: store.origin, name: name === "a" ? "Acme Goods" : "Beta Wares", locale: "en" },
    settings: {
      get: async (key: string) => settings.get(key)?.value ?? null,
      getVersioned: async (key: string) => settings.get(key) ?? null,
      compareAndSet: async () => ({ applied: false }),
      delete: async (key: string) => settings.delete(key),
    },
    kv: { get: async (key: string) => kv.get(key) ?? null, set: async (key: string, value: unknown) => { kv.set(key, value); }, delete: async (key: string) => kv.delete(key) },
    http: { fetch: async (url: string, init: RequestInit = {}) => {
      if (url === "https://dinkuskit.com/api/store-passes") return storePasses(init);
      if (url.startsWith("https://dinkuskit.com/")) return Response.json({ error: "not_found" }, { status: 404 });
      if (!url.startsWith(`${SHIP}/`)) throw new Error(`plugin reached ${url}`);
      shipCalls.push({ store: name, method: init.method ?? "GET", path: new URL(url).pathname });
      // workerd's Request takes neither `cache` nor redirect "error" (EmDash's host fetch does); the method,
      // headers (the pass, x-ship-admin-page, x-ship-admin-user) and body go to Ship as the plugin sent them.
      const { cache: _cache, redirect: _redirect, ...sent } = init;
      return worker.fetch(new Request(url, sent), ship());
    } },
    log: { error() {}, info() {}, warn() {}, debug() {} },
  };
}
const hosts = { a: host("a"), b: host("b") };

/** A press on a plugin page, as EmDash's admin sends it to the plugin's `admin` route for this user. */
async function press(name: StoreName, user: { email: string; role: number }, input: Record<string, unknown>) {
  const route = { input, ui: { surface: "admin-page", locale: "en", direction: "ltr" }, user: { id: user.email, name: "Proof", createdAt: "", ...user },
    request: { url: `${STORES[name].origin}/_emdash/api/plugins/dinkus-ship/admin`, method: "POST", headers: {} } };
  return JSON.stringify(await (plugin as any).routes.admin.handler(route, hosts[name]));
}
const SETTINGS = "/shipping-settings";
const ADMIN_A = { email: "owner-a@example.test", role: 50 };
const EDITOR_A = { email: "packer@example.test", role: 40 };
// The Administrator who connected the account, after being made an Editor.
const DEMOTED_A = { email: "owner-a@example.test", role: 40 };
const ADMIN_B = { email: "owner-b@example.test", role: 50 };

/** What the store's Durable Object keeps about its paying account, and every value it stores anywhere. */
const shipStore = (name: StoreName) => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(STORES[name].siteId));
const paying = async (name: StoreName) => (await shipStore(name).getSettings()).postageAccount;
const everythingKept = (name: StoreName) => runInDurableObject(shipStore(name), async (_, state) => {
  const tables = state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray();
  return JSON.stringify(tables.map(table => state.storage.sql.exec(`SELECT * FROM "${table.name}"`).toArray()));
});

async function sendOrder(name: StoreName, orderId: string, number: number) {
  const token = await signPass({ site_id: STORES[name].siteId, scope: "ship:orders" });
  const response = await worker.fetch(new Request(`${SHIP}/v1/orders`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      schema: "dinkuskit.commerce.ship-order/v1", orderId, number, version: 1, status: "processing", test: false,
      shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "California", postalCode: "90000", country: "US" },
      email: "shopper@example.test", completed: null,
      lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 1, weightOz: 12.5, unitPrice: { currency: "USD", minor: "1250" } }],
    }),
  }), ship());
  expect(response.status).toBe(200);
}

/** Buying a real order's label from the Shipments page (`/shipping`), as an Editor or Administrator does. */
async function buy(name: StoreName, user: { email: string; role: number }, orderId: string) {
  const id = `1:${encodeURIComponent(orderId)}`;
  const boxId = (await shipStore(name).getSettings()).boxes[0]!.boxId;
  return press(name, user, { type: "form_submit", action_id: `buy:${id}`, values: { boxId, weightOz: "16", service: "PM" }, page: "/shipping" });
}

test("an Administrator sets up Ship and connects the store's own Pitney Bowes account; Editors and demoted Administrators change nothing; later labels are paid only by the account connected now", async () => {
  for (const [name, store] of Object.entries(STORES)) note(`setup: store ${name} = ${store.siteId}, plugin connected with its own DinkusKit key (redacted)`);
  await sendOrder("a", "order:one", 1001);
  await sendOrder("a", "order:two", 1002);
  await sendOrder("a", "order:three", 1003);
  note("setup: Commerce sent real (not TEST) orders #1001, #1002 and #1003 to store a through Ship's POST /v1/orders");

  // An Administrator's first visit and setup, through the plugin and Ship's routes.
  expect(await press("a", ADMIN_A, { type: "page_load", page: SETTINGS })).toContain("Create your Pitney Bowes account");
  expect(await press("a", ADMIN_A, { type: "form_submit", action_id: "save:ship-from", page: SETTINGS,
    values: { name: "Acme Goods", company: "", line1: "2 Warehouse Rd", line2: "", city: "Shiptown", region: "NY", postalCode: "10001" } })).toContain("Ship-from address saved.");
  expect(await press("a", ADMIN_A, { type: "form_submit", action_id: "save:boxes", page: SETTINGS,
    values: { name: "Small mailer", lengthIn: "8", widthIn: "6", heightIn: "4", weightOz: "3" } })).toContain("Box size added.");
  note(`admin (role 50) on /shipping-settings: page load, ship-from saved, box added -> Ship calls: ${shipCalls.map(call => `${call.method} ${call.path}`).join(", ")}`);

  // 1. An Editor, on the settings page or forging the form onto the Shipments page, reaches neither Ship nor Pitney Bowes.
  const before = { ship: shipCalls.length, pb: pbCalls.length, kept: await everythingKept("a") };
  const editorConnect = await press("a", EDITOR_A, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-a@example.test", password: "synthetic-login-a" } });
  expect(editorConnect).toContain("Shipping settings are for Administrators");
  expect(await press("a", EDITOR_A, { type: "form_submit", action_id: "save:postage", values: { username: "owner-a@example.test", password: "synthetic-login-a" } })).toBe('{"blocks":[]}');
  expect(await press("a", EDITOR_A, { type: "form_submit", action_id: "save:postage", page: "/shipping", values: { username: "owner-a@example.test", password: "synthetic-login-a" } })).toBe('{"blocks":[]}');
  expect(await press("a", EDITOR_A, { type: "block_action", action_id: "disconnect_postage", page: SETTINGS })).toContain("Shipping settings are for Administrators");
  expect({ ship: shipCalls.length, pb: pbCalls.length, kept: await everythingKept("a") }).toEqual(before);
  note("editor (role 40): Connect Pitney Bowes on /shipping-settings -> \"Shipping settings are for Administrators\"; the same form with no page and forged onto /shipping -> empty answer; Disconnect -> refused. Ship calls +0, Pitney Bowes calls +0, store storage unchanged");

  // 2. A wrong password reaches Pitney Bowes once, connects nothing and is kept nowhere.
  const wrong = await press("a", ADMIN_A, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-a@example.test", password: "synthetic-wrong-login" } });
  expect(wrong).toContain("Not saved");
  expect(await paying("a")).toBeNull();
  expect(await everythingKept("a")).not.toContain("synthetic-wrong-login");
  note("admin, wrong password: Pitney Bowes credentials check refused -> \"Not saved\", no paying account, the password is not in any table of the store's Durable Object");

  // 3. The Administrator connects the store's own account: Ship keeps it, never the password.
  const connected = await press("a", ADMIN_A, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-a@example.test", password: "synthetic-login-a" } });
  expect(connected).toContain("Connected to Pitney Bowes: Acme Goods · postage account ending 1111");
  expect(connected).not.toContain("synthetic-login-a");
  expect(await paying("a")).toMatchObject({ shipperId: "SHIPPER-OWNER-A", connectedBy: "admin:owner-a@example.test" });
  expect(await everythingKept("a")).not.toContain("synthetic-login-a");
  const credentialChecks = pbCalls.filter(call => call.path.endsWith("/merchants/credentials"));
  expect(credentialChecks).toHaveLength(2);
  note(`admin connects: POST /v1/admin/settings/postage -> Pitney Bowes credentials check (${credentialChecks.length} in all) -> Ship keeps shipperId SHIPPER-OWNER-A, connectedBy admin:owner-a@example.test; the password is in no table; the page shows the account and no password`);

  // 4. A label for a real order, bought by an Editor on Shipments, is paid by that account.
  expect(await buy("a", EDITOR_A, "order:one")).toContain("Label bought");
  expect(payers(creates())).toEqual(["SHIPPER-OWNER-A"]);
  note("editor buys #1001 on /shipping -> Pitney Bowes shipment SHIPPER_ID = SHIPPER-OWNER-A");

  // 5. A demoted Administrator (now role 40) cannot disconnect or replace the account.
  const beforeDemoted = { ship: shipCalls.length, pb: pbCalls.length, kept: await everythingKept("a") };
  expect(await press("a", DEMOTED_A, { type: "block_action", action_id: "disconnect_postage", page: SETTINGS })).toContain("Shipping settings are for Administrators");
  expect(await press("a", DEMOTED_A, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-a-new@example.test", password: "synthetic-login-a2" } })).toContain("Shipping settings are for Administrators");
  expect({ ship: shipCalls.length, pb: pbCalls.length, kept: await everythingKept("a") }).toEqual(beforeDemoted);
  expect(await paying("a")).toMatchObject({ shipperId: "SHIPPER-OWNER-A" });
  note("demoted administrator (role now 40): Disconnect and Connect another account -> refused; Ship calls +0, Pitney Bowes calls +0, storage unchanged, SHIPPER-OWNER-A still pays");

  // 6. The Administrator replaces the account: the next label is paid by the new one only.
  expect(await press("a", ADMIN_A, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-a-new@example.test", password: "synthetic-login-a2" } }))
    .toContain("postage account ending 2222");
  expect(await paying("a")).toMatchObject({ shipperId: "SHIPPER-OWNER-A2" });
  expect(await buy("a", EDITOR_A, "order:two")).toContain("Label bought");
  expect(payers(creates())).toEqual(["SHIPPER-OWNER-A", "SHIPPER-OWNER-A2"]);
  note("admin replaces the account -> Ship keeps SHIPPER-OWNER-A2; editor buys #1002 -> SHIPPER_ID = SHIPPER-OWNER-A2 (the replaced account pays nothing more)");

  // 7. Disconnect: no account pays, and Pitney Bowes is not asked to buy.
  expect(await press("a", ADMIN_A, { type: "block_action", action_id: "disconnect_postage", page: SETTINGS })).toContain("Pitney Bowes disconnected.");
  expect(await paying("a")).toBeNull();
  const pbBefore = pbCalls.length;
  const refused = await buy("a", ADMIN_A, "order:three");
  expect(refused).toContain("Connect your Pitney Bowes postage account");
  expect(pbCalls.length).toBe(pbBefore);
  expect(payers(creates())).toEqual(["SHIPPER-OWNER-A", "SHIPPER-OWNER-A2"]);
  expect(payers(creates())).not.toContain("DINKUSKIT-SANDBOX-SHIPPER");
  note("admin disconnects -> no paying account; admin buys #1003 -> Ship refuses (Connect your Pitney Bowes postage account), Pitney Bowes calls +0; DinkusKit's own sandbox shipper never paid a real order");

  // 8. Another store's Administrator connects their own account: store a is untouched.
  await press("b", ADMIN_B, { type: "form_submit", action_id: "save:postage", page: SETTINGS, values: { username: "owner-b@example.test", password: "synthetic-login-b" } });
  expect(await paying("b")).toMatchObject({ shipperId: "SHIPPER-OWNER-B", connectedBy: "admin:owner-b@example.test" });
  expect(await paying("a")).toBeNull();
  note("store b's admin connects SHIPPER-OWNER-B through store b's own pass -> store b keeps it, store a still has no paying account");
  // The trace is printed for authority-chain-trace.md; no password or store key appears in it.
  const printed = trace.join("\n");
  for (const secret of [...Object.values(ACCOUNTS).map(account => account.password), ...Object.values(STORES).map(store => store.key)]) expect(printed).not.toContain(secret);
  console.log(["AUTHORITY-TRACE-BEGIN", ...trace, "AUTHORITY-TRACE-END"].join("\n"));
});
