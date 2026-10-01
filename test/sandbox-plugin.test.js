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
  assert.match(result.blocks.at(-1).text, /Host locale: ar-SA · Host direction: rtl/);
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
