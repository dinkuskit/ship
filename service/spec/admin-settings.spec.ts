import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker";
import { LABEL_HISTORY_PAGE } from "../src/admin";

// The Ship plugin's Shipping settings page and label history (ship-settings-in-admin-129):
// the same settings Ship's own page saves, through the plugin's ship:admin pass.
// Pitney Bowes's sandbox is stood in for, as in owner.spec.ts.

const ORIGIN = "https://ship.example.invalid";
const PB = "https://shipping-api-sandbox.pitneybowes.com";
let site: string;
let issuer: string;
let privateKey: CryptoKey;
let pbCalls: { method: string; path: string; body: any }[];
let merchantAnswer: () => Response | Promise<Response>;
const merchant = {
  company: "Demo Store", fullName: "Demo Owner", email: "owner@example.test", developerId: "synthetic-developer",
  merchantStatus: "ACTIVE", merchantStatusReason: null, merchantType: "INDIVIDUAL", paymentAccountNumber: "SANDBOX-ACCT-0042",
  paymentServicesAccountId: "synthetic-payments", paymentServicesAccountIdActive: true, postalReportingNumber: "SANDBOX-OWNER-SHIPPER",
};

const configured = () => ({
  ...env, ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "dinkus-ship", ACCOUNT_JWKS_URL: `${issuer}/jwks`,
}) as unknown as Env;

beforeEach(async () => {
  site = `site-${crypto.randomUUID()}`;
  issuer = `https://accounts-${crypto.randomUUID()}.example.invalid`;
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: "synthetic", alg: "ES256", use: "sig" };
  pbCalls = [];
  merchantAnswer = () => Response.json(merchant);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new Request(input, init).url;
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (!url.startsWith(`${PB}/`)) throw new Error(`unexpected fetch ${url}`);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    const path = new URL(url).pathname, method = init?.method ?? "GET";
    pbCalls.push({ method, path, body });
    if (path === "/oauth/token") return Response.json({ access_token: "synthetic-pb-pass", tokenType: "BearerToken", expiresIn: 36000 });
    if (path === "/shippingservices/v1/developers/synthetic-developer/merchants/credentials") {
      if (body.username !== "owner@example.test" || body.password !== "not-a-real-login") {
        return Response.json({ errors: [{ errorCode: "PB-SYNTHETIC", message: "Invalid credentials" }] }, { status: 401 });
      }
      return merchantAnswer();
    }
    throw new Error(`unexpected Pitney Bowes call ${method} ${path}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const pass = (scope: string, claimSite = site) => new SignJWT({ site_id: claimSite, scope })
  .setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience("dinkus-ship")
  .setSubject("synthetic-business").setIssuedAt().setExpirationTime("5m").sign(privateKey);

async function call(method: string, path: string, options: { body?: unknown; scope?: string; site?: string; adminUser?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${await pass(options.scope ?? "ship:admin", options.site)}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.adminUser) headers["x-ship-admin-user"] = options.adminUser;
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }), configured());
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as any };
}

const shipStore = (forSite = site) => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(forSite));
const SHIP_FROM = { name: "Demo Store", line1: "2 Warehouse Rd", city: "Shiptown", region: "ny", postalCode: "10001" };

test("the settings routes take only a ship:admin pass, and each store sees only its own settings", async () => {
  expect((await call("GET", "/v1/admin/settings", { scope: "ship:orders" })).status).toBe(403);
  expect((await call("POST", "/v1/admin/settings/ship-from", { scope: "ship:orders", body: SHIP_FROM })).status).toBe(403);
  expect((await call("GET", "/v1/admin/labels", { scope: "ship:orders" })).status).toBe(403);
  const empty = await call("GET", "/v1/admin/settings");
  expect(empty.json).toEqual({ settings: {
    shipFrom: null, boxes: [], replyTo: null, storeName: null, postageConnected: true, testSandbox: true,
    postageAccount: null, signupUrl: expect.stringContaining("developerID=synthetic-developer"),
  } });
  // The sign-up link fills in the ship-from address and the admin who opened the page, as Ship's own Settings does.
  await call("POST", "/v1/admin/settings/ship-from", { body: SHIP_FROM });
  const prefilled = new URL((await call("GET", "/v1/admin/settings", { adminUser: "Admin@Demo.example" })).json.settings.signupUrl);
  expect(Object.fromEntries(prefilled.searchParams)).toMatchObject({ developerID: "synthetic-developer", email: "admin@demo.example", fName: "Demo", lName: "Store", city: "Shiptown", state: "NY", postalCode: "10001" });
  expect((await call("POST", "/v1/admin/settings/ship-from", { body: SHIP_FROM })).status).toBe(200);
  const other = `site-${crypto.randomUUID()}`;
  expect((await call("GET", "/v1/admin/settings", { site: other })).json.settings.shipFrom).toBeNull();
  expect((await shipStore(other).getSettings()).shipFrom).toBeNull();
  expect((await shipStore().getSettings()).shipFrom).toMatchObject({ name: "Demo Store", region: "NY" });
});

test("the plugin saves the ship-from address, reply-to email and box sizes that Ship's own page shows", async () => {
  const saved = await call("POST", "/v1/admin/settings/ship-from", { body: { ...SHIP_FROM, company: "Demo Co", line2: "" } });
  expect(saved.status).toBe(200);
  expect(saved.json.settings.shipFrom).toEqual({ name: "Demo Store", company: "Demo Co", line1: "2 Warehouse Rd", city: "Shiptown", region: "NY", postalCode: "10001" });
  expect((await call("POST", "/v1/admin/settings/reply-to", { body: { replyTo: "help@demo.example" } })).json.settings.replyTo).toBe("help@demo.example");
  const added = await call("POST", "/v1/admin/settings/boxes", { body: { name: "Small", lengthIn: 8, widthIn: "6", heightIn: 4, weightOz: 3 } });
  expect(added.status).toBe(201);
  expect(added.json.settings.boxes).toMatchObject([{ name: "Small", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3 }]);
  await call("POST", "/v1/admin/settings/boxes", { body: { name: "Large", lengthIn: 18, widthIn: 12, heightIn: 10, weightOz: 12 } });
  // The same settings Ship's own page reads.
  const kept = await shipStore().getSettings();
  expect(kept.replyTo).toBe("help@demo.example");
  expect(kept.boxes.map(box => box.name)).toEqual(["Small", "Large"]);
  const removed = await call("POST", `/v1/admin/settings/boxes/${encodeURIComponent(kept.boxes[0]!.boxId)}/remove`);
  expect(removed.json.settings.boxes.map((box: { name: string }) => box.name)).toEqual(["Large"]);
});

test("bad settings are refused with Ship's own words and change nothing", async () => {
  await call("POST", "/v1/admin/settings/ship-from", { body: SHIP_FROM });
  const refusals: [string, unknown, string][] = [
    ["/v1/admin/settings/ship-from", { ...SHIP_FROM, postalCode: "1" }, "ZIP"],
    ["/v1/admin/settings/ship-from", { ...SHIP_FROM, city: "" }, "City is required."],
    ["/v1/admin/settings/ship-from", { ...SHIP_FROM, line1: "1 Main\nSt" }, "one line"],
    ["/v1/admin/settings/ship-from", { ...SHIP_FROM, extra: "x" }, "extra is not a field of this form"],
    ["/v1/admin/settings/reply-to", { replyTo: "not an email" }, "must be an email address"],
    ["/v1/admin/settings/boxes", { name: "Huge", lengthIn: 500, widthIn: 1, heightIn: 1, weightOz: 1 }, "Length (in) must be a number from 0.1 to 108."],
    ["/v1/admin/settings/boxes", { name: "Odd", lengthIn: { inches: 4 }, widthIn: 1, heightIn: 1, weightOz: 1 }, "lengthIn must be a number or a short line of text"],
    ["/v1/admin/settings/reply-to", ["help@demo.example"], "body must be a JSON object"],
  ];
  for (const [path, body, words] of refusals) {
    const refused = await call("POST", path, { body });
    expect(refused.status).toBe(400);
    expect(refused.json.error.code).toBe("INVALID_INPUT");
    expect(refused.json.error.message).toContain(words);
  }
  const kept = await shipStore().getSettings();
  expect(kept.shipFrom).toMatchObject({ city: "Shiptown", postalCode: "10001" });
  expect([kept.replyTo, kept.boxes]).toEqual([null, []]);
});

test("the plugin connects the owner's Pitney Bowes account without Ship keeping the password, and disconnects it", async () => {
  const login = { username: "owner@example.test", password: "not-a-real-login" };
  expect((await call("POST", "/v1/admin/settings/postage", { body: login })).json.error.message).toContain("x-ship-admin-user");
  const refused = await call("POST", "/v1/admin/settings/postage", { body: { ...login, password: "wrong-login" }, adminUser: "admin@demo.example" });
  expect(refused.status).toBe(422);
  expect(refused.text).not.toContain("wrong-login");
  expect((await shipStore().getSettings()).postageAccount).toBeNull();

  const connected = await call("POST", "/v1/admin/settings/postage", { body: login, adminUser: "Admin@Demo.example" });
  expect(connected.status).toBe(200);
  // The plugin sees what the owner needs to recognize the account, never the Shipper ID or who connected it.
  expect(connected.json.settings.postageAccount).toEqual({ company: "Demo Store", email: "owner@example.test", accountEnding: "0042", connectedAt: expect.any(String) });
  expect(connected.text).not.toContain("SANDBOX-OWNER-SHIPPER");
  expect(connected.text).not.toContain("not-a-real-login");
  expect(pbCalls.filter(item => item.path.endsWith("/merchants/credentials")).at(-1)!.body).toEqual(login);
  expect((await shipStore().getSettings()).postageAccount).toMatchObject({ shipperId: "SANDBOX-OWNER-SHIPPER", connectedBy: "admin:admin@demo.example" });
  await runInDurableObject(shipStore(), async (_, state) => {
    expect(JSON.stringify(state.storage.sql.exec("SELECT * FROM store_meta").toArray())).not.toContain("not-a-real-login");
  });

  const disconnected = await call("POST", "/v1/admin/settings/postage/disconnect");
  expect(disconnected.json.settings.postageAccount).toBeNull();
  expect((await shipStore().getSettings()).postageAccount).toBeNull();
});

test.each([
  ["Disconnect", 200], ["Connect", 200], ["Disconnect", 401], ["Connect", 401],
] as const)("a slower postage check cannot supersede a completed %s (carrier HTTP %i)", async (action, carrierStatus) => {
  const connect = () => call("POST", "/v1/admin/settings/postage", {
    body: { username: "owner@example.test", password: "not-a-real-login" }, adminUser: "admin@example.test",
  });
  const settings = () => call("GET", "/v1/admin/settings");
  // Connect once; the other tab can still have the earlier Connect form open.
  expect((await connect()).status).toBe(200);
  let started!: () => void;
  const checking = new Promise<void>(resolve => { started = resolve; });
  let finish!: (response: Response) => void;
  const reply = new Promise<Response>(resolve => { finish = resolve; });
  merchantAnswer = () => { started(); return reply; };
  const slower = connect();
  await checking;
  merchantAnswer = () => Response.json({ ...merchant, paymentAccountNumber: "SANDBOX-ACCT-0091" });
  try {
    const current = action === "Disconnect" ? await call("POST", "/v1/admin/settings/postage/disconnect") : await connect();
    expect(current.status).toBe(200);
    expect(current.json.settings.postageAccount?.accountEnding ?? null).toBe(action === "Disconnect" ? null : "0091");
  } finally {
    finish(carrierStatus === 200 ? Response.json(merchant) : new Response(null, { status: carrierStatus }));
  }
  const late = await slower;
  expect(late.status).toBe(409);
  expect(late.json.error.code).toBe("POSTAGE_SETTINGS_CHANGED");
  expect((await settings()).json.settings.postageAccount?.accountEnding ?? null).toBe(action === "Disconnect" ? null : "0091");

  // An intentional fresh Connect still works.
  expect((await connect()).status).toBe(200);
  expect((await settings()).json.settings.postageAccount.accountEnding).toBe("0091");
});

test("label history lists every label newest first with its order number, 50 at a time", async () => {
  await runInDurableObject(shipStore(), async instance => { await instance.getSettings(); });
  await runInDurableObject(shipStore(), async (_, state) => {
    const sql = state.storage.sql;
    sql.exec("INSERT INTO orders (order_id, version, record, first_received_at, updated_at) VALUES ('order:a', 1, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
      JSON.stringify({ orderId: "order:a", number: 1001, version: 1, status: "processing", test: true, shipTo: { name: "A", line1: "1 A St", city: "A", region: "CA", postalCode: "90000", country: "US" }, lines: [] }));
    const box = JSON.stringify({ boxId: "box_1", name: "Small", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3 });
    for (let index = 0; index < LABEL_HISTORY_PAGE + 5; index++) {
      const at = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
      sql.exec(`INSERT INTO labels (label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at, cancelled_at, price_cents)
        VALUES (?, ?, 1, 1, 'PM', ?, 20, 'USPS', ?, ?, ?, 'admin:staff@example.test', ?, NULL, 935)`,
        `label_${String(index).padStart(3, "0")}`, index % 2 ? "order:a" : "order:gone", box, `TRACK-${index}`, new Uint8Array([1]), index === 54 ? "cancelled" : "bought", at);
    }
  });
  const first = await call("GET", "/v1/admin/labels");
  expect(first.status).toBe(200);
  expect(first.json.labels).toHaveLength(LABEL_HISTORY_PAGE);
  expect(first.json.labels[0]).toMatchObject({ labelId: "label_054", status: "cancelled", number: null, tracking: "TRACK-54", priceCents: 935 });
  expect(first.json.labels[1]).toMatchObject({ labelId: "label_053", orderId: "order:a", number: 1001 });
  // The PDF never travels in the history.
  expect(first.text).not.toContain("pdf");
  const second = await call("GET", `/v1/admin/labels?before=${encodeURIComponent(first.json.next)}`);
  expect(second.json.labels.map((label: { labelId: string }) => label.labelId)).toEqual(["label_004", "label_003", "label_002", "label_001", "label_000"]);
  expect(second.json.next).toBeNull();
  expect((await call("GET", "/v1/admin/labels?before=nonsense")).json.error.code).toBe("INVALID_INPUT");
  expect((await call("GET", "/v1/admin/labels", { site: `site-${crypto.randomUUID()}` })).json).toEqual({ labels: [], next: null });
});
