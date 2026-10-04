import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSandboxAdapter, isSafePdfUrl, SANDBOX_API_ORIGIN, SANDBOX_OAUTH_ORIGIN } from "../src/pb-sandbox.js";
import { FileStateStore, SandboxTask } from "../src/state.js";
import { createApp } from "../src/server.js";
import { createFixturePdf, fixturePdfTextLines } from "../test-support/fixture-pdf.js";
import plugin from "../src/plugin.js";

const credentials = { apiKey: "test-key", apiSecret: "test-secret", shipperId: "test-shipper" };
const shipment = {
  from: { country: "US", name: "Synthetic Sender", addressLines: ["27 Waterview Drive"], cityTown: "Shelton", stateProvince: "CT", postalCode: "06484" },
  to: { country: "US", name: "Synthetic Recipient", addressLines: ["1 Sullivan SQ"], cityTown: "Berwick", stateProvince: "ME", postalCode: "03901" },
  parcel: { weightOz: 1.25, lengthIn: 8, widthIn: 6, heightIn: 1 },
};

const rateResponse = { rates: [{ carrier: "USPS", serviceId: "PM", parcelType: "PKG", totalCarrierCharge: 8.6, specialServices: [{ specialServiceId: "DelCon" }] }] };
const labelUrl = "https://stg-labels-cls.gcs.pitneybowes.com/usps/123/outbound/label/abc.pdf";

test("local EmDash package seam has a private JSON route contract", async () => {
  const manifestSource = await readFile(new URL("../emdash-plugin.jsonc", import.meta.url), "utf8");
  const manifest = JSON.parse(manifestSource.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(manifest.slug, "ship");
  assert.deepEqual(manifest.capabilities, []);
  assert.deepEqual(manifest.allowedHosts, []);
  assert.deepEqual(manifest.storage, { preferences: { indexes: ["locale"] } });
  assert.equal(manifest.publisher, undefined);

  for (const [name, route] of Object.entries(plugin.routes)) {
    assert.deepEqual(route.methods, ["POST"], name);
    assert.equal(route.request.body, "json", name);
    assert.equal(route.request.maxBytes, 1024 * 1024, name);
    assert.equal(route.public, undefined, name);
    assert.equal(typeof route.handler, "function", name);
  }
  assert.equal(plugin.routes.admin.permission, "plugins:manage");
  assert.equal(plugin.routes.settings.permission, "plugins:manage");
  assert.equal(plugin.routes.status.permission, "plugins:read");
  const persistent = {
    preferences: {
      value: null,
      get: async () => persistent.preferences.value,
      put: async (_id, value) => { persistent.preferences.value = value; },
    },
  };
  const result = await plugin.routes.admin.handler({
    input: { type: "page_load", page: "/orders" },
    ui: { locale: "en", direction: "ltr", surface: "admin-page" },
  }, { plugin: { id: "ship", version: "0.0.0" }, storage: persistent });
  assert.equal(result.blocks[0].text, "Orders");
  assert.match(result.blocks.at(-1).text, /Host direction: ltr/);
});

test("fixture PDF is structurally valid and contains only synthetic proof text", async () => {
  const pdf = createFixturePdf();
  const source = pdf.toString("ascii");
  assert.match(source, /^%PDF-1\.4\n/);
  assert.match(source, /\/Type \/Catalog \/Pages 2 0 R/);
  assert.match(source, /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/);
  assert.match(source, /\/Type \/Page \/Parent 2 0 R/);
  assert.match(source, /\/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica/);
  for (const line of fixturePdfTextLines) assert.match(source, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const startxref = Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(startxref, startxref + 4), "xref");
  const xrefRows = source.slice(startxref).match(/\n(\d{10}) 00000 n /g) || [];
  assert.equal(xrefRows.length, 5);
  for (const row of xrefRows) {
    const offset = Number(row.slice(1, 11));
    assert.match(source.slice(offset), /^\d+ \d+ obj\n/);
  }
  try {
    const dir = await mkdtemp(join(tmpdir(), "ship-pdf-"));
    const path = join(dir, "fixture.pdf");
    try {
      await writeFile(path, pdf);
      execFileSync("pdfinfo", [path], { stdio: ["ignore", "pipe", "ignore"] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
});

async function withTask(adapter, callback) {
  const dir = await mkdtemp(join(tmpdir(), "ship-pb-"));
  const store = new FileStateStore(join(dir, "state.json"));
  try { return await callback(new SandboxTask({ adapter, store })); }
  finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
}

function fakeAdapter(overrides = {}) {
  return {
    quote: async () => ({ service: "PM", serviceLabel: "USPS Priority Mail", currency: "USD", amount: 8.6 }),
    createLabel: async () => ({ shipmentId: "sandbox-1", pdfUrl: labelUrl, price: 8.6 }),
    ...overrides,
  };
}

test("official transport shapes and response parsing are faithful", async () => {
  const requests = [];
  const adapter = createSandboxAdapter({
    credentials,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "token", tokenType: "BearerToken", expiresIn: "600" }));
      if (url.endsWith("/rates")) return new Response(JSON.stringify(rateResponse));
      return new Response(JSON.stringify({ shipmentId: "s-1", currencyCode: "USD", rates: [{ carrier: "USPS", serviceId: "PM", parcelType: "PKG", totalCarrierCharge: 8.6 }], documents: [{ type: "SHIPPING_LABEL", contentType: "URL", size: "DOC_8X11", fileFormat: "PDF", contents: labelUrl }] }));
    },
  });
  assert.deepEqual(await adapter.quote(shipment), { service: "PM", serviceLabel: "USPS Priority Mail", currency: "USD", amount: 8.6 });
  const label = await adapter.createLabel(shipment, "op_123");
  assert.equal(label.pdfUrl, labelUrl);
  const quoteBody = JSON.parse(requests[1].options.body);
  assert.equal(requests[0].url, `${SANDBOX_OAUTH_ORIGIN}/oauth/token`);
  assert.equal(requests[1].url, `${SANDBOX_API_ORIGIN}/shippingservices/v1/rates`);
  assert.equal(requests[1].options.headers["SHIPPER_ID"], undefined);
  assert.deepEqual(quoteBody.shipmentOptions, [{ name: "SHIPPER_ID", value: "test-shipper" }]);
  assert.deepEqual(quoteBody.fromAddress.addressLines, ["27 Waterview Drive"]);
  assert.equal(quoteBody.toAddress.cityTown, "Berwick");
  assert.deepEqual(quoteBody.rates[0].specialServices, [{ specialServiceId: "DelCon" }]);
  const create = requests[2];
  assert.equal(create.options.headers["X-PB-TransactionId"], "op_123");
  assert.deepEqual(JSON.parse(create.options.body).documents, [{ type: "SHIPPING_LABEL", contentType: "URL", size: "DOC_8X11", fileFormat: "PDF", printDialogOption: "NO_PRINT_DIALOG" }]);
});

test("same operation key reuses durable result and concurrent clicks dispatch once", async () => {
  let creates = 0;
  await withTask(fakeAdapter({ createLabel: async () => { creates++; await new Promise((r) => setTimeout(r, 10)); return { shipmentId: "one", pdfUrl: labelUrl }; } }), async (task) => {
    const quote = await task.quote(shipment);
    const input = { input: shipment, quoteId: quote.quoteId, review: { confirmed: true, service: "PM", amount: 8.6 }, idempotencyKey: "same" };
    const [first, second] = await Promise.all([task.createTestLabel(input), task.createTestLabel(input)]);
    assert.deepEqual(second, first);
    assert.equal(creates, 1);
  });
});

test("pending and unknown outcomes block restart and new keys for same shipment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ship-pb-reload-"));
  const store = new FileStateStore(join(dir, "state.json"));
  try {
    const task = new SandboxTask({ adapter: fakeAdapter({ createLabel: async () => { throw new Error("malformed after dispatch"); } }), store });
    const quote = await task.quote(shipment);
    const input = { input: shipment, quoteId: quote.quoteId, review: { confirmed: true, service: "PM", amount: 8.6 }, idempotencyKey: "unknown" };
    await assert.rejects(task.createTestLabel(input), (e) => e.code === "internal" || e.code === undefined);
    const restarted = new SandboxTask({ adapter: fakeAdapter(), store });
    await assert.rejects(restarted.createTestLabel(input), (e) => e.code === "unknown_operation" || e.message.includes("unresolved"));
    await assert.rejects(restarted.createTestLabel({ ...input, idempotencyKey: "new_key" }), (e) => e.code === "unknown_operation" || e.message.includes("unresolved"));
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("invalid review, changed shipment, and dangerous keys are rejected", async () => {
  await withTask(fakeAdapter(), async (task) => {
    const quote = await task.quote(shipment);
    await assert.rejects(task.createTestLabel({ input: shipment, quoteId: quote.quoteId, review: { confirmed: false, service: "PM", amount: 8.6 }, idempotencyKey: "review" }), (e) => e.code === "review_invalid");
    await assert.rejects(task.createTestLabel({ input: { ...shipment, to: { ...shipment.to, postalCode: "03902" } }, quoteId: quote.quoteId, review: { confirmed: true, service: "PM", amount: 8.6 }, idempotencyKey: "edited" }), (e) => e.code === "quote_invalid");
    await assert.rejects(task.createTestLabel({ input: shipment, quoteId: quote.quoteId, review: { confirmed: true, service: "PM", amount: 8.6 }, idempotencyKey: "__proto__" }), (e) => e.code === "validation");
  });
});

test("production redirects, arbitrary label hosts, and wrong document bodies are rejected", async () => {
  assert.throws(() => createSandboxAdapter({ credentials, apiOrigin: "https://api.shippingapi.pitneybowes.com" }), /fixed/);
  for (const value of ["https://example.com/usps/1/outbound/label/a.pdf", "https://stg-labels-cls.gcs.pitneybowes.com:444/usps/1/outbound/label/a.pdf", "https://stg-labels-cls.gcs.pitneybowes.com/usps/1/outbound/label/a.pdf?x=1"]) assert.equal(isSafePdfUrl(value), false);
  assert.equal(isSafePdfUrl(labelUrl), true);
  const malformed = createSandboxAdapter({ credentials, fetchImpl: async () => new Response("not-json") });
  await assert.rejects(malformed.quote(shipment), (e) => e.code === "provider_malformed" && !e.message.includes("not-json"));
});

test("state ownership requires close and persists callback failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ship-pb-owner-"));
  const file = join(dir, "state.json");
  const first = new FileStateStore(file);
  const second = new FileStateStore(file);
  try {
    await first.transact((state) => { state.operations.failed = { status: "unknown" }; throw new Error("dispatch failed"); }).catch(() => {});
    await assert.rejects(second.read(), (error) => error.code === "state_owner");
    await first.close();
    assert.deepEqual(await second.read(), { quotes: {}, operations: { failed: { status: "unknown" } } });
  } finally {
    await first.close();
    await second.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP factory enforces loopback headers, JSON payloads, size limits, and PDF disposition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ship-pb-http-"));
  const port = 4399;
  const store = new FileStateStore(join(dir, "state.json"));
  const app = createApp({
    port,
    store,
    adapter: fakeAdapter(),
    pdfFetch: async () => new Response(Buffer.from("%PDF-1.4 fixture"), { headers: { "content-type": "application/pdf" } }),
  });
  await new Promise((resolve) => app.listen(port, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${port}`;
    const rejectedHost = await new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/status", headers: { Host: `127.0.0.1:${port + 1}` } }, resolve);
      req.on("error", reject);
      req.end();
    });
    assert.equal(rejectedHost.statusCode, 403);
    const rejectedOrigin = await fetch(base + "/api/status", { headers: { Origin: "http://evil.test" } });
    assert.equal(rejectedOrigin.status, 403);
    const wrongType = await fetch(base + "/api/quote", { method: "POST", body: "{}" });
    assert.equal(wrongType.status, 415);
    const tooLarge = await fetch(base + "/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: " ".repeat(100_001) });
    assert.equal(tooLarge.status, 413);
    const quoteResponse = await fetch(base + "/api/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipment }),
    });
    assert.equal(quoteResponse.status, 200);
    const quote = (await quoteResponse.json()).quote;
    const labelResponse = await fetch(base + "/api/test-label", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: shipment, quoteId: quote.quoteId, review: { confirmed: true, service: "PM", amount: 8.6 }, idempotencyKey: "http-test" }),
    });
    assert.equal(labelResponse.status, 200);
    const pdf = await fetch(`${base}/api/test-label/http-test/pdf?download=1`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-disposition"), /^attachment;/);
    assert.match(await pdf.text(), /^%PDF-/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
