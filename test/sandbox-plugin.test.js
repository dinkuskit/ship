import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/plugin.js";
import { validateOrigin } from "../src/plugin.js";
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
  assert.equal(result.blocks.find((block) => block.type === "form" && block.submit.action_id === "save-preferences")
    .fields[0].initial_value, false);
});

test("merchant ship-from address saves separately and reloads from plugin storage", async () => {
  const context = ctx();
  const values = {
    name: "Fictional Merchant",
    company: "Example Goods",
    addressLine1: "42 Fictional Way",
    addressLine2: "Suite 7",
    city: "Anytown",
    state: "CA",
    postalCode: "90210",
    country: "US",
  };
  const saved = await route({
    input: { type: "form_submit", action_id: "save-origin", values },
    ui: { locale: "en", direction: "ltr" },
  }, context);
  assert.equal(saved.toast.message, "Ship-from address saved locally.");
  const reloaded = await route({
    input: { type: "page_load", page: "/settings" },
    ui: { locale: "en", direction: "ltr" },
  }, context);
  const form = reloaded.blocks.find((block) => block.type === "form" && block.submit.action_id === "save-origin");
  assert.equal(form.fields.find((field) => field.action_id === "country").initial_value, "US");
  assert.equal(form.fields.find((field) => field.action_id === "postalCode").initial_value, "90210");
  const editedValues = { ...values, addressLine2: "", city: "Example City", state: "ny", postalCode: "10001-1234" };
  await route({ input: { type: "form_submit", action_id: "save-origin", values: editedValues } }, context);
  await route({ input: { type: "form_submit", action_id: "save-preferences", values: { showDashboardLinks: false } } }, context);
  assert.deepEqual(await context.storage.preferences.get("origin"), { ...editedValues, state: "NY" });
  const status = await plugin.routes.status.handler({}, context);
  assert.equal(status.preferences.showDashboardLinks, false);
  assert.doesNotMatch(JSON.stringify(status), /Fictional Merchant|Fictional Way|10001|origin/);
});

test("invalid ship-from address preserves saved origin and preferences", async () => {
  const context = ctx();
  await route({
    input: {
      type: "form_submit", action_id: "save-origin",
      values: {
        name: "Fictional Merchant", company: "", addressLine1: "42 Fictional Way",
        addressLine2: "", city: "Anytown", state: "CA", postalCode: "90210", country: "US",
      },
    },
  }, context);
  await route({
    input: { type: "form_submit", action_id: "save-preferences", values: { showDashboardLinks: false } },
  }, context);
  const invalid = await route({
    input: {
      type: "form_submit", action_id: "save-origin",
      values: {
        name: "", company: "", addressLine1: "Not an address", addressLine2: "",
        city: "Anytown", state: "California", postalCode: "90210-INVALID", country: "CA",
      },
    },
  }, context);
  assert.equal(invalid.toast.message, "Enter a valid U.S. ship-from address.");
  const settings = await route({ input: { type: "page_load", page: "/settings" } }, context);
  const originFormResult = settings.blocks.find((block) => block.type === "form" && block.submit.action_id === "save-origin");
  assert.equal(originFormResult.fields.find((field) => field.action_id === "addressLine1").initial_value, "42 Fictional Way");
  assert.equal(settings.blocks.find((block) => block.type === "form" && block.submit.action_id === "save-preferences")
    .fields[0].initial_value, false);
});

test("ship-from validation is bounded and structurally U.S.-specific", () => {
  assert.equal(validateOrigin({
    name: "Merchant", addressLine1: "42 Fictional Way", city: "Anytown",
    state: "ca", postalCode: "90210", country: "US",
  }).origin.state, "CA");
  assert.equal(validateOrigin({
    name: "Merchant", addressLine1: "42 Fictional Way", city: "Anytown",
    state: "CA", postalCode: "90210", country: "CA",
  }).ok, false);
  assert.equal(validateOrigin({
    name: "Merchant", addressLine1: "x".repeat(101), city: "Anytown",
    state: "CA", postalCode: "90210", country: "US",
  }).ok, false);
});

test("invalid optional origin fields cannot silently replace a saved address", async () => {
  const values = {
    name: "Example Merchant", company: "Example Goods", addressLine1: "42 Fictional Way",
    addressLine2: "", city: "Example City", state: "NY", postalCode: "10001-1234", country: "US",
  };
  const context = ctx();
  await route({ input: { type: "form_submit", action_id: "save-origin", values } }, context);
  for (const update of [
    { name: "x".repeat(101) }, { company: "x".repeat(101) }, { name: 123 },
    { company: {} }, { addressLine2: [] }, { city: "Example\nCity" },
    { addressLine1: "\u0000" }, { state: "ZZ" }, { postalCode: "1234" },
    { name: "", company: "" },
  ]) {
    const invalid = await route({ input: { type: "form_submit", action_id: "save-origin", values: { ...values, ...update } } }, context);
    assert.equal(invalid.toast.type, "error");
    assert.deepEqual(await context.storage.preferences.get("origin"), values);
  }
  const companyOnly = validateOrigin({ ...values, name: undefined, addressLine2: undefined, state: "pr" });
  assert.equal(companyOnly.ok, true);
  assert.equal(companyOnly.origin.state, "PR");
  assert.equal(companyOnly.origin.name, "");
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

test("package form uses exact English dimension labels by default", async () => {
  const result = await route({
    input: { type: "block_action", page: "/proof-fixture", action_id: "make-postage-label" },
    ui: { direction: "ltr" },
  }, ctx());
  const form = result.blocks.find((block) => block.type === "form");

  assert.deepEqual(
    form.fields.filter((field) => ["lengthIn", "widthIn", "heightIn"].includes(field.action_id))
      .map((field) => field.label),
    ["Length", "Width", "Height"],
  );
});

test("package form uses exact Arabic dimension labels for an RTL host", async () => {
  const result = await route({
    input: { type: "block_action", page: "/proof-fixture", action_id: "make-postage-label" },
    ui: { locale: "ar-SA", direction: "rtl", surface: "admin-page" },
  }, ctx());
  const form = result.blocks.find((block) => block.type === "form");

  assert.deepEqual(
    form.fields.filter((field) => ["lengthIn", "widthIn", "heightIn"].includes(field.action_id))
      .map((field) => field.label),
    ["الطول", "العرض", "الارتفاع"],
  );
});

test("package form uses exact English dimension labels for unknown locales", async () => {
  const result = await route({
    input: { type: "block_action", page: "/proof-fixture", action_id: "make-postage-label" },
    ui: { locale: "zz-ZZ", direction: "rtl", surface: "admin-page" },
  }, ctx());
  const form = result.blocks.find((block) => block.type === "form");

  assert.deepEqual(
    form.fields.filter((field) => ["lengthIn", "widthIn", "heightIn"].includes(field.action_id))
      .map((field) => field.label),
    ["Length", "Width", "Height"],
  );
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
    input: { type: "block_action", page: "/proof-fixture", action_id: "make-postage-label" },
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

test("package form maps every visible validation code to Arabic copy", async () => {
  const cases = [
    {
      name: "invalid number",
      values: { weightLb: "NaN", lengthIn: "10", widthIn: "8", heightIn: "4" },
      message: "يجب أن يكون الوزن والأبعاد قيمًا عشرية منتهية.",
    },
    {
      name: "nonpositive",
      values: { weightLb: "2", lengthIn: "0", widthIn: "8", heightIn: "4" },
      message: "يجب أن يكون الوزن والأبعاد أكبر من الصفر.",
    },
    {
      name: "weight out of range",
      values: { weightLb: "71", lengthIn: "10", widthIn: "8", heightIn: "4" },
      message: "يجب ألا يزيد الوزن عن 70 رطل.",
    },
    {
      name: "dimensions out of range",
      values: { weightLb: "2", lengthIn: "85", widthIn: "8", heightIn: "4" },
      message: "يجب ألا يتجاوز الطول مع المحيط 108 بوصة.",
    },
  ];

  for (const testCase of cases) {
    const result = await route({
      input: {
        type: "form_submit",
        action_id: "update-package",
        fixture: "synthetic-order-1042",
        values: testCase.values,
      },
      ui: { locale: "ar-SA", direction: "rtl" },
    }, ctx());
    const validation = result.blocks.find((block) => block.type === "fields")
      .fields.find((field) => field.label === "التحقق من الطرد");

    assert.equal(validation.value, `يحتاج الطرد إلى تصحيح · ${testCase.message}`, testCase.name);
    assert.doesNotMatch(validation.value, /Weight|Length|girth|must|finite|greater/);
  }
});

test("package form keeps English validation copy for default and locale fallback", async () => {
  const cases = [
    {
      name: "invalid number",
      values: { weightLb: "NaN", lengthIn: "10", widthIn: "8", heightIn: "4" },
      message: "Weight and dimensions must be finite decimal values.",
    },
    {
      name: "nonpositive",
      values: { weightLb: "2", lengthIn: "0", widthIn: "8", heightIn: "4" },
      message: "Weight and dimensions must be greater than zero.",
    },
    {
      name: "weight out of range",
      values: { weightLb: "71", lengthIn: "10", widthIn: "8", heightIn: "4" },
      message: "Weight must be no more than 70 lb.",
    },
    {
      name: "dimensions out of range",
      values: { weightLb: "2", lengthIn: "85", widthIn: "8", heightIn: "4" },
      message: "Length plus girth must be no more than 108 in.",
    },
  ];

  for (const locale of [undefined, "zz-ZZ"]) {
    for (const testCase of cases) {
      const result = await route({
        input: {
          type: "form_submit",
          action_id: "update-package",
          fixture: "synthetic-order-1042",
          values: testCase.values,
        },
        ui: locale ? { locale, direction: "ltr" } : undefined,
      }, ctx());
      const validation = result.blocks.find((block) => block.type === "fields")
        .fields.find((field) => field.label === "Package validation");

      assert.equal(validation.value, `Package needs correction · ${testCase.message}`,
        `${locale ?? "default"}: ${testCase.name}`);
    }
  }
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

test("fixture package form uses renderable Block Kit fields and page-scoped actions", async () => {
  const context = ctx();
  const input = { page: "/proof-fixture", type: "block_action", action_id: "make-postage-label" };
  const result = await route({ input }, context);
  const form = result.blocks.find(b => b.type === "form");
  assert.ok(form);
  assert.ok(form.fields.every(f => f.type === "text_input"));
  const changed = await route({ input: { page: "/proof-fixture", type: "form_submit", action_id: "update-package", values: { weightLb: "3.5", lengthIn: "12", widthIn: "9", heightIn: "5" } } }, context);
  assert.match(JSON.stringify(changed), /3\.5 lb/);
  const back = await route({ input }, context);
  assert.match(JSON.stringify(back), /3\.5 lb/);
});

test("package decimals reject hex and malformed UI values", async () => {
  const base = { weightLb: "2", lengthIn: "10", widthIn: "8", heightIn: "4" };
  for (const weightLb of ["0x10", "1e2", {}, [], true]) {
    assert.equal(projectSyntheticQuoteRequest({ order: { fixture: "synthetic-order-1042" }, package: {...base, weightLb} }).ok, false);
  }
  const result = await route({input:{page:"/proof-fixture",type:"form_submit",action_id:"update-package",values:{weightLb:{unexpected:true},lengthIn:"10",widthIn:"8",heightIn:"4"}}},ctx());
  assert.match(JSON.stringify(result), /Package needs correction/);
  assert.equal(typeof result.blocks.find(b=>b.type==="form").fields[0].initial_value,"string");
});
