import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/plugin.js";
import { projectSyntheticQuoteRequest } from "../src/package-validation.js";

function storage() {
  const rows = new Map();
  return {
    preferences: {
      get: async (id) => rows.get(id) ?? null,
      put: async (id, value) => rows.set(id, structuredClone(value)),
    },
  };
}

function ctx() {
  return {
    plugin: { id: "dinkuskit-ship", version: "0.0.0" },
    storage: storage(),
  };
}

const route = plugin.routes.admin.handler;

test("sandbox admin route renders the real Block Kit contract", async () => {
  const result = await route({
    input: { type: "page_load", page: "/orders" },
    ui: { locale: "en", direction: "ltr", surface: "admin-page" },
  }, ctx());

  assert.equal(result.blocks[0].type, "header");
  assert.equal(result.blocks[0].text, "Orders");
  assert.match(result.blocks[1].description, /No trusted Commerce order/);
  assert.doesNotMatch(JSON.stringify(result), /Order #1042|Sample Recipient|\$48\.00/);
  assert.doesNotMatch(JSON.stringify(result), /Propose a Commerce order handoff|propose-order-handoff/);
  assert.equal(result.blocks.at(-1).type, "context");
  assert.match(result.blocks.at(-1).text, /Host direction: ltr/);
});

test("admin action persists through the supported storage surface", async () => {
  const context = ctx();
  await route({
    input: {
      type: "form_submit",
      action_id: "save-preferences",
      values: { showDashboardLinks: false },
    },
    ui: { locale: "en", direction: "ltr", surface: "admin-page" },
  }, context);

  const result = await route({
    input: { type: "page_load", page: "/settings" },
    ui: { locale: "en", direction: "ltr", surface: "admin-page" },
  }, context);

  assert.equal(result.blocks.some((block) => block.type === "form"), true);
  assert.equal(result.blocks.some((block) => block.text === "Provider dashboard links"), false);
  assert.equal(result.blocks.find((block) => block.type === "form").fields[0].initial_value, false);
});

test("host-attested Arabic RTL is translated without guessing direction", async () => {
  const context = ctx();
  const result = await route({
    input: { type: "page_load", page: "/settings" },
    ui: { locale: "ar-SA", direction: "rtl", surface: "admin-page" },
  }, context);

  assert.equal(result.blocks[0].text, "إعدادات الشحن");
  assert.match(result.blocks.at(-1).text, /لغة المضيف: ar-SA · اتجاه المضيف: rtl/);
  assert.doesNotMatch(JSON.stringify(result), /Local package proof|Display-only|Provider dashboard links/);
});

test("synthetic order data requires the explicit isolated fixture", async () => {
  const result = await route({
    input: { type: "page_load", page: "/order-detail", fixture: "synthetic-order-1042" },
    ui: { locale: "ar-SA", direction: "rtl", surface: "admin-page" },
  }, ctx());

  assert.equal(result.blocks[0].text, "طلب اختبار اصطناعي");
  assert.match(JSON.stringify(result), /الطلب رقم 1042/);
  assert.match(JSON.stringify(result), /48\.00 دولار أمريكي/);
  assert.doesNotMatch(JSON.stringify(result), /Order|Recipient|Delivery|Paid total|Inventory|Commerce owns/);
});

test("unknown locale falls back to English while preserving host direction", async () => {
  const result = await route({
    input: { type: "page_load", page: "/orders" },
    ui: { locale: "zz-ZZ", direction: "rtl", surface: "admin-page" },
  }, ctx());

  assert.equal(result.blocks[0].text, "Orders");
  assert.match(result.blocks.at(-1).text, /Host locale: zz-ZZ · Host direction: rtl/);
});

test("sandbox route exposes no provider mutation actions", () => {
  const source = JSON.stringify(plugin);
  assert.doesNotMatch(source, /quote|purchase|retry|createLabel|credentials/i);
});

test("direct detail and shipping requests cannot expose an unmounted order", async () => {
  for (const input of [
    { type: "page_load", page: "/order-detail" },
    { type: "page_load", page: "/shipping" },
    { type: "block_action", action_id: "make-postage-label" },
    { type: "block_action", action_id: "back-order-detail" },
  ]) {
    const result = await route({ input, ui: { locale: "en", direction: "ltr" } }, ctx());
    assert.equal(result.blocks[0].text, "Orders");
    assert.doesNotMatch(JSON.stringify(result), /1042|Sample Recipient|48\.00|Example Avenue/);
  }
});

test("fixture shipping review navigates to settings through an admin action", async () => {
  const context = ctx();
  const result = await route({ input: { type: "page_load", page: "/shipping", fixture: "synthetic-order-1042" } }, context);
  const settings = result.blocks.find((b) => b.type === "actions").elements.find((e) => e.label === "Ship settings");
  assert.equal(settings.type, "button");
  const next = await route({ input: { type: "block_action", action_id: settings.action_id } }, context);
  assert.equal(next.blocks[0].text, "Ship settings");
});

test("synthetic shipping form exposes editable package and fail-closed prerequisites", async () => {
  const result = await route({
    input: { type: "page_load", page: "/shipping", fixture: "synthetic-order-1042" },
    ui: { locale: "en", direction: "ltr" },
  }, ctx());
  const serialized = JSON.stringify(result);
  assert.match(serialized, /Display-only isolated test fixture/);
  assert.match(serialized, /Commerce order binding is not available/);
  assert.match(serialized, /Original provider outcome unknown · blocked/);
  assert.equal(result.blocks.some((block) => block.type === "form" && block.submit.action_id === "update-package"), true);
  assert.match(serialized, /\$48\.00 USD · paid · Commerce total immutable/);
  assert.match(serialized, /100 Example Avenue/);
});

test("synthetic package form keeps destination and paid total fixed while updating valid dimensions", async () => {
  const result = await route({
    input: {
      type: "form_submit",
      action_id: "update-package",
      fixture: "synthetic-order-1042",
      values: { weightLb: "3.5", lengthIn: "12", widthIn: "9", heightIn: "5", destination: "attacker" },
    },
    ui: { locale: "en", direction: "ltr" },
  }, ctx());
  const serialized = JSON.stringify(result);
  assert.match(serialized, /3\.5 lb · 12 × 9 × 5 in/);
  assert.match(serialized, /Valid fixture package/);
  assert.match(serialized, /100 Example Avenue/);
  assert.match(serialized, /\$48\.00 USD · paid · Commerce total immutable/);
  assert.doesNotMatch(serialized, /attacker/);
});

test("invalid package form remains visibly unavailable", async () => {
  const result = await route({
    input: {
      type: "form_submit",
      action_id: "update-package",
      fixture: "synthetic-order-1042",
      values: { weightLb: "NaN", lengthIn: "0", widthIn: "8", heightIn: "4" },
    },
    ui: { locale: "en", direction: "ltr" },
  }, ctx());
  assert.match(JSON.stringify(result), /Package needs correction/);
  assert.match(JSON.stringify(result), /Commerce order binding is not available/);
});

test("package projection rejects invalid, nonfinite, nonpositive, out-of-range, and missing orders", () => {
  const base = { weightLb: "2", lengthIn: "10", widthIn: "8", heightIn: "4" };
  assert.equal(projectSyntheticQuoteRequest({ package: base }).code, "no_order");
  assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "other" }, package: base }).code, "no_order");
  assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042" }, package: { ...base, weightLb: "Infinity" } }).code, "invalid_number");
  assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042" }, package: { ...base, widthIn: "0" } }).code, "nonpositive");
  assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042" }, package: { ...base, weightLb: "71" } }).code, "weight_out_of_range");
  assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042" }, package: { ...base, lengthIn: "85" } }).code, "dimensions_out_of_range");
});

test("package projection is isolated and does not mutate submitted data", () => {
  const packageInput = { weightLb: "2", lengthIn: "10", widthIn: "8", heightIn: "4", destination: "untrusted" };
  const result = projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042", destination: "untrusted" }, package: packageInput });
  assert.equal(result.ok, true);
  assert.equal(result.request.destination.postalCode, "90210");
  assert.equal(result.paidTotal.amount, 48);
  assert.equal(packageInput.destination, "untrusted");
});
