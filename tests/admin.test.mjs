import test from "node:test";
import assert from "node:assert/strict";
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

/** A host with the plugin's settings, a fake network, and an Editor at the Shipping page. */
function host({ siteId = SITE, key = KEY, ship = {}, passes = () => Response.json({ access_token: pass(), token_type: "Bearer", expires_in: 300 }), role = 40, requestUrl = "" } = {}) {
  const calls = [];
  const ctx = {
    settings: { get: async name => ({ siteId, storeKey: key })[name] ?? null },
    http: { fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const adminPage = init?.headers?.["x-ship-admin-page"], adminUser = init?.headers?.["x-ship-admin-user"];
      calls.push({ url, method: init?.method ?? "GET", authorization: init?.headers?.authorization, ...(adminPage === undefined ? {} : { adminPage }), ...(adminUser === undefined ? {} : { adminUser }), body });
      if (url === "https://dinkuskit.com/api/store-passes") return passes({ url, init, body });
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
  return { ctx, calls, page, route };
}
const text = response => JSON.stringify(response);
const load = { type: "page_load", page: "/shipping" };

test("lower roles and other surfaces never reach Ship", async () => {
  const h = host({ role: 30 });
  assert.match(text(await h.page(load)), /Editors and Administrators/);
  const r = h.route(load);
  assert.match(text(await admin({ ...r, ui: { surface: "dashboard-widget" } }, h.ctx)), /Editors and Administrators/);
  assert.match(text(await admin({ ...r, user: undefined }, h.ctx)), /Editors and Administrators/);
  assert.deepEqual(h.calls, []);
});

test("until both settings are pasted the page asks for them, and a malformed one is named", async () => {
  for (const settings of [{ siteId: "", key: KEY }, { siteId: SITE, key: "" }]) {
    const h = host(settings);
    const page = text(await h.page(load));
    assert.match(page, /Connect Ship/);
    assert.match(page, /"kind":"plugin-settings"/);
    assert.deepEqual(h.calls, []);
  }
  assert.match(text(await host({ key: "sk_live_not_a_store_key" }).page(load)), /store key is not one DinkusKit.com gives/);
  assert.match(text(await host({ siteId: "bad site" }).page(load)), /Store ID is not one DinkusKit.com gives/);
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
