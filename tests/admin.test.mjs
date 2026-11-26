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
  kv = new Map(), dinkus = {}, pluginId = "dinkus-ship", siteUrl = "https://shop.example.test", legacy = null, joinable = false, connection = null } = {}) {
  const calls = [];
  // Finish setup's question and the connected-to read are kept apart from the calls the older tests count.
  const lookups = [], shared = [];
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
      if (url === "https://dinkuskit.com/api/store-connections/lookup") {
        lookups.push(body);
        return Response.json({ finish_setup: typeof joinable === "function" ? joinable() : joinable });
      }
      if (url === "https://dinkuskit.com/api/store-passes" && body?.scope === "store:connection") {
        shared.push({ url, authorization: init?.headers?.authorization, body });
        return connection ? Response.json({ access_token: "connection-pass", token_type: "Bearer", expires_in: 300 }) : Response.json({ error: "scope_not_allowed" }, { status: 403 });
      }
      if (url === "https://dinkuskit.com/api/store-connection") {
        shared.push({ url, authorization: init?.headers?.authorization });
        return Response.json(connection);
      }
      if (url === "https://dinkuskit.com/api/store-keys/cancel") {
        calls.push({ url, method: init?.method, authorization: init?.headers?.authorization, body });
        return Response.json({ cancelled: true });
      }
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
  return { ctx, calls, lookups, shared, page, route, kv, stored, saved: () => JSON.parse(stored.get("connection")?.value ?? "{}") };
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
  const waiting = `state:connect:${h.saved().flow.id}`;
  h.kv.set(waiting, { ...h.kv.get(waiting), nextPollAt: 0 });
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
  assert.equal([...kv.keys()].some(name => name.startsWith("state:connect")), false, "no receipt is left behind");
  const replaced = new Map();
  const other = host({ role: 50, kv: replaced, dinkus: { "/api/store-connections": started() }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await other.page({ type: "block_action", action_id: "connect" });
  const record = `state:connect:${other.saved().flow.id}`;
  replaced.set(record, { ...replaced.get(record), flowId: "another-flow" });
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
  assert.deepEqual([...kv.keys()].filter(name => name.startsWith("state:connect")), [`state:connect:${h.saved().flow.id}`], "only the new Connect's waiting record is left");
  assert.equal((await proofOf(h, { connection_id: "conn_2" })).status, 200);
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 404, "the replaced Connect is not vouched for");
  assert.match(text(await h.page({ type: "block_action", action_id: "check" })), /#1001/);
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: issued });
});

test("a slow Check of a cancelled Connect never wipes the Connect that replaced it", async () => {
  let answerFirst, first = true;
  const h = host({ siteId: null, key: null, role: 50, dinkus: {
    "/api/store-connections": () => Response.json(started(first ? {} : { connection_id: "conn_2", verification_uri: "https://dinkuskit.com/account/connect?connection_id=conn_2" })),
    "/api/store-connections/token": body => body.connection_id === CONNECTION
      ? new Promise(resolve => { answerFirst = () => resolve(Response.json({ error: "authorization_pending" }, { status: 400 })); })
      : Response.json({ error: "authorization_pending" }, { status: 400 }),
  } });
  await h.page({ type: "block_action", action_id: "connect" });
  const slow = h.page({ type: "block_action", action_id: "check" });
  while (!answerFirst) await new Promise(resolve => setTimeout(resolve, 1));
  // Another tab cancels and connects again while DinkusKit.com is still answering the first Check.
  await h.page({ type: "block_action", action_id: "cancel_connect" }); first = false;
  await h.page({ type: "block_action", action_id: "connect" });
  const replacement = h.saved().flow.id;
  answerFirst();
  await slow;
  assert.equal(h.saved().flow.id, replacement);
  assert.deepEqual([...h.kv.keys()].filter(name => name.startsWith("state:connect")), [`state:connect:${replacement}`]);
  assert.equal((await proofOf(h, { connection_id: "conn_2" })).status, 200);
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 404);
  assert.match(text(await h.page({ type: "block_action", action_id: "check" })), /Not approved yet/, "the replacement still waits for the owner");
  assert.equal(h.saved().flow.id, replacement);
});

test("a key that arrives late for a cancelled Connect is never saved", async () => {
  let answerFirst, first = true;
  const late = "dk_store_" + "l".repeat(43);
  const h = host({ role: 50, dinkus: {
    "/api/store-connections": () => Response.json(started(first ? {} : { connection_id: "conn_2", verification_uri: "https://dinkuskit.com/account/connect?connection_id=conn_2" })),
    "/api/store-connections/token": body => body.connection_id === CONNECTION
      ? new Promise(resolve => { answerFirst = () => resolve(Response.json({ store_key: late, site_id: SITE })); })
      : Response.json({ error: "authorization_pending" }, { status: 400 }),
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  await h.page({ type: "block_action", action_id: "connect" });
  const slow = h.page({ type: "block_action", action_id: "check" });
  while (!answerFirst) await new Promise(resolve => setTimeout(resolve, 1));
  // The owner approved, but the Administrator cancelled and pressed Connect again before the key came back.
  await h.page({ type: "block_action", action_id: "cancel_connect" }); first = false;
  await h.page({ type: "block_action", action_id: "connect" });
  const replacement = h.saved().flow.id;
  answerFirst();
  await slow;
  assert.equal(h.saved().storeKey, KEY, "the key the store had stays; the late one is dropped");
  assert.equal(h.saved().flow.id, replacement);
  assert.deepEqual([...h.kv.keys()].filter(name => name.startsWith("state:connect")), [`state:connect:${replacement}`]);
  assert.doesNotMatch(JSON.stringify(h.calls.filter(call => call.url === "https://dinkuskit.com/api/store-passes")), new RegExp(late), "the late key is never used");
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
  assert.match(page, /"status":"🟡 Needs label"/);
  assert.match(page, /"label":"#1002 \(TEST\)","action_id":"open","value":"order:def"\},"to":"Demo Shopper · Testville, CA","status":"🔵 Label bought"/);
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
  assert.match(text(refused), /Ship is off for this store at DinkusKit.com\. An Administrator presses Connect again on this page to turn it on\./);
  const adminRefused = await host({ role: 50, passes: () => Response.json({ error: "service_not_enabled" }, { status: 403 }) }).page(load);
  assert.match(text(adminRefused), /"label":"Connect again","action_id":"connect"/, "a store connected before Ship turned on at Connect presses Connect again");
  const wrongStore = await host({ passes: () => Response.json({ access_token: pass({ site_id: "other" }) }) }).page(load);
  assert.match(text(wrongStore), /pass Ship cannot use/);
  const wrongScope = await host({ passes: () => Response.json({ access_token: pass({ scope: "ship:orders" }) }) }).page(load);
  assert.match(text(wrongScope), /pass Ship cannot use/);
  const down = await host({ passes: () => { throw new Error("offline"); } }).page(load);
  assert.match(text(down), /DinkusKit.com could not be reached/);
});

test("each item shows the options the shopper chose in its own Options column, so two sizes never look alike (commerce#264)", async () => {
  const lines = [{ name: "Wrong Turn Tee", options: "Size: M", quantity: 1, weightOz: 6.5 }, { name: "Wrong Turn Tee", options: "Size: L", quantity: 1, weightOz: 6.5 },
    { name: "Demo Mug", options: null, quantity: 1, weightOz: 12 }, { name: "Older Ship Mug", quantity: 1, weightOz: 12 }];
  const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order({ lines, itemsWeightOz: 37 }), settings } } });
  const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const items = opened.blocks.find(block => block.type === "table" && block.page_action_id === "items");
  assert.deepEqual(items.columns.map(column => column.label), ["Item", "Options", "Qty", "Weight each", "Weight"]);
  assert.deepEqual(items.rows.map(row => [row.item, row.options]), [["Wrong Turn Tee", "Size: M"], ["Wrong Turn Tee", "Size: L"], ["Demo Mug", ""], ["Older Ship Mug", ""]]);
});

test("an order with no options has no empty Options column", async () => {
  const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order({ lines: [{ name: "Demo Mug", options: null, quantity: 1, weightOz: 12 }], itemsWeightOz: 12 }), settings } } });
  const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const items = opened.blocks.find(block => block.type === "table" && block.page_action_id === "items");
  assert.deepEqual(items.columns.map(column => column.label), ["Item", "Qty", "Weight each", "Weight"]);
});

const ITEMS_SHOWN = 50;
test("an order at Ship's 500-line limit still renders, with Print and Cancel, and says where the rest of the items are", async () => {
  const lines = Array.from({ length: 500 }, (_, index) => ({ name: `Item ${index} `.padEnd(200, "x"), options: "Size: M · ".padEnd(200, "y"), quantity: 1, weightOz: 1 }));
  const current = order({ lines, itemsWeightOz: 500, label: label(), labels: [label(), ...Array.from({ length: 30 }, (_, index) => label({ labelId: `old_${index}`, status: "cancelled", cancelledAt: "2026-10-19T22:30:00.000Z" }))] });
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: current, settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  // h.page throws unless validateBlockResponse accepts the whole page.
  const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const items = opened.blocks.find(block => block.type === "table" && block.page_action_id === "items");
  assert.equal(items.rows.length, ITEMS_SHOWN);
  assert.match(text(opened), new RegExp(`Plus ${500 - ITEMS_SHOWN} more items\\. Open in Ship lists every item\\.`));
  const actions = text(opened);
  assert.match(actions, /"label":"Print label"/);
  assert.match(actions, /"label":"Cancel label"/);
  const history = opened.blocks.find(block => block.type === "table" && block.page_action_id === "labels");
  assert.equal(history.rows.length, 31);
  assert.doesNotMatch(actions, /more labels/);  // Hosted Ship sends labels oldest first; the table keeps the 50 newest, newest at the top.
  const relabeled = order({ labels: Array.from({ length: 60 }, (_, index) => label({ labelId: `old_${index}`, tracking: `9400${String(index).padStart(18, "0")}`,
    createdAt: new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString(), status: "cancelled", cancelledAt: "2026-10-19T22:30:00.000Z" })) });
  const many = await host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: relabeled, settings } } }).page({ type: "block_action", action_id: "open", value: "order:abc" });
  const shown = many.blocks.find(block => block.type === "table" && block.page_action_id === "labels").rows;
  assert.equal(shown.length, ITEMS_SHOWN);
  const grouped = index => `9400${String(index).padStart(18, "0")} (test, not trackable)`;
  assert.deepEqual([shown[0].tracking, shown.at(-1).tracking], [grouped(59), grouped(10)]);
  assert.equal(relabeled.labels[0].labelId, "old_0", "the order's own label list is left as Ship sent it");
  assert.match(text(many), /Plus 10 more labels\. Open in Ship lists every label\./);
});

test("missing item weights are incomplete, not zero; the warning keeps the label form through validation", async () => {
  for (const [lines, known] of [
    [[{ name: "Demo Tee", quantity: 2, weightOz: null }], 0],
    [[{ name: "Demo Mug", quantity: 2, weightOz: 12.5 }, { name: "Demo Tee", quantity: 1, weightOz: null }], 25],
  ]) {
    const current = order({ lines, itemsWeightOz: known });
    const before = structuredClone(current);
    const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: current, settings } } });
    const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
    const warning = opened.blocks.find(block => block.type === "banner" && block.title === "Item weights missing");
    assert.ok(warning);
    assert.match(text(warning), /Weigh the whole package and update Package weight/);
    assert.match(text(opened), known ? /Items weigh 1 lb 9 oz/ : /No item weights in Commerce/);
    assert.match(text(opened), /"each":"Not set","total":"Not set"/);
    const form = opened.blocks.find(block => block.type === "form");
    assert.equal(form.fields.find(field => field.action_id === "weightOz").initial_value, String(known + box.weightOz));
    assert.equal(form.submit.label, "See prices");
    assert.ok(opened.blocks.indexOf(warning) < opened.blocks.indexOf(form));
    const refused = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: "weigh me", kind: "sandbox" } });
    assert.match(text(refused), /Item weights missing/);
    assert.match(text(refused), /Enter the package weight in ounces/);
    assert.ok(refused.blocks.some(block => block.type === "form"));
    assert.deepEqual(current, before, "the view never fills missing item weights or changes the order");
    assert.ok(h.calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com")).every(call => call.method === "GET"), "opening and local validation send no price or label request");
  }
});

test("known item weights keep the old total; labelled and completed orders need no new weighing prompt", async () => {
  for (const current of [order(), order({ label: label(), lines: [{ name: "Demo Tee", quantity: 1, weightOz: null }], itemsWeightOz: 0 }),
    order({ status: "completed", lines: [{ name: "Demo Tee", quantity: 1, weightOz: null }], itemsWeightOz: 0 })]) {
    const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: current, settings } } });
    const opened = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
    assert.doesNotMatch(text(opened), /Item weights missing|Weigh the whole package/);
    if (current.itemsWeightOz === 25) {
      assert.match(text(opened), /Items weigh 1 lb 9 oz/);
      assert.doesNotMatch(text(opened), /Not set|no weight/);
    }
  }
});

const controls = page => page.blocks.flatMap(block => block.type === "actions" ? block.elements : []);
const button = (page, name) => controls(page).find(element => element.type === "button" && element.label === name);
const formOn = page => page.blocks.find(block => block.type === "form");
const servicePicker = page => formOn(page).fields.find(field => field.action_id === "service");
const press = (h, element, value = element.value) => h.page({ type: "block_action", action_id: element.action_id, value });
const pick = (h, page, service, next = "review") => h.page({ type: "form_submit", action_id: formOn(page).submit.action_id, values: { service, next } });

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
  assert.equal(button(priced, "Create TEST label"), undefined);
  const service = servicePicker(priced);
  assert.deepEqual(service.options.map(option => option.label), ["USPS Ground Advantage · $5.10", "USPS Priority Mail · $9.35"]);
  assert.equal(service.type, "radio");
  assert.equal(service.initial_value, "GA");

  const selected = await pick(h, priced, "PM");
  const buy = button(selected, "Create TEST label");
  assert.equal(buy.action_id, "buy:1:order%3Aabc");
  assert.equal(buy.value.weightOz, 30);
  assert.match(text(selected), /USPS Priority Mail · \$9\.35/);
  const bought = await press(h, buy);
  assert.deepEqual(sent[1], { version: 1, boxId: "box_small", weightOz: 30, service: "PM", by: "staff@example.test" });
  assert.equal(bought.toast.message, "Label bought, $9.35 sandbox. Tracking SANDBOX-TRACKING-A.");
  // The page after buying is read from Ship again; the stand-in still has no label, so the form shows again.
  assert.ok(bought.blocks.some(block => block.type === "form"));
});

test("Shipments falls back to a quoted service when Ground Advantage is unavailable", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/prices": { prices: { GA: null, PM: 0 } },
  } });
  const priced = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: {
    boxId: "box_small", weightOz: "30", kind: "sandbox", service: "GA",
  } });
  const service = servicePicker(priced);
  assert.equal(button(priced, "Create TEST label"), undefined);
  assert.equal(service.initial_value, "PM");
  assert.deepEqual(service.options, [{ value: "PM", label: "USPS Priority Mail · $0.00" }]);
});

test("See prices again keeps the reviewed draft and selected service if still available", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/prices": body => Response.json({ prices: { GA: 510, PM: body.weightOz === 32 ? null : 935 } }),
  } });
  const priced = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: "30", kind: "sandbox" } });
  const edit = formOn(await pick(h, priced, "PM", "prices"));
  assert.deepEqual(Object.fromEntries(edit.fields.map(field => [field.action_id, field.initial_value])), { boxId: "box_small", weightOz: "30", kind: "sandbox" });
  for (const [weightOz, service] of [["31", "PM"], ["32", "GA"]]) {
    const next = await h.page({ type: "form_submit", action_id: edit.submit.action_id, values: { boxId: "box_small", weightOz, kind: "sandbox" } });
    assert.equal(servicePicker(next).initial_value, service);
  }
  assert.equal(h.calls.filter(call => call.url.endsWith("/labels")).length, 0);
});

test("reviewing a quote after the order changes returns to pricing without buying", async () => {
  let version = 1;
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": () => Response.json({ order: { ...order(), version }, settings }),
    "POST /v1/admin/orders/order%3Aabc/prices": { prices: { PM: 935 } },
  } });
  const quoted = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { boxId: "box_small", weightOz: "30" } });
  version = 2;
  const stale = await pick(h, quoted, "PM");
  assert.match(text(stale), /The order or package changed/);
  assert.equal(formOn(stale).submit.action_id, "prices:2:order%3Aabc:PM");
  assert.equal(button(stale, "Create TEST label"), undefined);
  assert.equal(h.calls.filter(call => call.url.endsWith("/labels")).length, 0);
});

test("a quoted TEST order keeps independent sandbox and practice service choices", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/prices": { prices: { GA: null, PM: 950, EM: null } },
    "POST /v1/admin/orders/order%3Aabc/labels": () => Response.json({ error: { code: "FIXTURE", message: "No label was made." } }, { status: 422 }),
  } });
  const draft = { boxId: "box_small", weightOz: "30" };
  const priced = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { ...draft, kind: "sandbox" } });
  assert.deepEqual(servicePicker(priced).options.map(option => option.value), ["PM"]);
  const practice = await pick(h, priced, "PM", "practice");
  assert.equal(button(practice, "Create TEST label"), undefined);
  assert.deepEqual(servicePicker(practice).options.map(option => option.value), ["GA", "PM", "EM"]);
  const selected = await pick(h, practice, "EM");
  const back = await press(h, button(selected, "Back to sandbox pricing"));
  const edit = back.blocks.find(block => block.type === "form");
  assert.equal(edit.submit.action_id, "prices:1:order%3Aabc:PM");
  await press(h, button(selected, "Make practice label"));
  await press(h, button(await pick(h, priced, "PM"), "Create TEST label"));
  assert.deepEqual(h.calls.filter(call => call.url.endsWith("/labels")).map(({ body }) => [body.kind, body.service]),
    [["practice", "EM"], [undefined, "PM"]]);
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 1);
});

test("no USPS rates keeps the package editable without offering to buy, then a retry can find a rate", async () => {
  const tall = { ...box, boxId: "box_tall", name: "Tall", heightIn: 8 };
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings: { ...settings, boxes: [box, tall] } },
    "POST /v1/admin/orders/order%3Aabc/prices": body => Response.json({
      prices: { GA: null, PM: null, EM: body.weightOz === 31 ? 1200 : null },
    }),
  } });
  const values = { boxId: "box_tall", weightOz: "30", kind: "sandbox" };
  const unavailable = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values });
  const form = unavailable.blocks.find(block => block.type === "form");
  assert.match(text(unavailable), /No USPS rates are available for this package/);
  assert.doesNotMatch(text(unavailable), /Buy label|"action_id":"buy:/);
  assert.equal(form.submit.label, "See prices");
  assert.deepEqual(Object.fromEntries(form.fields.map(field => [field.action_id, field.initial_value])), values);

  const retry = await h.page({ type: "form_submit", action_id: form.submit.action_id, values: { ...values, weightOz: "31" } });
  assert.doesNotMatch(text(retry), /No USPS rates are available/);
  assert.equal(button(retry, "Create TEST label"), undefined);
  assert.equal(servicePicker(retry).initial_value, "EM");
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 2);
  assert.equal(h.calls.filter(call => call.url.endsWith("/labels")).length, 0);
});

test("from an unquoted practice label the sandbox opens the price step, not a buy form", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
    "POST /v1/admin/orders/order%3Aabc/prices": { prices: { GA: null, PM: null, EM: null } },
  } });
  const draft = { boxId: "box_small", weightOz: "30" };
  const unquoted = await h.page({ type: "form_submit", action_id: "prices:1:order%3Aabc", values: { ...draft, kind: "sandbox" } });
  const practice = await h.page({ type: "form_submit", action_id: unquoted.blocks.find(block => block.type === "form").submit.action_id,
    values: { ...draft, kind: "practice" } });
  assert.equal(formOn(practice).submit.label, "Review practice label");
  assert.equal(button(practice, "Create TEST label"), undefined);
  assert.equal(servicePicker(practice).options.length, 3);
  const sandbox = await press(h, button(practice, "Back to sandbox pricing"));
  const prices = sandbox.blocks.find(block => block.type === "form");
  assert.equal(prices.submit.label, "See prices");
  assert.deepEqual(Object.fromEntries(prices.fields.map(field => [field.action_id, field.initial_value])), { ...draft, kind: "sandbox" });
  assert.ok(!prices.fields.some(field => field.action_id === "service"));
  assert.equal(h.calls.filter(call => call.url.endsWith("/prices")).length, 1);
  assert.equal(h.calls.filter(call => call.url.endsWith("/labels")).length, 0);
});

test("a labelled order shows the label with a five-minute print link and a guarded Cancel", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ label: label(), labels: [label()] }), settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
    "POST /v1/admin/labels/label_1/cancel": { labelId: "label_1", refund: "INITIATED" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const actions = page.blocks.flatMap(block => block.type === "actions" ? block.elements : block.type === "section" && block.accessory ? [block.accessory] : []);
  const print = actions.find(element => element.label === "Print label");
  assert.equal(page.blocks.find(block => block.accessory === print)?.type, "section", "Print label sits beside the Label bought line");
  assert.deepEqual(print.target, { kind: "external", url: "https://ship.dinkuskit.com/print/tok.sig" });
  const cancel = actions.find(element => element.label === "Cancel label");
  assert.equal(cancel.action_id, "cancel:order%3Aabc");
  assert.equal(cancel.value, "label_1");
  assert.equal(cancel.confirm.style, "danger");
  assert.match(text(page), /"text":"2 items · Label bought"/);
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
  assert.match(sandboxRow, /"tracking":"SANDBOX-TRACKING-A \(test, not trackable\)","status":"🔴 Cancelled"\}/);
  assert.doesNotMatch(sandboxRow, /SANDBOX-TRACKING-A \(test, not trackable\)","status":"🔴 Cancelled, refund/);

  const after = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: null, labels: [sandboxCancelled, liveCancelled] }), settings } } });
  const page = text(await after.page({ type: "block_action", action_id: "open", value: "order:abc" }));
  assert.match(page, /"tracking":"9400 1000 0000 0000 0000 02","status":"🔴 Cancelled, refund initiated"/);
  assert.match(page, /"tracking":"SANDBOX-TRACKING-A \(test, not trackable\)","status":"🔴 Cancelled"\}/);
});

test("the live label's tracking number links to USPS, and every label's number shows in the Labels table", async () => {
  const live = label({ labelId: "label_2", test: false, tracking: "9400100000000000000002" });
  const old = label({ labelId: "label_1", test: false, tracking: "9400100000000000000001", status: "cancelled", cancelledAt: "2026-10-19T22:30:00.000Z", refund: "INITIATED" });
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ test: false, label: live, labels: [old, live] }), settings },
    "POST /v1/admin/labels/label_2/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const links = text(page).match(/https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=[0-9]+/g);
  assert.deepEqual(links, ["https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000002"]);
  assert.match(text(page), /"tracking":"9400 1000 0000 0000 0000 01","status":"🔴 Cancelled, refund initiated"/);
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

test("an invalid replacement label weight returns to prices without carrying purchase approval", async () => {
  for (const isTest of [true, false]) {
    const sent = [];
    const h = host({ ship: {
      "GET /v1/admin/orders/order%3Aabc": { order: order({ test: isTest }), settings },
      "POST /v1/admin/orders/order%3Aabc/labels": body => {
        sent.push({ route: "labels", body });
        return Response.json({ error: { code: "CHECK_PITNEY_BOWES", message: "Pitney Bowes has no record of the last label." } }, { status: 409 });
      },
      "POST /v1/admin/orders/order%3Aabc/prices": body => {
        sent.push({ route: "prices", body });
        return Response.json({ prices: { GA: 420, PM: 950, EM: null } });
      },
    } });
    const replacement = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: {
      boxId: "box_small", weightOz: 31, service: "PM",
    } });
    assert.equal(replacement.blocks.find(block => block.type === "form").fields.find(field => field.action_id === "buyAgain").initial_value, false);
    const refused = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: {
      boxId: "box_small", weightOz: "31x", service: "PM", buyAgain: true,
    } });
    const retry = refused.blocks.find(block => block.type === "form");
    assert.equal(retry.submit.label, "See prices");
    assert.equal(retry.fields.find(field => field.action_id === "weightOz").initial_value, "31x");
    assert.equal(retry.fields.some(field => field.action_id === "buyAgain"), false);
    assert.deepEqual(sent.map(call => call.route), ["labels"]);

    const quoted = await h.page({ type: "form_submit", action_id: retry.submit.action_id, values: { boxId: "box_small", weightOz: "32" } });
    assert.deepEqual(sent.map(call => call.route), ["labels", "prices"]);
    assert.equal(sent[1].body.weightOz, 32);
    assert.equal(sent[1].body.buyAgain, undefined);
    assert.ok(button(await pick(h, quoted, "PM"), isTest ? "Create TEST label" : "Buy label"));
    assert.match(text(quoted), /USPS Priority Mail · \$9\.50/);
    assert.doesNotMatch(text(quoted), /buyAgain/);
  }
});

test("a locally rejected weight keeps the label draft without advancing or requesting a label", async () => {
  const tall = { ...box, boxId: "box_tall", name: "Tall", heightIn: 8 };
  const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order(), settings: { ...settings, boxes: [box, tall] } } } });
  for (const step of ["prices", "buy"]) {
    const view = await h.page({ type: "form_submit", action_id: `${step}:1:order%3Aabc`, values: {
      boxId: "box_tall", weightOz: "29x", kind: "practice", ...(step === "buy" ? { service: "PM" } : {}),
    } });
    const index = view.blocks.findIndex(block => block.type === "form");
    const form = view.blocks[index];
    assert.equal(view.blocks[index - 1].title, "Check label details");
    assert.match(text(view), /Enter the package weight in ounces/);
    assert.equal(form.submit.label, "See prices");
    assert.equal(form.fields.find(field => field.action_id === "boxId").initial_value, "box_tall");
    assert.equal(form.fields.find(field => field.action_id === "weightOz").initial_value, "29x");
    assert.equal(form.fields.find(field => field.action_id === "kind").initial_value, "practice");
    assert.ok(!form.fields.some(field => field.action_id === "service"));
  }
  assert.ok(h.calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com")).every(call => call.method === "GET"));
});

test("invalid pasted weights do not turn into a calculated weight or reuse a sandbox quote", async () => {
  const h = host({ ship: { "GET /v1/admin/orders/order%3Aabc": { order: order(), settings } } });
  const pasted = "weight copied from the packing slip: 29 ounces";
  for (const [kind, raw, displayed, next] of [
    ["practice", pasted, pasted, "See prices"],
    ["practice", pasted.repeat(5), "", "See prices"],
    ["sandbox", pasted, pasted, "See prices"],
  ]) {
    const view = await h.page({ type: "form_submit", action_id: "buy:1:order%3Aabc", values: {
      boxId: "box_small", weightOz: raw, kind, service: "PM",
    } });
    const form = view.blocks.find(block => block.type === "form");
    assert.equal(form.fields.find(field => field.action_id === "weightOz").initial_value, displayed);
    assert.equal(form.fields.find(field => field.action_id === "kind").initial_value, kind);
    assert.equal(form.submit.label, next);
  }
  assert.ok(h.calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com")).every(call => call.method === "GET"));
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
  const buy = button(await pick(h, chosen, "GA"), "Make practice label");
  assert.equal(buy.action_id, "buy:1:order%3Aabc");
  assert.equal(buy.value.kind, "practice");
  assert.deepEqual(servicePicker(chosen).options.map(option => option.label), ["USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express"]);
  assert.match(text(chosen), /A practice label is free and asks Pitney Bowes nothing/);
  const made = await press(h, buy);
  assert.deepEqual(sent[0], { version: 1, boxId: "box_small", weightOz: 30, service: "GA", kind: "practice", by: "staff@example.test" });
  assert.equal(made.toast.message, "Practice label made.");
});

test("a Completed order keeps its label's Print and Cancel, and gets no form", async () => {
  const h = host({ ship: {
    "GET /v1/admin/orders/order%3Aabc": { order: order({ version: 2, status: "completed", label: label(), labels: [label()] }), settings },
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/tok.sig", expiresAt: "2026-10-19T22:05:00.000Z" },
  } });
  const page = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  const actions = page.blocks.flatMap(block => block.type === "actions" ? block.elements : block.type === "section" && block.accessory ? [block.accessory] : []);
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
  assert.match(list, /Add them in Shipping settings/);
  assert.match(list, /"label":"Shipping settings","target":\{"kind":"plugin-page","path":"\/shipping-settings"\}/);
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
    assert.match(page, /"label":"#1001 \(TEST\)","action_id":"open"/);
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
  assert.match(list, /"🟢 Delivered"/);
  assert.match(list, /"🔴 Delivery problem"/);
  assert.doesNotMatch(list, /Delivery attempted/, "the list keeps the one word; the order page has the reason");
  assert.match(list, /"🔵 Label bought"/);
  const page = text(await h.page({ type: "block_action", action_id: "open", value: "order:abc", page: "/shipping" }));
  assert.match(page, /"text":"Delivered · Oct 22, 2026, 6:02 PM UTC"/);
  assert.match(page, /"text":"2 items · Delivered"/);
});

test("a store with more orders than EmDash can draw at once gets them 50 at a time, newest first", async () => {
  // Hosted Ship sends up to 200 orders; EmDash refuses a page of more than 2,000 parts (about 175 rows).
  const orders = Array.from({ length: 200 }, (_, i) => row({ orderId: `order:${i}`, number: 2000 + i }));
  const h = host({ ship: { "GET /v1/admin/orders": { orders, settings } } });
  const table = response => response.blocks.find(block => block.type === "table");
  const first = await h.page(load);
  assert.equal(table(first).rows.length, 50);
  assert.equal(table(first).next_cursor, "50");
  assert.match(text(first), /Orders 1 to 50 of 200, newest first/);
  const second = await h.page({ type: "block_action", action_id: "list", value: { cursor: "50", sort: null } });
  assert.equal(table(second).rows.length, 50);
  assert.notEqual(table(second).rows[0].order, table(first).rows[0].order);
  assert.match(text(second), /Orders 51 to 100 of 200/);
  const last = await h.page({ type: "block_action", action_id: "list", value: { cursor: "150" } });
  assert.equal(table(last).rows.length, 50);
  assert.equal(table(last).next_cursor, undefined, "the last page offers no Load more");
  // Refresh, a sort, or a cursor past the end or not a number goes back to the newest orders.
  for (const value of [undefined, { sort: { key: "order", dir: "asc" } }, { cursor: "900" }, { cursor: "-5" }, { cursor: "1e3" }]) {
    assert.match(text(await h.page({ type: "block_action", action_id: "list", value })), /Orders 1 to 50 of 200/, JSON.stringify(value));
  }
  // A store with 50 or fewer orders sees them all, with no page line.
  const few = host({ ship: { "GET /v1/admin/orders": { orders: orders.slice(0, 50), settings } } });
  const all = await few.page(load);
  assert.equal(table(all).rows.length, 50);
  assert.equal(table(all).next_cursor, undefined);
  assert.doesNotMatch(text(all), /Orders 1 to/);
});

// Step (b) of DinkusKit.com's store-connect-order-135.
const ISSUED = "dk_store_" + "f".repeat(43);

test("a store DinkusKit.com already knows shows Finish setup, and one press connects Ship with no second Approve", async () => {
  const editor = host({ siteId: null, key: null, joinable: true });
  const asked = text(await editor.page(load));
  assert.match(asked, /Almost ready: this store is already connected to DinkusKit/);
  assert.match(asked, /Ask an Administrator of this site to press Finish setup/);
  assert.equal(text(await editor.page({ type: "block_action", action_id: "finish_setup" })).includes("finish_setup"), false, "an Editor's press starts nothing");
  assert.equal(editor.calls.length, 0);

  let receipt;
  const h = host({ siteId: null, key: null, role: 50, joinable: true, dinkus: {
    "/api/store-connections": started(),
    "/api/store-connections/finish": async body => {
      // DinkusKit.com reads the receipt on the store's own address before it approves.
      receipt = await proofOf(h, { connection_id: CONNECTION });
      assert.deepEqual(Object.keys(body).sort(), ["client_id", "code_verifier", "connection_id"]);
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), receipt.body.code_challenge);
      return Response.json({ site_id: SITE, store_key: ISSUED });
    },
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  const page = text(await h.page(load));
  assert.match(page, /"label":"Finish setup","action_id":"finish_setup"/);
  assert.doesNotMatch(page, /"action_id":"connect"/, "one button, not Connect beside it");
  assert.deepEqual(h.lookups, [{ protocol_version: 2, client_id: "dinkus-ship-emdash", service: "ship", site_origin: "https://shop.example.test",
    callback_uri: "https://shop.example.test/_emdash/admin/plugins/r_ehdlg5cxkb3ffqvr/shipping" }]);
  assert.match(text(await h.page({ type: "block_action", action_id: "finish_setup" })), /#1001/, "straight to the orders");
  assert.equal(receipt.status, 200);
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: ISSUED });
  assert.deepEqual([...h.kv.keys()].filter(name => name.startsWith("state:connect:")), [], "nothing is left waiting");
  assert.equal(h.calls.some(call => call.url.endsWith("/token")), false, "no wait for an Approve");
});

test("Finish setup falls back to the owner's Approve, or to starting over, when DinkusKit.com says so", async () => {
  const owner = host({ siteId: null, key: null, role: 50, joinable: true, dinkus: {
    "/api/store-connections": started(), "/api/store-connections/finish": () => Response.json({ error: "owner_approval_required" }, { status: 409 }),
    "/api/store-connections/token": { store_key: ISSUED, site_id: SITE },
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  const waiting = text(await owner.page({ type: "block_action", action_id: "finish_setup" }));
  assert.match(waiting, /Approve at DinkusKit.com/);
  assert.match(text(await owner.page(load)), /Approve at DinkusKit.com/, "explicit approval survives a reload");
  assert.match(text(await owner.page({ type: "block_action", action_id: "check" })), /#1001/, "after the owner's Approve, Check finishes as usual");
  assert.deepEqual(owner.saved(), { siteId: SITE, storeKey: ISSUED });

  const refused = host({ siteId: null, key: null, role: 50, joinable: true, dinkus: {
    "/api/store-connections": started(), "/api/store-connections/finish": () => Response.json({ error: "grant_revoked" }, { status: 409 }),
  } });
  assert.match(text(await refused.page({ type: "block_action", action_id: "finish_setup" })), /Connect did not finish/);
  assert.deepEqual(refused.saved(), {}, "nothing is saved on a refusal");
  assert.equal((await proofOf(refused, { connection_id: CONNECTION })).status, 404, "and the proof route vouches for nothing");
});

test("a lost Finish setup reply stays unconfirmed; a spent attempt offers fresh setup without a reload", async () => {
  const finish = { type: "block_action", action_id: "finish_setup" };
  const check = { type: "block_action", action_id: "check" };
  let attempts = 0;
  const ids = [];
  const h = host({ siteId: null, key: null, role: 50, joinable: true, dinkus: {
    "/api/store-connections": () => {
      const id = `conn_${++attempts}`;
      return Response.json(started({ connection_id: id, verification_uri: `https://dinkuskit.com/account/connect?connection_id=${id}` }));
    },
    "/api/store-connections/finish": ({ connection_id }) => {
      ids.push(connection_id);
      if (attempts === 1) throw new TypeError("reply lost");
      return Response.json({ store_key: ISSUED, site_id: SITE });
    },
    "/api/store-connections/token": () => Response.json({ error: "already_redeemed" }, { status: 400 }),
  }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  for (const response of [await h.page(finish), await h.page(load)]) {
    assert.match(text(response), /Ship setup not confirmed/);
    assert.doesNotMatch(text(response), /Approve at DinkusKit.com|account\/connect/);
  }
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 200, "the unconfirmed attempt can still be checked");
  const retry = text(await h.page(check));
  assert.match(retry, /Try Ship setup again/);
  assert.match(retry, /"label":"Finish setup","action_id":"finish_setup"/);
  assert.doesNotMatch(retry, /"action_id":"connect"/);
  assert.equal(h.lookups.length, 1, "eligibility is rechecked at recovery");
  assert.equal(attempts, 1, "Check does not start another attempt");
  assert.equal((await proofOf(h, { connection_id: CONNECTION })).status, 404, "retired proof is gone");
  assert.match(text(await h.page(finish)), /#1001/);
  assert.deepEqual(ids, [CONNECTION, "conn_2"], "retry uses a new connection; the old response is never replayed");
  assert.deepEqual(h.saved(), { siteId: SITE, storeKey: ISSUED });
});

test("unconfirmed Finish setup can be checked or cancelled without guessing about approval", async () => {
  for (const joinable of [false, true]) {
    for (const end of ["cancel_connect", "check"]) {
      let eligible = true, redeemed = false;
      const h = host({ siteId: null, key: null, role: 50, joinable: () => eligible, dinkus: {
        "/api/store-connections": started(),
        "/api/store-connections/finish": () => Response.json({ error: "unavailable" }, { status: 503 }),
        "/api/store-connections/token": () => Response.json({ error: redeemed ? "already_redeemed" : "authorization_pending" }, { status: 400 }),
      } });
      assert.match(text(await h.page({ type: "block_action", action_id: "finish_setup" })), /Ship setup not confirmed/);
      const pending = text(await h.page({ type: "block_action", action_id: "check" }));
      assert.match(pending, /still waiting for confirmation/);
      assert.doesNotMatch(pending, /Approve at DinkusKit.com|Not approved yet/);
      eligible = joinable;
      redeemed = true;
      const recovered = text(await h.page({ type: "block_action", action_id: end }));
      assert.match(recovered, joinable ? /"action_id":"finish_setup"/ : /"action_id":"connect"/);
      assert.doesNotMatch(recovered, /Approve at DinkusKit.com/);
      assert.deepEqual(h.saved(), {});
    }
  }
});

test("the orders list says which business the store is connected to, read with this plugin's own pass", async () => {
  const quiet = host({ ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  assert.doesNotMatch(text(await quiet.page(load)), /Connected to/, "no answer, no line");
  const h = host({ connection: { business: "Acme Goods", site_origin: "https://shop.example.test", plugins: ["commerce", "payments", "ship"] },
    ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  assert.match(text(await h.page(load)), /Connected to Acme Goods on DinkusKit\. DinkusKit plugins on this store: Commerce, Payments and Ship\./);
  assert.deepEqual(h.shared, [
    { url: "https://dinkuskit.com/api/store-passes", authorization: `Bearer ${KEY}`, body: { site_id: SITE, scope: "store:connection", audience: "dinkuskit" } },
    { url: "https://dinkuskit.com/api/store-connection", authorization: "Bearer connection-pass" },
  ]);
  const odd = host({ connection: { business: "Acme Goods", plugins: ["commerce", "elsewhere"] }, ship: { "GET /v1/admin/orders": { orders: [row()], settings } } });
  assert.doesNotMatch(text(await odd.page(load)), /Connected to/, "an unknown plugin name hides the line");
});

test("uninstalling Ship cancels only its own key at DinkusKit.com", async () => {
  const never = host({ siteId: null, key: null });
  await plugin.hooks["plugin:uninstall"]({ deleteData: false }, never.ctx);
  assert.deepEqual(never.calls, []);
  const h = host();
  await plugin.hooks["plugin:uninstall"]({ deleteData: true }, h.ctx);
  assert.deepEqual(h.calls, [{ url: "https://dinkuskit.com/api/store-keys/cancel", method: "POST", authorization: `Bearer ${KEY}`, body: { site_id: SITE } }]);
});

test("Label history lists every label the store bought, newest first, 50 a page, and its order number opens the order", async () => {
  const labels = Array.from({ length: 50 }, (_, index) => ({ ...label({ labelId: `label_${index}`, tracking: `9400${String(index).padStart(18, "0")}`, test: false, priceCents: 512 }), number: 1001 + index }));
  const older = [{ ...label({ labelId: "label_old", status: "cancelled", cancelledAt: "2026-10-20T00:00:00.000Z", practice: true, priceCents: null }), number: null }];
  const asked = [];
  const h = host({ ship: {
    "GET /v1/admin/orders": { orders: [row()], settings },
    "GET /v1/admin/labels": () => Response.json(asked.at(-1) === "" ? { labels, next: "2026-10-19T22:00:00.000Z~label_49" } : { labels: older, next: null }),
    "GET /v1/admin/orders/order%3Aabc": { order: order(), settings },
  } });
  h.ctx.http.fetch = (inner => async (url, init) => { if (url.includes("/v1/admin/labels")) asked.push(new URL(url).search); return inner(url, init); })(h.ctx.http.fetch);
  assert.match(text(await h.page(load)), /"label":"Label history","action_id":"history"/);
  const first = await h.page({ type: "block_action", action_id: "history" });
  const table = first.blocks.find(block => block.type === "table");
  assert.equal(table.rows.length, 50);
  assert.equal(table.next_cursor, "2026-10-19T22:00:00.000Z~label_49");
  const firstOrder = table.rows[0].order;
  assert.deepEqual(firstOrder, { type: "button", label: "#1001", action_id: "history-order::open", value: "order:abc" });
  assert.match(table.rows[0].service, /USPS Priority Mail, \$5\.12/);
  assert.equal(table.rows[0].tracking, "9400 0000 0000 0000 0000 00");
  assert.doesNotMatch(text(first), /Older labels/);
  const next = await h.page({ type: "block_action", action_id: "history", value: { cursor: table.next_cursor } });
  assert.deepEqual(asked, ["", "?before=2026-10-19T22%3A00%3A00.000Z~label_49"]);
  const row0 = next.blocks.find(block => block.type === "table").rows[0];
  assert.equal(row0.order.label, "order:abc (TEST)");
  assert.match(row0.status, /Cancelled/);
  assert.match(text(next), /Older labels. Refresh goes back to the newest./);
  const use = control => h.page({ type: "block_action", action_id: control.action_id, value: control.value });
  const back = response => response.blocks[1].elements[0];
  const orderFromHistory = await use(row0.order);
  assert.match(text(orderFromHistory), /Order #1001/);
  assert.deepEqual(back(orderFromHistory), { type: "button", label: "Back to Label history", action_id: "history", value: { cursor: table.next_cursor } });
  assert.deepEqual(await use(back(orderFromHistory)), next);
  assert.equal(asked.at(-1), asked[1], "the back action reuses the same hosted cursor");
  assert.deepEqual(await use(back(await use(firstOrder))), first, "the newest page also has a way back");
  const ordinary = await h.page({ type: "block_action", action_id: "open", value: "order:abc" });
  assert.equal(back(ordinary).label, "Back to Shipments");
});

test("the label history return survives cancellation and a replacement label quote", async () => {
  const bought = label();
  const cancelled = label({ status: "cancelled", cancelledAt: "2026-10-20T00:00:00.000Z" });
  let active = true;
  const cursor = "2026-10-21T00:00:00.000Z~another_label";
  const h = host({ ship: {
    "GET /v1/admin/labels": () => Response.json({ labels: [{ ...(active ? bought : cancelled), number: 1001 }], next: null }),
    "GET /v1/admin/orders/order%3Aabc": () => Response.json({ order: order({ label: active ? bought : null, labels: [active ? bought : cancelled] }), settings }),
    "POST /v1/admin/labels/label_1/print-link": { url: "https://ship.dinkuskit.com/print/test-fixture", expiresAt: "2026-10-20T00:05:00.000Z" },
    "POST /v1/admin/labels/label_1/cancel": () => { active = false; return Response.json({ labelId: "label_1", refund: null }); },
    "POST /v1/admin/orders/order%3Aabc/prices": { prices: { GA: 510, PM: 935, EM: null } },
  } });
  const use = control => h.page({ type: "block_action", action_id: control.action_id, value: control.value });
  const fromHistory = await use({ action_id: "history", value: { cursor } });
  const details = await use(fromHistory.blocks.find(block => block.type === "table").rows[0].order);
  const returnAction = response => response.blocks[1].elements[0];
  const cancel = details.blocks.flatMap(block => block.type === "actions" ? block.elements : []).find(element => element.label === "Cancel label");
  const afterCancel = await use(cancel);
  assert.equal(afterCancel.toast.message, "Label cancelled.");
  assert.deepEqual(returnAction(afterCancel), returnAction(details));
  const form = afterCancel.blocks.find(block => block.type === "form");
  const quote = values => h.page({ type: "form_submit", action_id: form.submit.action_id, values });
  const beforeRefusal = h.calls.length;
  const refused = await quote({ boxId: "box_small", weightOz: "too heavy" });
  assert.match(text(refused), /Enter the package weight/);
  assert.deepEqual(returnAction(refused), returnAction(details));
  const retry = refused.blocks.find(block => block.type === "form");
  assert.equal(retry.submit.action_id, form.submit.action_id);
  assert.equal(retry.fields.find(field => field.action_id === "weightOz").initial_value, "too heavy");
  assert.ok(h.calls.slice(beforeRefusal).every(call => !/\/(prices|label)$/.test(new URL(call.url).pathname)));
  const quoted = await h.page({ type: "form_submit", action_id: retry.submit.action_id, values: { boxId: "box_small", weightOz: 28 } });
  assert.match(text(quoted), /USPS Ground Advantage · \$5\.10/);
  assert.deepEqual(returnAction(quoted), returnAction(details));
  const back = await use(returnAction(quoted));
  assert.match(back.blocks.find(block => block.type === "table").rows[0].status, /Cancelled/);
  assert.equal(new URL(h.calls.at(-1).url).searchParams.get("before"), cursor);
});

test("until ship.dinkuskit.com lists labels, Label history points to Ship's own page", async () => {
  const h = host({ ship: { "GET /v1/admin/labels": () => Response.json({ error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 }) } });
  const page = text(await h.page({ type: "block_action", action_id: "history" }));
  assert.match(page, /Label history is on Ship's page for now/);
  assert.match(page, /https:\/\/ship.dinkuskit.com\/stores\/site_demo\/orders/);
});
