import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/plugin.js";

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
