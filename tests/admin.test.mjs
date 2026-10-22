import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import plugin from "../dist/plugin.mjs";
import { validateBlockResponse } from "@emdash-cms/blocks/server";

// The Shipping page against stand-ins for DinkusKit.com's store-passes and hosted
// Ship: what the admin sees, what the plugin sends, and what it never sends.

const SITE = "site_demo";
const KEY = "dk_store_" + "k".repeat(43);
const admin = plugin.routes.admin.handler;
const box = { boxId: "box_small", name: "Small", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3 };
const settings = { shipFrom: true, boxes: [box], postageConnected: true, testSandbox: true };
const row = (extra = {}) => ({
  orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
  shipTo: { name: "Demo Shopper", lines: ["1 Example Way"], city: "Testville", region: "CA", postalCode: "90000" },
  addressProblem: null, items: "2 × Demo Mug", itemCount: 1, labelStatus: null, ...extra,
});
const order = (extra = {}) => ({
  orderId: "order:abc", number: 1001, version: 1, status: "processing", test: true,
  shipTo: { name: "Demo Shopper", lines: ["1 Example Way"], city: "Testville", region: "CA", postalCode: "90000" },
  addressProblem: null, lines: [{ name: "Demo Mug", quantity: 2, weightOz: 12.5 }], itemsWeightOz: 25, label: null, labels: [], ...extra,
});
const label = (extra = {}) => ({
  labelId: "label_1", orderId: "order:abc", version: 1, test: true, service: "PM", box, weightOz: 28, carrier: "USPS", tracking: "SANDBOX-TRACKING-A",
  status: "bought", createdAt: "2026-10-19T22:00:00.000Z", cancelledAt: null, practice: false, priceCents: 935, refund: null, ...extra,
});
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const pass = (claims = {}) => `${b64({ alg: "ES256" })}.${b64({ iss: "https://dinkuskit.com/account", aud: "dinkus-ship", sub: "biz", site_id: SITE,
  scope: "ship:admin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...claims })}.${b64("sig")}`;

/** A host with the plugin's settings, a fake network, the plugin's KV (a Map, or null for a host without one), and an Editor at the Shipping page. */
function host({ siteId = SITE, key = KEY, ship = {}, passes = () => Response.json({ access_token: pass(), token_type: "Bearer", expires_in: 300 }), role = 40, requestUrl = "",
  kv = new Map(), dinkus = {}, pluginId = "dinkus-ship", siteUrl = "https://shop.example.test", legacy = null } = {}) {
  const calls = [];
  // The encrypted "connection" setting Connect fills, with a revision per write.
  const stored = new Map(siteId && key ? [["connection", { value: JSON.stringify({ siteId, storeKey: key }), revision: "1" }]] : []);
  // Ship 0.2.1's pasted settings: a plain Store ID and a key still encrypted under a secret this version no longer declares.
  if (legacy) {
    stored.set("siteId", { value: legacy.siteId, revision: "1" });
    stored.set("storeKey", { value: { encrypted: legacy.storeKey }, revision: "1" });
  }
  let revisions = 1;
  const ctx = {
    plugin: { id: pluginId, version: "0.3.0" },
    site: { url: siteUrl, name: "Shop", locale: "en" },
    settings: {
      get: async name => {
        // As on the host: a setting encrypted under a secret the schema no longer declares cannot be read.
        if (typeof stored.get(name)?.value === "object") throw new Error("Encrypted plugin setting is not declared as a secret");
        return stored.get(name)?.value ?? null;
      },
      delete: async name => stored.delete(name),
      getVersioned: async name => stored.get(name) ?? null,
      compareAndSet: async (name, revision, value) => {
        if ((stored.get(name)?.revision ?? null) !== revision) return { applied: false };
        stored.set(name, { value, revision: String(++revisions) });
        return { applied: true };
      },
    },
    ...(kv === null ? {} : { kv: { get: async name => kv.has(name) ? kv.get(name) : null, set: async (name, value) => { kv.set(name, value); }, delete: async name => kv.delete(name) } }),
    http: { fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const adminPage = init?.headers?.["x-ship-admin-page"], adminUser = init?.headers?.["x-ship-admin-user"];
      calls.push({ url, method: init?.method ?? "GET", authorization: init?.headers?.authorization, ...(adminPage === undefined ? {} : { adminPage }), ...(adminUser === undefined ? {} : { adminUser }), body });
      if (url === "https://dinkuskit.com/api/store-passes") return passes({ url, init, body });
      if (url.startsWith("https://dinkuskit.com/api/store-connections")) {
        const answer = dinkus[new URL(url).pathname];
        if (!answer) throw new Error(`unexpected call ${url}`);
        return typeof answer === "function" ? answer(body) : Response.json(answer);
      }
      const path = new URL(url).pathname;
      const answer = ship[`${init?.method ?? "GET"} ${path}`];
      if (!answer) throw new Error(`unexpected call ${init?.method ?? "GET"} ${path}`);
      return typeof answer === "function" ? answer(body) : Response.json(answer);
    } },
    log: { error() {}, info() {}, warn() {}, debug() {} },
  };
  const route = input => ({ input, ui: { surface: "admin-page", locale: "en", direction: "ltr" }, user: { id: "u1", email: "staff@example.test", name: "Staff", role, createdAt: "" }, request: { url: requestUrl, method: "POST", headers: {} } });
  // Every answer must be Block Kit the host would render.
  const page = async input => {
    const response = await admin(route(input), ctx);
    const checked = validateBlockResponse(response);
    if (!checked.valid) throw new Error(`invalid Block Kit: ${JSON.stringify(checked.errors)}`);
    return response;
  };
  return { ctx, calls, page, route, kv, stored, saved: () => JSON.parse(stored.get("connection")?.value ?? "{}") };
}
const text = response => JSON.stringify(response);
const load = { type: "page_load", page: "/shipping" };
const trades = h => h.calls.filter(call => call.url === "https://dinkuskit.com/api/store-passes").length;
const PASS_KEY = `cache:pass:${SITE}`;
/** What the plugin keeps beside a pass: a SHA-256 fingerprint of the key it was traded with. */
const FINGERPRINT = createHash("sha256").update(KEY).digest("hex");
const keptPass = (token, key = FINGERPRINT) => ({ token, key });

test("lower roles and other surfaces never reach Ship", async () => {
  const h = host({ role: 30 });
  assert.match(text(await h.page(load)), /Editors and Administrators/);
  const r = h.route(load);
  assert.match(text(await admin({ ...r, ui: { surface: "dashboard-widget" } }, h.ctx)), /Editors and Administrators/);
  assert.match(text(await admin({ ...r, user: undefined }, h.ctx)), /Editors and Administrators/);
  assert.deepEqual(h.calls, []);
});

const CONNECTION = "conn_1";
const started = (extra = {}) => ({ protocol_version: 2, site_id: SITE, connection_id: CONNECTION, challenge: "challenge-1", expires_at: Date.now() + 300_000,
  interval: 5, verification_uri: `https://dinkuskit.com/account/connect?connection_id=${CONNECTION}`, ...extra });
const proof = plugin.routes["store-proof"].handler;
const proofOf = async (h, input) => {
  const response = await proof({ input, request: { url: "", method: "GET", headers: {} } }, h.ctx);
  return { status: response.status, body: JSON.parse(response.body.value) };
};

test("until Connect has run the page asks an Administrator to press Connect, and an Editor to ask one", async () => {
  const admin = host({ siteId: null, key: null, role: 50 });
  const page = text(await admin.page(load));
  assert.match(page, /Connect Ship/);
  assert.match(page, /"action_id":"connect"/);
  assert.doesNotMatch(page, /plugin-settings|Paste/);
  assert.deepEqual(admin.calls, []);
  const editor = host({ siteId: null, key: null });
  assert.match(text(await editor.page({ type: "block_action", action_id: "connect" })), /Ask an Administrator of this site to press Connect/);
  assert.deepEqual(editor.calls, [], "an Editor's Connect asks DinkusKit.com nothing");
});

test("Connect: the owner approves at DinkusKit.com, the proof route vouches for this store, and the plugin keeps its own key", async () => {
  let approved = false;
  const issued = "dk_store_" + "n".repeat(43);
  const h = host({ siteId: null, key: null, role: 50, dinkus: {
    "/api/store-connections": started(),
    "/api/store-connections/token": () => approved ? Response.json({ store_key: issued, site_id: SITE }) : Response.json({ error: "authorization_pending", interval: 5 }, { status: 400 }),
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  const pending = text(await h.page({ type: "block_action", action_id: "connect" }));
  assert.match(pending, /Approve at DinkusKit.com/);
  assert.match(pending, /connect\?connection_id=conn_1/);
  const start = h.calls[0];
  assert.equal(start.url, "https://dinkuskit.com/api/store-connections");
  assert.deepEqual({ ...start.body, code_challenge: undefined }, { protocol_version: 2, client_id: "dinkus-ship-emdash", service: "ship", site_origin: "https://shop.example.test",
    callback_uri: "https://shop.example.test/_emdash/admin/plugins/r_ehdlg5cxkb3ffqvr/shipping", code_challenge: undefined, code_challenge_method: "S256" });
  const verifier = h.saved().flow.verifier;
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), start.body.code_challenge);
  assert.doesNotMatch(JSON.stringify([...h.kv.values()]), new RegExp(verifier), "the verifier stays in the encrypted setting");

  // DinkusKit.com reads the receipt from the store's own web address; nothing else is answered.
  const receipt = await proofOf(h, { connection_id: CONNECTION });
  assert.equal(receipt.status, 200);
  assert.deepEqual({ ...receipt.body, code_challenge: undefined, expires_at: undefined }, { version: 2, site_id: SITE, connection_id: CONNECTION, challenge: "challenge-1",
    client_id: "dinkus-ship-emdash", service: "ship", site_origin: "https://shop.example.test",
    callback_uri: "https://shop.example.test/_emdash/admin/plugins/r_ehdlg5cxkb3ffqvr/shipping", code_challenge: undefined, expires_at: undefined });
  assert.equal((await proofOf(h, { connection_id: "other" })).status, 404);
  assert.equal((await proofOf(h, { connection_id: CONNECTION, extra: "1" })).status, 400);

  // Check before the owner approves: still waiting.
  assert.match(text(await h.page({ type: "block_action", action_id: "check" })), /Not approved yet/);
  const tokenCall = h.calls.at(-1);
  assert.deepEqual(tokenCall.body, { client_id: "dinkus-ship-emdash", connection_id: CONNECTION, code_verifier: verifier });

  // The owner approves; DinkusKit.com sends them back and the page load finishes Connect.
  approved = true;
  h.kv.set("state:connect", { ...h.kv.get("state:connect"), nextPollAt: 0 });
  const list = text(await h.page(load));
  assert.match(list, /#1001/);
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: issued });
  assert.equal(h.calls.find(call => call.url === "https://dinkuskit.com/api/store-passes").authorization, `Bearer ${issued}`);
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 404, "a finished Connect vouches for nothing");
});

test("Ship joins the store Commerce made: before Commerce connects, Connect says so", async () => {
  const h = host({ siteId: null, key: null, role: 50, dinkus: { "/api/store-connections": () => Response.json({ error: "connect_commerce_first" }, { status: 409 }) } });
  const page = text(await h.page({ type: "block_action", action_id: "connect" }));
  assert.match(page, /Connect Commerce first/);
  assert.deepEqual(h.saved(), {});
});

test("a refused or answered-wrong Connect starts over, and Cancel keeps the key the store already had", async () => {
  const denied = host({ siteId: null, key: null, role: 50, dinkus: { "/api/store-connections": started(), "/api/store-connections/token": () => Response.json({ error: "access_denied" }, { status: 400 }) } });
  await denied.page({ type: "block_action", action_id: "connect" });
  assert.match(text(await denied.page({ type: "block_action", action_id: "check" })), /did not approve Ship/);
  assert.equal(denied.saved().flow, undefined);

  const wrongStore = host({ siteId: null, key: null, role: 50, dinkus: { "/api/store-connections": started(), "/api/store-connections/token": { store_key: KEY, site_id: "site_other" } } });
  await wrongStore.page({ type: "block_action", action_id: "connect" });
  assert.match(text(await wrongStore.page({ type: "block_action", action_id: "check" })), /Connect did not finish/);
  assert.deepEqual(wrongStore.saved(), {});

  const badLink = host({ siteId: null, key: null, role: 50, dinkus: { "/api/store-connections": started({ verification_uri: "https://evil.example/approve" }) } });
  assert.match(text(await badLink.page({ type: "block_action", action_id: "connect" })), /Connect did not finish/);
  assert.equal(badLink.saved().flow, undefined);

  // Connect again on a connected store, then Cancel: the old key still buys labels.
  const again = host({ role: 50, dinkus: { "/api/store-connections": started() }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await again.page({ type: "block_action", action_id: "connect" });
  assert.equal(again.saved().storeKey, KEY);
  assert.match(text(await again.page({ type: "block_action", action_id: "cancel_connect" })), /#1001/);
  assert.deepEqual(again.saved(), { siteId: SITE, storeKey: KEY });

  // The proof route vouches only for the Connect still waiting; Cancel takes its receipt away too.
  const kv = new Map();
  const fenced = host({ role: 50, kv, dinkus: { "/api/store-connections": started() }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await fenced.page({ type: "block_action", action_id: "connect" });
  assert.equal((await proofOf(fenced, { connection_id: CONNECTION })).status, 200);
  await fenced.page({ type: "block_action", action_id: "cancel_connect" });
  assert.equal((await proofOf(fenced, { connection_id: CONNECTION })).status, 404);
  assert.equal(kv.has("state:connect"), false, "no receipt is left behind");
  const replaced = new Map();
  const other = host({ role: 50, kv: replaced, dinkus: { "/api/store-connections": started() }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await other.page({ type: "block_action", action_id: "connect" });
  replaced.set("state:connect", { ...replaced.get("state:connect"), flowId: "another-flow" });
  assert.equal((await proofOf(other, { connection_id: CONNECTION })).status, 404, "a receipt for a flow the setting no longer holds is refused");

  // Only a Registry install on its https address can Connect.
  for (const options of [{ pluginId: "something-else" }, { siteUrl: "http://shop.example.test" }]) {
    const h = host({ siteId: null, key: null, role: 50, ...options });
    assert.match(text(await h.page({ type: "block_action", action_id: "connect" })), /https web address/);
    assert.deepEqual(h.calls, []);
  }
});

test("a store upgraded from 0.2.1 never uses its pasted key: it is told to Connect once, and Connect forgets the old settings", async () => {
  const issued = "dk_store_" + "u".repeat(43);
  const editor = host({ siteId: null, key: null, legacy: { siteId: SITE, storeKey: KEY } });
  const page = text(await editor.page(load));
  assert.match(page, /no longer used/);
  assert.match(page, /Ask an Administrator of this site to press Connect/);
  assert.deepEqual(editor.calls, [], "the pasted key is not traded for a pass");

  const h = host({ siteId: null, key: null, role: 50, legacy: { siteId: SITE, storeKey: KEY }, dinkus: {
    "/api/store-connections": started(), "/api/store-connections/token": { store_key: issued, site_id: SITE },
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  assert.match(text(await h.page(load)), /"label":"Connect again","action_id":"connect"/);
  await h.page({ type: "block_action", action_id: "connect" });
  assert.match(text(await h.page({ type: "block_action", action_id: "check" })), /#1001/);
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: issued });
  assert.equal(h.stored.has("siteId") || h.stored.has("storeKey"), false, "the 0.2.1 settings are gone once Connect finishes");
  assert.doesNotMatch(JSON.stringify(h.calls), new RegExp(KEY), "the pasted key was never sent anywhere");
});

test("a page load while Connect again is saving never wipes the new Connect", async () => {
  const kv = new Map();
  const issued = "dk_store_" + "r".repeat(43);
  let approved = false;
  const h = host({ siteId: null, key: null, role: 50, kv, dinkus: {
    "/api/store-connections": body => Response.json(started({ connection_id: approved ? "conn_2" : CONNECTION, verification_uri: `https://dinkuskit.com/account/connect?connection_id=${approved ? "conn_2" : CONNECTION}`, challenge: body.code_challenge.slice(0, 8) })),
    "/api/store-connections/token": body => body.connection_id === "conn_2" ? Response.json({ store_key: issued, site_id: SITE }) : Response.json({ error: "authorization_pending" }, { status: 400 }),
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await h.page({ type: "block_action", action_id: "connect" });
  const first = h.saved().flow.id;
  // Connect again; another Shipping page load runs right after the first of the two writes it makes, whichever that is.
  approved = true;
  const seen = [];
  let armed = true;
  const between = write => async (...args) => {
    const result = await write(...args);
    if (armed) {
      armed = false;
      seen.push(text(await h.page(load)));
    }
    return result;
  };
  h.ctx.kv.set = between(h.ctx.kv.set);
  h.ctx.settings.compareAndSet = between(h.ctx.settings.compareAndSet);
  assert.match(text(await h.page({ type: "block_action", action_id: "connect" })), /connect\?connection_id=conn_2/);
  assert.match(seen[0], /Approve at DinkusKit.com/, "the page in between shows the Connect waiting");
  assert.notEqual(h.saved().flow.id, first);
  assert.equal(kv.get("state:connect").flowId, h.saved().flow.id, "the new verifier and its waiting record match");
  assert.equal((await proofOf(h, { connection_id: "conn_2" })).status, 200);
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 404, "the replaced Connect is not vouched for");
  assert.match(text(await h.page({ type: "block_action", action_id: "check" })), /#1001/);
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: issued });
});

test("a key DinkusKit.com no longer knows asks for Connect again", async () => {
  for (const error of ["invalid_store_key", "site_mismatch"]) {
    const page = text(await host({ role: 50, passes: () => Response.json({ error }, { status: 401 }) }).page(load));
    assert.match(page, /Connect Ship again/);
    assert.match(page, /"label":"Connect again","action_id":"connect"/);
  }
});

test("the store key goes only to DinkusKit.com, and the pass goes only to Ship", async () => {
  const h = host({ ship: { "GET /v1/admin/orders": { orders: [row(), row({ orderId: "order:def", number: 1002, labelStatus: "bought", items: "1 × Hat, +3 more" })], settings } } });
  const page = text(await h.page(load));
  assert.match(page, /#1001 \(TEST\)/);
  assert.match(page, /"status":"No label"/);
  assert.match(page, /"items":"1 × Hat, \+3 more","status":"Label bought"/);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0], { url: "https://dinkuskit.com/api/store-passes", method: "POST", authorization: `Bearer ${KEY}`, body: { site_id: SITE, scope: "ship:admin", audience: "dinkus-ship" } });
  assert.equal(h.calls[1].url, "https://ship.dinkuskit.com/v1/admin/orders");
  assert.match(h.calls[1].authorization, /^Bearer ey/);
  assert.notEqual(h.calls[1].authorization, `Bearer ${KEY}`);
  assert.doesNotMatch(page, new RegExp(KEY));
  assert.doesNotMatch(JSON.stringify([...h.kv.values()]), new RegExp(KEY), "the KV keeps the pass, never the key");
});

test("the pass is kept and reused across clicks, so the key is traded once, not once per click", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders": { orders: [row()], settings },
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
  } });
  await h.page(load);
  assert.equal(trades(h), 1);
  const { token: kept, key } = h.kv.get(PASS_KEY);
  assert.match(kept, /^ey/);
  assert.equal(key, FINGERPRINT, "the key's fingerprint, never the key");
  await h.page({ type: "block_action", action_id: "open", value: "order:abc", page: "/shipping" });
  await h.page(load);
  assert.equal(trades(h), 1, "two more clicks, no new trade");
  for (const call of h.calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com/"))) assert.equal(call.authorization, `Bearer ${kept}`);
  // Another store's pass is never this store's.
  const other = host({ siteId: "site_other", kv: h.kv, passes: () => Response.json({ access_token: pass({ site_id: "site_other" }), token_type: "Bearer", expires_in: 300 }),
    ship: { "GET /v1/admin/orders": { orders: [], settings } } });
  assert.match(text(await other.page(load)), /No paid orders/);
  assert.equal(trades(other), 1);
  assert.notEqual(other.kv.get("cache:pass:site_other").token, kept);
  assert.equal(h.kv.get(PASS_KEY).token, kept, "the first store's pass is untouched");
});

test("a kept pass over a minute old, under 30 seconds left, not this store's, traded with another key, or malformed is replaced by a fresh one", async () => {
  const now = Math.floor(Date.now() / 1000);
  const stale = {
    "traded 61 seconds ago": keptPass(pass({ iat: now - 61, exp: now + 239 })),
    "no iat": keptPass(pass({ iat: undefined })),
    "under 30 seconds left": keptPass(pass({ exp: now + 20 })),
    "another store's": keptPass(pass({ site_id: "site_other" })),
    "a newly pasted key": keptPass(pass(), createHash("sha256").update("dk_store_" + "o".repeat(43)).digest("hex")),
    "no key": { token: pass() },
    "a bare token": pass(),
    "not a pass": "not-a-pass",
    "a number": 42,
  };
  for (const [why, entry] of Object.entries(stale)) {
    const h = host({ kv: new Map([[PASS_KEY, entry]]), ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
    assert.match(text(await h.page(load)), /#1001/, why);
    assert.equal(trades(h), 1, why);
    assert.notDeepEqual(h.kv.get(PASS_KEY), entry, why);
    assert.equal(h.calls.at(-1).authorization, `Bearer ${h.kv.get(PASS_KEY).token}`, `${why}: the fresh pass is the one used and kept`);
  }
});

test("a kept pass Ship no longer accepts is dropped and the call retried once on a fresh pass", async () => {
  const stale = pass({ sub: "old" });
  const h = host({ kv: new Map([[PASS_KEY, keptPass(stale)]]), ship: { "GET /v1/admin/orders": () => h.calls.at(-1).authorization === `Bearer ${stale}`
    ? Response.json({ error: { code: "UNAUTHORIZED", message: "Pass refused" } }, { status: 401 })
    : Response.json({ orders: [row()], settings }) } });
  assert.match(text(await h.page(load)), /#1001/);
  assert.equal(trades(h), 1);
  assert.equal(h.calls.filter(call => call.url.endsWith("/v1/admin/orders")).length, 2, "one refused call, one retry");
  assert.notEqual(h.kv.get(PASS_KEY).token, stale);
  // A fresh pass Ship refuses is reported, not retried again.
  const refusing = host({ ship: { "GET /v1/admin/orders": () => Response.json({ error: { code: "UNAUTHORIZED", message: "Pass refused" } }, { status: 401 }) } });
  assert.match(text(await refusing.page(load)), /Pass refused/);
  assert.equal(trades(refusing), 1);
  assert.equal(refusing.calls.filter(call => call.url.endsWith("/v1/admin/orders")).length, 1);
});

test("a host without KV still works, trading the key once per click", async () => {
  const h = host({ kv: null, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  assert.match(text(await h.page(load)), /#1001/);
  assert.match(text(await h.page(load)), /#1001/);
  assert.equal(trades(h), 2);
});

test("DinkusKit.com's refusals and bad passes stop the click with a plain reason", async () => {
  const refused = await host({ passes: () => Response.json({ error: "service_not_enabled" }, { status: 403 }) }).page(load);
  assert.match(text(refused), /Ship is turned off for this store/);
  const wrongStore = await host({ passes: () => Response.json({ access_token: pass({ site_id: "other" }) }) }).page(load);
  assert.match(text(wrongStore), /pass Ship cannot use/);
  const wrongScope = await host({ passes: () => Response.json({ access_token: pass({ scope: "ship:orders" }) }) }).page(load);
  assert.match(text(wrongScope), /pass Ship cannot use/);
  const down = await host({ passes: () => { throw new Error("offline"); } }).page(load);
  assert.match(text(down), /DinkusKit.com could not be reached/);
});

test("opening an order shows the form with the items plus box weight, then prices, then buys with who pressed the button", async () => {
  const sent = [];
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/prices": body => { sent.push(body); return Response.json({ prices: { GA: 510, PM: 935, EM: null } }); },
    "POST /v1/admin/orders/order%3Aabc/labels": body => { sent.push(body); return Response.json({ label: label({ service: body.service }) }, { status: 201 }); },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const form = opened.blocks.find(block => block.type === "form");
  assert.equal(form.submit.action_id, "prices:1:order%3Aabc");
  assert.deepEqual(form.fields.map(field => field.action_id), ["boxId", "weightOz", "kind"]);
  // Weight is typed as text: a number field would refuse most tenths of an ounce.
  assert.equal(form.fields[1].type, "text_input");
  assert.equal(form.fields[1].initial_value, "28");
  assert.match(text(opened), /TEST order/);

  const priced = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: " 30.0 oz", kind: "sandbox" } });
  assert.deepEqual(sent[0], { version: 1, boxId: "box_small", weightOz: 30, by: "staff@example.test" });
  const buy = priced.blocks.find(block => block.type === "form");
  assert.equal(buy.submit.action_id, "buy:1:order%3Aabc");
  assert.equal(buy.fields[1].initial_value, "30");
  const service = buy.fields.find(field => field.action_id === "service");
  assert.deepEqual(service.options.map(option => option.label), ["USPS Ground Advantage: $5.10", "USPS Priority Mail: $9.35", "USPS Priority Mail Express: not available for this package"]);

  const bought = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: { boxId: "box_small", weightOz: 30, service: "PM", kind: "sandbox" } });
  assert.deepEqual(sent[1], { version: 1, boxId: "box_small", weightOz: 30, service: "PM", by: "staff@example.test" });
  assert.equal(bought.toast.message, "Label bought, $9.35 sandbox. Tracking SANDBOX-TRACKING-A.");
  // The page after buying is read from Ship again; the stand-in still has no label, so the form shows again.
  assert.ok(bought.blocks.some(block => block.type === "form"));
});

test("a labelled order shows the label with a five-minute print link and a guarded Cancel", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ label: label(), labels: [label()] }), settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
    "POST /v1/admin/labels/label_1/cancel": { labelId: "label_1", refund: "INITIATED" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const actions = page.blocks.filter(block => block.type === "actions").flatMap(block => block.elements);
  const print = actions.find(element => element.label === "Print label");
  assert.deepEqual(print.target, { kind: "external", url: "https://ship.dinkuskit.com/print/tok.sig" });
  const cancel = actions.find(element => element.label === "Cancel label");
  assert.equal(cancel.action_id, "cancel:order%3Aabc");
  assert.equal(cancel.value, "label_1");
  assert.equal(cancel.confirm.style, "danger");
  assert.match(text(page), /"label":"Status","value":"Label bought"/);
  assert.match(text(page), /SANDBOX-TRACKING-A \(test, not trackable\)/);
  assert.ok(!actions.some(element => element.label === "Track on USPS"));
  assert.ok(!page.blocks.some(block => block.type === "form"));

  // Ship records a refund for the sandbox label too, but no postage comes back, so the page never promises one.
  const cancelled = await h.page({ type: "block_action", action_id: "cancel:order%3Aabc", value: "label_1" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/cancel")).length, 1);
  assert.equal(cancelled.toast.message, "Label cancelled.");
});

test("cancelling a live label promises the USPS refund; a cancelled sandbox label never mentions one", async () => {
  const live = label({ labelId: "label_2", test: false, tracking: "9400100000000000000002" });
  const sandboxCancelled = label({ status: "cancelled", cancelledAt: "2026-10-19T22:30:00.000Z", refund: "INITIATED" });
  const liveCancelled = { ...live, status: "cancelled", cancelledAt: "2026-10-19T22:40:00.000Z", refund: "INITIATED" };
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: live, labels: [sandboxCancelled, live] }), settings },
    "POST /v1/admin/labels/label_2/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
    "POST /v1/admin/labels/label_2/cancel": { labelId: "label_2", refund: "INITIATED" },
  } });
  const cancelled = await h.page({ type: "block_action", action_id: "cancel:order%3Aabc", value: "label_2" });
  assert.equal(cancelled.toast.message, "Label cancelled. USPS refunds the postage account within about 14 days.");
  const sandboxRow = text(await h.page({ type: "block_action", action_id: "open", value: "order:abc" }));
  assert.match(sandboxRow, /"label":"Cancelled","value":"2026-10-19 22:30"/);
  assert.doesNotMatch(sandboxRow, /2026-10-19 22:30, refund/);

  const after = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: null, labels: [sandboxCancelled, liveCancelled] }), settings } } });
  const page = text(await after.page({ type: "block_action", action_id: "open", value: "order:abc" }));
  assert.match(page, /"label":"Cancelled","value":"2026-10-19 22:40, refund initiated"/);
  assert.doesNotMatch(page, /22:30, refund/);
});

test("a live label's tracking number links to USPS, for the live label and the earlier ones", async () => {
  const live = label({ labelId: "label_2", test: false, tracking: "9400100000000000000002" });
  const old = label({ labelId: "label_1", test: false, tracking: "9400100000000000000001", status: "cancelled", cancelledAt: "2026-10-19T22:30:00.000Z", refund: "INITIATED" });
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: live, labels: [old, live] }), settings },
    "POST /v1/admin/labels/label_2/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const links = text(page).match(/https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=[0-9]+/g);
  assert.deepEqual(links, ["https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000002", "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000001"]);
  assert.match(text(page), /\$9\.35 from your Pitney Bowes postage account/);
});

test("after \"tick Buy a new label\" the form stays on the buy step and the next buy carries the confirmation", async () => {
  const sent = [];
  let answers = 0;
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false }), settings },
    "POST /v1/admin/orders/order%3Aabc/labels": body => { sent.push(body); return answers++ === 0
      ? Response.json({ error: { code: "CHECK_PITNEY_BOWES", message: "Pitney Bowes did not answer the last time." } }, { status: 409 })
      : Response.json({ label: label({ test: false, service: body.service, tracking: "9400100000000000000003" }) }, { status: 201 }); },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const refused = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: { boxId: "box_small", weightOz: 31, service: "PM" } });
  const form = refused.blocks.find(block => block.type === "form");
  assert.equal(form.submit.action_id, "buy:1:order%3Aabc");
  assert.equal(form.submit.label, "Buy label");
  assert.equal(form.fields.find(field => field.action_id === "service").initial_value, "PM");
  const toggle = form.fields.find(field => field.action_id === "buyAgain");
  assert.equal(toggle.initial_value, false);
  const bought = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: { boxId: "box_small", weightOz: 31, service: "PM", buyAgain: true } });
  assert.deepEqual(sent[1], { version: 1, boxId: "box_small", weightOz: 31, service: "PM", buyAgain: true, by: "staff@example.test" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 0);
  assert.match(bought.toast.message, /Label bought, \$9\.35\. Tracking 9400100000000000000003/);
});

test("a practice label skips the prices step, since Pitney Bowes is not asked", async () => {
  const sent = [];
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/labels": body => { sent.push(body); return Response.json({ label: label({ practice: true, priceCents: null, tracking: "TEST000000000000000001" }) }, { status: 201 }); },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const chosen = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: 30, kind: "practice" } });
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 0);
  const form = chosen.blocks.find(block => block.type === "form");
  assert.equal(form.submit.action_id, "buy:1:order%3Aabc");
  assert.equal(form.submit.label, "Make practice label");
  assert.equal(form.fields.find(field => field.action_id === "kind").initial_value, "practice");
  assert.deepEqual(form.fields.find(field => field.action_id === "service").options.map(option => option.label), ["USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express"]);
  assert.match(text(chosen), /no prices to see/);
  const made = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: { boxId: "box_small", weightOz: 30, service: "GA", kind: "practice" } });
  assert.deepEqual(sent[0], { version: 1, boxId: "box_small", weightOz: 30, service: "GA", kind: "practice", by: "staff@example.test" });
  assert.equal(made.toast.message, "Practice label made.");
});

test("a Completed order keeps its label's Print and Cancel, and gets no form", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ version: 2, status: "completed", label: label(), labels: [label()] }), settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const actions = page.blocks.filter(block => block.type === "actions").flatMap(block => block.elements);
  assert.ok(actions.some(element => element.label === "Print label"));
  assert.ok(actions.some(element => element.label === "Cancel label"));
  assert.ok(!page.blocks.some(block => block.type === "form"));
  assert.doesNotMatch(text(page), /Ship makes no label for it/);
});

test("Ship's refusals keep the order page, with the reason and what was typed", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/labels": () => Response.json({ error: { code: "CHECK_PITNEY_BOWES", message: "Pitney Bowes did not answer the last time." } }, { status: 409 }),
    "POST /v1/admin/orders/order%3Aabc/prices": () => Response.json({ error: { code: "ORDER_CHANGED", message: "The order changed in Commerce since this page opened." } }, { status: 409 }),
  } });
  const refused = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: { boxId: "box_small", weightOz: 31, service: "GA" } });
  assert.match(text(refused), /Pitney Bowes did not answer the last time/);
  const form = refused.blocks.find(block => block.type === "form");
  assert.ok(form.fields.some(field => field.action_id === "buyAgain"));
  assert.equal(form.fields[1].initial_value, "31");
  const changed = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: 31 } });
  assert.match(text(changed), /order changed in Commerce/);
  // Impossible input never reaches Ship.
  const before = h.calls.length;
  for (const weightOz of [5000, "", "two pounds", "0"]) {
    const heavy = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz } });
    assert.match(text(heavy), /0.1 to 1120/);
  }
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 1);
  assert.ok(h.calls.length > before); // the page itself was re-read
});

test("the page says what to set up on Ship before a label can be bought", async () => {
  const bare = { shipFrom: false, boxes: [], postageConnected: false, testSandbox: true };
  const h = host({ ship: { "GET /v1/admin/orders": { orders: [], settings: bare }, "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false }), settings: { ...settings, postageConnected: false } } } });
  const list = text(await h.page(load));
  assert.match(list, /Set up Ship first/);
  assert.match(list, /No paid orders have reached Ship yet/);
  assert.match(list, /https:\/\/ship.dinkuskit.com\/stores\/site_demo\/settings/);
  const real = text(await h.page({ type: "block_action", action_id: "open", value: "order:abc" }));
  assert.match(real, /Connect your Pitney Bowes account first/);
  assert.doesNotMatch(real, /"type":"form"/);
});

test("a completed order and a bad address get no form", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/done": { order: order({ orderId: "done", status: "completed" }), settings },
    "GET /v1/admin/orders/bad": { order: order({ orderId: "bad", addressProblem: "The address has no US state." }), settings },
  } });
  assert.match(text(await h.page({ type: "block_action", action_id: "open", value: "done" })), /Completed in Commerce/);
  const bad = text(await h.page({ type: "block_action", action_id: "open", value: "bad" }));
  assert.match(bad, /no US state/);
  assert.doesNotMatch(bad, /"type":"form"/);
});

test("Ship learns where this store's Shipping page is and whose page load each call is, and opens the order it forwarded that person from", async () => {
  // EmDash calls the route at the admin API URL; the Shipping page is the same origin's plugin page.
  const h = host({ requestUrl: "https://shop.example.test/_emdash/api/plugins/dinkus-ship-1/admin", ship: {
    "GET /v1/admin/orders": { orders: [row()], settings, open: "order:abc" },
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
  } });
  const page = text(await h.page(load));
  assert.match(page, /Demo Mug/);
  assert.match(page, /prices:/, "the forwarded order opens, not the list");
  for (const call of h.calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com/"))) {
    assert.equal(call.adminPage, "https://shop.example.test/_emdash/admin/plugins/dinkus-ship-1/shipping");
    assert.equal(call.adminUser, "staff@example.test", "the admin EmDash attested, so Ship forwards and opens for that person alone");
  }
  const passCall = h.calls.find(call => call.url === "https://dinkuskit.com/api/store-passes");
  assert.equal(passCall.adminPage, undefined, "DinkusKit.com never gets the page");
  assert.equal(passCall.adminUser, undefined, "nor the admin");
  // "Open in Ship" asks for the full version, so Ship does not forward that click straight back here.
  assert.match(page, /\/orders\/order%3Aabc\?view=full/);
});

test("without a usable request URL no page is sent, and a list without an open order stays a list", async () => {
  for (const requestUrl of ["", "http://shop.example.test/_emdash/api/plugins/dinkus-ship-1/admin", "https://shop.example.test/other"]) {
    const h = host({ requestUrl, ship: { "GET /v1/admin/orders": { orders: [row()], settings, open: null } } });
    const page = text(await h.page(load));
    assert.match(page, /Demo Mug/);
    assert.doesNotMatch(page, /prices:/);
    assert.ok(h.calls.every(call => call.adminPage === undefined), requestUrl);
  }
});

test("a live label's delivery shows in the list and on the order, and a label without one reads Label bought", async () => {
  const delivered = { state: "delivered", at: "2026-10-22T18:02:00.000Z", note: "Delivered, In/At Mailbox" };
  const problem = { state: "problem", at: "2026-10-23T12:00:00.000Z", note: "Delivery attempted" };
  const live = label({ test: false, tracking: "9400100000000000000001", delivery: delivered });
  const h = host({ ship: {
    "GET /v1/admin/orders": { orders: [row({ labelStatus: "bought", delivery: delivered }), row({ orderId: "order:def", number: 1002, labelStatus: "bought", delivery: problem }), row({ orderId: "order:ghi", number: 1003, labelStatus: "bought", delivery: null })], settings },
    "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: live, labels: [live] }), settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/t", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const list = text(await h.page(load));
  assert.match(list, /"Delivered"/);
  assert.match(list, /"Problem"/);
  assert.doesNotMatch(list, /Delivery attempted/, "the list keeps the one word; the order page has the reason");
  assert.match(list, /"Label bought"/);
  const page = text(await h.page({ type: "block_action", action_id: "open", value: "order:abc", page: "/shipping" }));
  assert.match(page, /"label":"Delivery","value":"Delivered, 2026-10-22 18:02 UTC"/);
  assert.match(page, /"label":"Status","value":"Delivered"/);
});
