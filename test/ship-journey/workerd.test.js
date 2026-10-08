import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { comparePackedFileBytes } from "../../test-support/ship-journey/package-install.mjs";
import { ORDER, ORDER_IDS, PACKAGE } from "../../test-support/ship-journey/journey-fixture.mjs";
import { createFixturePdf } from "../../test-support/fixture-pdf.js";
import { configureJourneyHost, prepareInstalledEmdashHost, startJourneyHost, stopJourneyHost } from "../../test-support/ship-journey/host.mjs";

const run = promisify(execFile);
const enabled = process.env.SHIP_JOURNEY_WORKER === "1";
test("installed Ship fixture through private EmDash HTTP and workerd", {
  skip: enabled ? false : "run with scripts/verify-ship-journey.mjs --workerd",
}, async () => {
  const host = await prepareInstalledEmdashHost();
  try {
    await comparePackedFileBytes({ packed: host.packed, installedDirectories: [host.installedDirectory] });
    const { createShipPlugin } = await import(pathToFileURL(createRequire(join(host.hostDirectory, "package.json")).resolve("@dinkuskit/ship/installed")));
    await assert.rejects(createShipPlugin().routes.journey.handler({ user: { id: "synthetic" }, input: { action: "load", orderId: ORDER.orderId } }, {}), /dependencies are unavailable/);
    await configureJourneyHost(host);
    await startJourneyHost(host);
    const bypass = await fetch(`${host.base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`, { redirect: "manual" });
    const cookie = bypass.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "disposable host did not issue its local session");
    const headers = { "content-type": "application/json", "X-EmDash-Request": "1", Cookie: cookie };
    const call = async (route, body, requestHeaders = headers) => {
      const response = await fetch(`${host.base}/_emdash/api/plugins/dinkuskit-ship/${route}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
      const bytes = Buffer.from(await response.arrayBuffer());
      let data; try { data = JSON.parse(bytes.toString()); } catch {}
      return { response, bytes, data };
    };
    const journey = (action, orderId = ORDER.orderId, input = {}) => call("journey", { action, orderId, ...input });
    const state = async () => JSON.parse(await readFile(host.fixtureFile, "utf8"));
    const sql = async (statement, params = []) => JSON.parse((await run("python3", ["-c", "import sqlite3,sys,json;db=sqlite3.connect(sys.argv[1]);print(json.dumps(db.execute(sys.argv[2],json.loads(sys.argv[3])).fetchall()))", join(host.hostDirectory, ".emdash/proof.sqlite"), statement, JSON.stringify(params)])).stdout);
    const record = async orderId => {
      const rows = await sql("SELECT data FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id=?", ["dinkuskit-ship", "operations", `ship:v1:fixture-shop:${orderId}`]);
      return rows.length ? JSON.parse(rows[0][0]) : null;
    };
    const creates = async () => (await state()).__creates?.length ?? 0;
    const controls = async value => assert.equal((await call("fixture", { action: "controls", controls: value })).response.ok, true);
    const success = item => { assert.equal(item.response.ok, true, JSON.stringify(item.data)); return item.data.data; };
    const denied = item => {
      assert.equal(item.response.ok, false);
      assert.notEqual(item.response.headers.get("content-type"), "application/pdf");
      assert.doesNotMatch(item.bytes.toString(), /Synthetic Recipient|Example Street|%PDF-/);
    };
    const quoteBuy = async (orderId, key) => {
      const quote = success(await journey("quote", orderId, { packageValues: PACKAGE }));
      assert.equal(quote.amount, 8.6);
      const input = { packageValues: PACKAGE, quoteId: quote.quoteId, idempotencyKey: key, confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" } };
      return { quote, input };
    };

    assert.equal((await call("journey", { action: "load", orderId: ORDER.orderId }, { "content-type": "application/json", "X-EmDash-Request": "1" })).response.status, 401);
    assert.equal((await call("journey", { action: "load", orderId: ORDER.orderId }, { "content-type": "application/json", Cookie: cookie })).response.status, 403);
    denied(await journey("load", "order:00000000-0000-4000-8000-999999999999"));
    const setRole = async role => run("python3", ["-c", `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 row=db.execute("SELECT role FROM users WHERE email='dev@emdash.local'").fetchone()
 if row is None or row[0]!=(50 if int(sys.argv[2])==20 else 20): raise SystemExit('unexpected task user role')
 db.execute("UPDATE users SET role=? WHERE email='dev@emdash.local'",(int(sys.argv[2]),))`, join(host.hostDirectory, ".emdash/proof.sqlite"), String(role)]);
    await setRole(20);
    try {
      for (const route of ["journey", "label-pdf", "fixture", "admin"]) {
        const result = await call(route, { action: "load", orderId: ORDER.orderId, page: "/journey" });
        assert.equal(result.response.status, 403); denied(result);
      }
    } finally { await setRole(50); }
    console.log("private_dispatch: logged_out401 missing_header403 reduced_role403; unbound_factory_denied");

    const loaded = success(await journey("load", ORDER.orderId, { shopId: "forged-shop", actorId: "forged-actor", order: { paidTotals: { amount: "1" } } }));
    assert.deepEqual(loaded.order, ORDER);
    assert.equal(success(await journey("load", ORDER_IDS.zero)).order.paidTotals.amount, "0");
    const reviewed = success(await journey("review", ORDER.orderId, { packageValues: PACKAGE }));
    assert.equal(reviewed.shipment.parcel.weightOz, 16);
    assert.match(JSON.stringify(reviewed.shipment), /Synthetic Merchant/);
    const { input } = await quoteBuy(ORDER.orderId, "winner");
    denied(await journey("buy", ORDER.orderId, { ...input, confirmation: { ...input.confirmation, confirmed: false } }));
    denied(await journey("buy", ORDER.orderId, { ...input, confirmation: { ...input.confirmation, amount: 0 } }));
    assert.equal(await creates(), 0);
    const buys = await Promise.all([journey("buy", ORDER.orderId, input), journey("buy", ORDER.orderId, { ...input, idempotencyKey: "competitor" })]);
    assert.equal(buys.filter(item => item.response.ok).length, 1);
    const winner = buys[0].response.ok ? input : { ...input, idempotencyKey: "competitor" };
    const label = success(buys.find(item => item.response.ok));
    assert.equal(await creates(), 1);
    assert.deepEqual(success(await journey("buy", ORDER.orderId, winner)), label);
    denied(await journey("buy", ORDER.orderId, { ...winner, idempotencyKey: "new-key" }));
    denied(await journey("buy", ORDER.orderId, { ...winner, packageValues: { ...PACKAGE, weightLb: "2" } }));
    const expectedActor = (await run("python3", ["-c", "import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);print(db.execute(\"SELECT id FROM users WHERE email='dev@emdash.local'\").fetchone()[0])", join(host.hostDirectory, ".emdash/proof.sqlite")])).stdout.trim();
    const operation = (await record(ORDER.orderId)).operation;
    assert.equal(operation.confirmation.actorId, expectedActor);
    assert.equal(operation.confirmation.amount, 8.6);
    assert.ok(Number.isSafeInteger(operation.confirmation.confirmedAt));
    assert.doesNotMatch(JSON.stringify(label), /pdfUrl|ship-journey.invalid/);
    const stale = await quoteBuy(ORDER_IDS.stale, "stale-key");
    success(await journey("review", ORDER_IDS.stale, { packageValues: { ...PACKAGE, weightLb: "2" } }));
    assert.equal(success(await journey("load", ORDER_IDS.stale)).quote, null);
    denied(await journey("buy", ORDER_IDS.stale, stale.input));
    assert.equal(await creates(), 1);
    console.log("paid_order: canonical_colon_UUID immutable_minor_units4800_and0; quote_confirmation; concurrent_create_once; stale_quote_invalidated");

    for (const [orderId, failure, eligible] of [[ORDER_IDS.unknown, "no_response", true], [ORDER_IDS.ineligible, "http_400", false], [ORDER_IDS.opaque, "opaque", false], [ORDER_IDS.malformed, "malformed", false]]) {
      await controls({ create: failure });
      const request = await quoteBuy(orderId, `key-${failure}`);
      denied(await journey("buy", orderId, request.input));
      const before = await creates();
      const stored = (await record(orderId)).operation;
      assert.equal(stored.status, "purchase_unknown");
      assert.equal(success(await journey("load", orderId)).canReconcile, eligible);
      denied(await journey("buy", orderId, { ...request.input, idempotencyKey: "replacement", packageValues: { ...PACKAGE, weightLb: "2" } }));
      if (eligible) {
        const result = await Promise.all([journey("reconcile", orderId), journey("reconcile", orderId)]);
        assert.equal(result.filter(item => item.response.ok).length, 1);
        const reconciles = (await state()).__reconciles;
        assert.equal(reconciles.length, 1);
        assert.deepEqual(reconciles[0], { operationId: stored.id, reason: failure, createdAt: stored.createdAt });
        assert.equal(success(result.find(item => item.response.ok)).operationId, stored.id);
        denied(await journey("reconcile", orderId));
      } else denied(await journey("reconcile", orderId));
      assert.equal(await creates(), before);
    }
    await controls({});
    console.log("unknown_purchase: no_new_create; eligible_original_transaction_reconcile_once; ineligible_errors_fail_closed; normalized_fixture_metadata_only");

    const pdf = await call("label-pdf", { orderId: ORDER.orderId });
    assert.equal(pdf.response.status, 200);
    console.log("raw_pdf_shape", JSON.stringify({ status: pdf.response.status, type: pdf.response.headers.get("content-type"), keys: Object.keys(pdf.data ?? {}), innerKeys: Object.keys(pdf.data?.data ?? {}), bodyKind: pdf.data?.data?.body?.kind, valueType: typeof pdf.data?.data?.body?.value }));
    assert.equal(pdf.response.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.response.headers.get("cache-control"), "private, no-store");
    assert.equal(pdf.response.headers.get("x-content-type-options"), "nosniff");
    assert.match(pdf.response.headers.get("content-disposition"), /attachment/);
    assert.equal(pdf.bytes.length, 700000);
    const expected = Buffer.alloc(700000, 32); createFixturePdf().copy(expected);
    assert.deepEqual(pdf.bytes, expected);
    const chunks = (await sql("SELECT id FROM _plugin_storage WHERE plugin_id=? AND collection=? AND id LIKE ? ORDER BY id", ["dinkuskit-ship", "operations", "ship:pdf:v1:%"])).map(row => row[0]);
    assert.equal(chunks.length, 2);
    for (const key of chunks) { const result = success(await call("fixture", { key })); assert.ok(result.stored); assert.ok(result.bytes < 1024 * 1024); }
    denied(await call("fixture", { action: "oversize" }));
    assert.deepEqual((await call("label-pdf", { orderId: ORDER.orderId })).bytes, pdf.bytes);
    assert.equal((await state()).__pdfFetches, 1);
    denied(await call("label-pdf", { orderId: ORDER.orderId }, { "content-type": "application/json", "X-EmDash-Request": "1" }));
    denied(await call("label-pdf", { orderId: "wrong-order" }));
    const print = success(await journey("print"));
    assert.equal(print.status, "print_requested");
    assert.deepEqual(success(await journey("print")), print);
    assert.equal(success(await journey("load")).deliveryStatus, "not_reported");
    const admin = success(await call("admin", { page: "/journey", type: "page_load", values: { orderId: ORDER.orderId } }));
    assert.match(JSON.stringify(admin), /Synthetic installed proof/);
    assert.match(JSON.stringify(admin), /Label created/);
    assert.match(JSON.stringify(admin), /print_requested/);
    assert.match(JSON.stringify(admin), /authenticated host asset mediator/);
    await stopJourneyHost(host);
    await startJourneyHost(host);
    assert.deepEqual((await call("label-pdf", { orderId: ORDER.orderId })).bytes, pdf.bytes);
    assert.equal((await state()).__pdfFetches, 1);
    assert.equal(success(await journey("label")).shipmentId, label.shipmentId);
    success(await call("fixture", { action: "corrupt", key: chunks[0] }));
    denied(await call("label-pdf", { orderId: ORDER.orderId }));
    success(await call("fixture", { action: "restore", key: chunks[0] }));
    assert.deepEqual((await call("label-pdf", { orderId: ORDER.orderId })).bytes, pdf.bytes);
    success(await call("fixture", { action: "missing", key: chunks[1] }));
    denied(await call("label-pdf", { orderId: ORDER.orderId }));
    await controls({ pdfBytes: 5 * 1024 * 1024 });
    const largeInput = await quoteBuy(ORDER_IDS.large, "large-key");
    success(await journey("buy", ORDER_IDS.large, largeInput.input));
    const largePdf = await call("label-pdf", { orderId: ORDER_IDS.large });
    assert.equal(largePdf.response.status, 200);
    assert.equal(largePdf.bytes.length, 5 * 1024 * 1024);
    assert.deepEqual(largePdf.bytes.subarray(0, createFixturePdf().length), createFixturePdf());
    assert.deepEqual((await call("label-pdf", { orderId: ORDER_IDS.large })).bytes, largePdf.bytes);
    console.log("private_pdf: exact_raw_bytes700000_and5242880; real_EmDash_chunk_limit; restart_cache; corrupt_missing_denied; print_request_only");
    console.log("browser_pdf: mediator_absent; ordinary_view_download_print_skipped; production_Commerce_CAS_Registry_unbound");
  } finally {
    await stopJourneyHost(host);
    await host.cleanup();
  }
});
