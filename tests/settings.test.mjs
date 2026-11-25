import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/plugin.mjs";
import { validateBlockResponse } from "@emdash-cms/blocks/server";

// The Shipping settings page (ship-settings-in-admin-129) against stand-ins for DinkusKit.com's
// store-passes and hosted Ship's settings routes: what an Administrator sees, what is sent, and
// what never leaves the page (the Pitney Bowes password goes to Ship once and is shown nowhere).

const SITE = "site_demo";
const KEY = "dk_store_" + "k".repeat(43);
const admin = plugin.routes.admin.handler;
const PAGE = "/shipping-settings";
const load = { type: "page_load", page: PAGE };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const pass = () => `${b64({ alg: "ES256" })}.${b64({ iss: "https://dinkuskit.com/account", aud: "dinkus-ship", sub: "biz", site_id: SITE,
  scope: "ship:admin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.${b64("sig")}`;
const SIGNUP = "https://developer.sandbox.pitneybowes.com/create/accountInfo?developerID=dev&email=owner%40example.test";

/** Hosted Ship's settings for one store, changed by the routes the plugin calls, as the service does. */
function hostedShip({ routes = true } = {}) {
  const state = { shipFrom: null, boxes: [], replyTo: null, storeName: "Demo Shop", postageConnected: true, testSandbox: true, postageAccount: null, signupUrl: SIGNUP };
  let boxes = 0;
  const page = (status = 200) => Response.json({ settings: structuredClone(state) }, { status });
  const refuse = message => Response.json({ error: { code: "INVALID_INPUT", message } }, { status: 400 });
  const handlers = {
    "GET /v1/admin/settings": () => page(),
    "POST /v1/admin/settings/ship-from": body => {
      if (!body.name || !body.line1 || !body.city || !body.region || !body.postalCode) return refuse("Ship-from needs a name, address, city, state and ZIP code.");
      state.shipFrom = { ...body, region: body.region.toUpperCase() };
      return page();
    },
    "POST /v1/admin/settings/reply-to": body => {
      if (!/^[^\s@]+@[^\s@]+$/.test(body.replyTo ?? "")) return refuse("Reply-to must be an email address.");
      state.replyTo = body.replyTo;
      return page();
    },
    "POST /v1/admin/settings/boxes": body => {
      const size = ["lengthIn", "widthIn", "heightIn"].map(name => Number(body[name]));
      if (!body.name || size.some(value => !(value > 0))) return refuse("A box needs a name and a length, width and height in inches.");
      state.boxes.push({ boxId: `box_${++boxes}`, name: body.name, lengthIn: size[0], widthIn: size[1], heightIn: size[2], weightOz: Number(body.weightOz ?? 0) });
      return page(201);
    },
    "POST /v1/admin/settings/postage": body => {
      if (body.password !== "right-password") return Response.json({ error: { code: "PITNEY_BOWES_LOGIN", message: "Pitney Bowes did not accept that username and password." } }, { status: 422 });
      state.postageAccount = { company: "Demo Co", email: "owner@example.test", accountEnding: "4321", connectedAt: "2026-11-22T19:00:00.000Z" };
      return page();
    },
    "POST /v1/admin/settings/postage/disconnect": () => { state.postageAccount = null; return page(); },
  };
  return { state, handle: (method, path, body) => {
    if (!routes) return Response.json({ error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 });
    const removal = /^\/v1\/admin\/settings\/boxes\/([^/]+)\/remove$/.exec(path);
    if (method === "POST" && removal) {
      state.boxes = state.boxes.filter(box => box.boxId !== decodeURIComponent(removal[1]));
      return page();
    }
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected call ${method} ${path}`);
    return handler(body);
  } };
}

/** A store with the plugin connected (or not), its KV, the fake network and someone at the Shipping settings page. */
function host({ role = 50, connected = true, routes = true, email = "Owner@Example.test" } = {}) {
  const calls = [], kv = new Map(), hosted = hostedShip({ routes });
  const stored = new Map(connected ? [["connection", { value: JSON.stringify({ siteId: SITE, storeKey: KEY }), revision: "1" }]] : []);
  const ctx = {
    plugin: { id: "dinkus-ship", version: "0.4.0" },
    site: { url: "https://shop.example.test", name: "Shop", locale: "en" },
    settings: {
      get: async name => stored.get(name)?.value ?? null,
      getVersioned: async name => stored.get(name) ?? null,
      compareAndSet: async () => ({ applied: true }),
      delete: async name => stored.delete(name),
    },
    kv: { get: async name => kv.get(name) ?? null, set: async (name, value) => { kv.set(name, value); }, delete: async name => kv.delete(name) },
    http: { fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method ?? "GET", authorization: init.headers?.authorization, adminUser: init.headers?.["x-ship-admin-user"], body });
      if (url === "https://dinkuskit.com/api/store-passes") return Response.json({ access_token: pass(), token_type: "Bearer", expires_in: 300 });
      if (url === "https://dinkuskit.com/api/store-connections/lookup") return Response.json({ finish_setup: false });
      const parsed = new URL(url);
      if (parsed.origin !== "https://ship.dinkuskit.com") throw new Error(`unexpected call ${url}`);
      return hosted.handle(init.method ?? "GET", parsed.pathname, body);
    } },
    log: { error() {}, info() {}, warn() {}, debug() {} },
  };
  const page = async input => {
    const response = await admin({ input, ui: { surface: "admin-page", locale: "en", direction: "ltr" },
      user: { id: "u1", email, name: "Owner", role, createdAt: "" },
      request: { url: "https://shop.example.test/_emdash/api/plugins/dinkus-ship/admin", method: "POST", headers: {} } }, ctx);
    const checked = validateBlockResponse(response);
    if (!checked.valid) throw new Error(`invalid Block Kit: ${JSON.stringify(checked.errors)}`);
    return response;
  };
  const ship = () => calls.filter(call => call.url.startsWith("https://ship.dinkuskit.com"));
  return { page, calls, ship, hosted };
}
const text = response => JSON.stringify(response);
const submit = (form, values) => ({ type: "form_submit", action_id: `save:${form}`, values, page: PAGE });
const press = (action_id, value) => ({ type: "block_action", action_id, ...(value === undefined ? {} : { value }), page: PAGE });
const SHIP_FROM = { name: "Demo Owner", company: "", line1: "2 Warehouse Rd", line2: "", city: "Shiptown", region: "ny", postalCode: "10001" };

test("the manifest puts Shipping settings beside Shipments in the Store folder", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("jsonc-parser");
  const manifest = parse(await readFile(new URL("../emdash-plugin.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(manifest.admin.pages, [
    { path: "/shipping", label: "Shipments", icon: "truck", group: "Store" },
    { path: "/shipping-settings", label: "Shipping settings", icon: "gear", group: "Store" },
  ]);
  // No new permission or host (ship-settings-in-admin-129).
  assert.deepEqual(manifest.capabilities, ["network:request"]);
  assert.deepEqual(manifest.allowedHosts, ["dinkuskit.com", "ship.dinkuskit.com"]);
});

test("Shipping settings are for Administrators: an Editor is told so and nothing reaches DinkusKit.com or Ship", async () => {
  const h = host({ role: 40 });
  for (const input of [load, submit("ship-from", SHIP_FROM), press("disconnect_postage"), press("remove_box", "box_1")]) {
    const page = text(await h.page(input));
    assert.match(page, /Shipping settings are for Administrators/);
    assert.doesNotMatch(page, /"type":"form"/);
  }
  assert.deepEqual(h.calls, []);
});

test("before Connect the page sends the Administrator to the Shipments page, and never starts a Connect itself", async () => {
  const h = host({ connected: false });
  const page = text(await h.page(load));
  assert.match(page, /Connect Ship first/);
  assert.match(page, /"kind":"plugin-page","path":"\/shipping"/);
  assert.equal(text(await h.page(press("connect"))), page);
  assert.ok(h.calls.every(call => !call.url.includes("/connect")), "no Connect was started");
  assert.deepEqual(h.ship(), []);
});

test("the page shows Ship's settings with the ship-from form, Pitney Bowes sign-up and connect, reply-to and box sizes", async () => {
  const h = host();
  const response = await h.page(load);
  const page = text(response);
  for (const part of ["Ship from", "Save ship-from address", "Pitney Bowes postage", "Create your Pitney Bowes account", "Connect Pitney Bowes",
    "Shipped email", "Demo Shop (your store's Site title)", "Save reply-to email", "Box sizes", "No box sizes yet", "Add box size"]) assert.ok(page.includes(part), part);
  // Sign-up stays on Pitney Bowes' own site, as Ship's own Settings links it.
  assert.ok(page.includes(JSON.stringify(SIGNUP)));
  assert.match(page, /"type":"secret_input","action_id":"password"/);
  assert.match(page, /Ship is on the Pitney Bowes sandbox/);
  assert.match(page, /https:\/\/ship.dinkuskit.com\/stores\/site_demo\/settings/);
  // One pass trade and one read, on the plugin's ship:admin pass, naming the Administrator.
  assert.deepEqual(h.ship().map(call => `${call.method} ${new URL(call.url).pathname}`), ["GET /v1/admin/settings"]);
  assert.match(h.ship()[0].authorization, /^Bearer /);
  assert.equal(h.ship()[0].adminUser, "owner@example.test");
  assert.ok(h.calls.every(call => call.url === "https://dinkuskit.com/api/store-passes" ? call.authorization === `Bearer ${KEY}` : !String(call.authorization).includes(KEY)));
});

test("saving the ship-from address, reply-to email and a box size goes to Ship and the page shows what Ship kept", async () => {
  const h = host();
  const saved = await h.page(submit("ship-from", { ...SHIP_FROM, extra: "dropped" }));
  assert.equal(saved.toast.message, "Ship-from address saved.");
  assert.deepEqual(h.ship().at(-1).body, SHIP_FROM, "only the form's own fields are sent");
  assert.match(text(saved), /"action_id":"region","label":"State","initial_value":"NY"/);
  assert.equal((await h.page(submit("reply-to", { replyTo: "help@example.test" }))).toast.message, "Reply-to email saved.");
  const added = await h.page(submit("boxes", { name: "Small mailer", lengthIn: "8", widthIn: "6", heightIn: "4", weightOz: "3" }));
  assert.equal(added.toast.message, "Box size added.");
  assert.match(text(added), /Small mailer/);
  assert.match(text(added), /8 × 6 × 4 in/);
  assert.match(text(added), /"action_id":"remove_box","value":"box_1"/);
  const removed = await h.page(press("remove_box", "box_1"));
  assert.equal(removed.toast.message, "Box size removed.");
  assert.match(text(removed), /No box sizes yet/);
  assert.deepEqual(h.hosted.state.boxes, []);
  assert.equal(h.hosted.state.replyTo, "help@example.test");
});

test("Ship's refusal appears next to the submitted form, and the box being added stays typed", async () => {
  const h = host();
  const refusals = [
    ["boxes", { name: "Flat", lengthIn: "10", widthIn: "", heightIn: "1", weightOz: "2" }, /A box needs a name and a length, width and height in inches/],
    ["reply-to", { replyTo: "not an email" }, /Reply-to must be an email address/],
    ["ship-from", { ...SHIP_FROM, postalCode: "" }, /Ship-from needs a name, address, city, state and ZIP code/],
    ["postage", { username: "sample", password: "wrong-password" }, /Pitney Bowes did not accept/],
  ];
  for (const [form, values, reason] of refusals) {
    const { blocks } = await h.page(submit(form, values));
    const index = blocks.findIndex(block => block.type === "form" && block.submit.action_id === `save:${form}`);
    assert.ok(index >= 0, form);
    const error = blocks[index + 1];
    assert.equal(error.type, "banner", form);
    assert.equal(error.title, "Not saved");
    assert.match(error.description, reason);
    assert.equal(blocks.filter(block => block.type === "banner" && block.title === "Not saved").length, 1);
    if (form === "boxes") assert.equal(blocks[index].fields.find(field => field.action_id === "name").initial_value, "Flat");
  }
  assert.equal(h.hosted.state.replyTo, null);
});

test("Pitney Bowes connects inside EmDash: the password goes to Ship once and is never shown again", async () => {
  const h = host();
  const wrong = text(await h.page(submit("postage", { username: "owner", password: "wrong-password" })));
  assert.match(wrong, /Pitney Bowes did not accept that username and password/);
  assert.doesNotMatch(wrong, /wrong-password/);
  const connected = await h.page(submit("postage", { username: "owner", password: "right-password" }));
  assert.equal(connected.toast.message, "Pitney Bowes connected.");
  assert.match(text(connected), /Connected to Pitney Bowes: Demo Co · postage account ending 4321 · owner@example.test/);
  assert.doesNotMatch(text(connected), /right-password|secret_input/);
  const sent = h.ship().filter(call => call.url.endsWith("/v1/admin/settings/postage"));
  assert.deepEqual(sent.map(call => call.body), [{ username: "owner", password: "wrong-password" }, { username: "owner", password: "right-password" }]);
  assert.ok(sent.every(call => call.adminUser === "owner@example.test"), "Ship records the Administrator who connected it");
  const disconnected = await h.page(press("disconnect_postage"));
  assert.equal(disconnected.toast.message, "Pitney Bowes disconnected.");
  assert.match(text(disconnected), /Connect Pitney Bowes/);
});

test("until ship.dinkuskit.com has these routes the page sends the Administrator to Ship's own Settings", async () => {
  const h = host({ routes: false });
  const page = text(await h.page(load));
  assert.match(page, /Shipping settings are on Ship's page for now/);
  assert.match(page, /https:\/\/ship.dinkuskit.com\/stores\/site_demo\/settings/);
  assert.doesNotMatch(page, /"type":"form"/);
  assert.match(text(await h.page(submit("ship-from", SHIP_FROM))), /Shipping settings are on Ship's page for now/);
});
