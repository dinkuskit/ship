import test from "node:test";
import assert from "node:assert/strict";
import { createShipWorkflow, ShipWorkflowError } from "../src/shipping-workflow.js";

const auth = { shopId: "shop-a", actorId: "actor-a", canManage: true };
const order = {
  shopId: "shop-a", orderId: "order-1", revision: 3, paymentStatus: "paid",
  paidTotals: { amount: "4250", currency: "USD" }, addressConsent: true,
  destination: {
    name: "Ada Shopper", addressLine1: "1 Main Street", city: "Austin",
    state: "TX", postalCode: "78701", country: "US",
  },
};
const origin = {
  name: "Merchant", addressLine1: "200 Example Road", city: "Shelton",
  state: "CT", postalCode: "06484", country: "US",
};
const packageValues = { weightLb: "0.25", lengthIn: 8, widthIn: 6, heightIn: 1 };
const pdfUrl = "https://labels.example.test/usps/1/outbound/label/one.pdf";

function fixture({ current = new Map(), orderValue = order, provider = {} } = {}) {
  let revision = 0;
  const calls = { create: 0, retrieve: 0, reconcile: 0 };
  const store = {
    async getOrigin() { return structuredClone(origin); },
    async getVersioned(key) {
      const item = current.get(key);
      return item ? { value: structuredClone(item.value), revision: item.revision } : null;
    },
    async compareAndSet(key, expected, value) {
      const item = current.get(key);
      if ((item?.revision ?? null) !== expected) return { applied: false };
      const next = { value: structuredClone(value), revision: ++revision };
      current.set(key, next);
      return { applied: true, revision: next.revision };
    },
  };
  const orderPort = { async getPaidOrder() { return structuredClone(orderValue); } };
  const providerPort = {
    async quote() { return { service: "PM", serviceLabel: "USPS Priority Mail", currency: "USD", amount: 8.6 }; },
    async createLabel() {
      calls.create++;
      return { shipmentId: "shipment-1", pdfUrl, price: 8.6 };
    },
    async fetchLabelPdf() { calls.retrieve++; return new TextEncoder().encode("%PDF-1.4 fixture"); },
    ...provider,
  };
  return { store, orderPort, providerPort, calls, current };
}

function workflow(options = {}) {
  const fixtureValue = fixture(options);
  const instance = createShipWorkflow({ ...fixtureValue, clock: () => 1000, idFactory: (() => {
    let n = 0;
    return () => `operation-${++n}`;
  })() });
  return { ...fixtureValue, instance };
}

async function reviewedBuy(instance, key = "buy-1") {
  await instance.review(auth, { orderId: "order-1", packageValues });
  const quote = await instance.quote(auth, { orderId: "order-1", packageValues });
  return { quote, result: await instance.buy(auth, {
    orderId: "order-1", packageValues, quoteId: quote.quoteId,
    confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" },
    idempotencyKey: key,
  }) };
}

test("requires trusted paid order, consent, and durable CAS dependencies", async () => {
  const { instance } = workflow({ orderValue: { ...order, paymentStatus: "pending" } });
  await assert.rejects(instance.review(auth, { orderId: "order-1", packageValues }),
    (error) => error instanceof ShipWorkflowError && error.code === "unpaid");
  await assert.rejects(instance.review({ ...auth, canManage: false }, { orderId: "order-1", packageValues }),
    (error) => error.code === "auth_invalid");
  assert.throws(() => createShipWorkflow({ orderPort: {}, providerPort: {}, store: {} }),
    (error) => error.code === "unavailable");
});

test("review and quote snapshot immutable paid totals and reject changed shipment", async () => {
  const { instance, orderPort } = workflow();
  const reviewed = await instance.review(auth, { orderId: "order-1", packageValues });
  reviewed.order.paidTotals.amount = "0";
  const quote = await instance.quote(auth, { orderId: "order-1", packageValues });
  assert.equal(quote.amount, 8.6);
  orderPort.getPaidOrder = async () => ({ ...order, revision: 4 });
  await assert.rejects(instance.buy(auth, {
    orderId: "order-1", packageValues, quoteId: quote.quoteId,
    confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" },
    idempotencyKey: "changed",
  }), (error) => error.code === "conflict");
});

test("same key replays and concurrent different keys dispatch only once", async () => {
  const value = workflow();
  const { instance, calls } = value;
  await instance.review(auth, { orderId: "order-1", packageValues });
  const quote = await instance.quote(auth, { orderId: "order-1", packageValues });
  const input = {
    orderId: "order-1", packageValues, quoteId: quote.quoteId,
    confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" },
    idempotencyKey: "same-key",
  };
  const first = await instance.buy(auth, input);
  assert.deepEqual(await instance.buy(auth, input), first);
  assert.equal(calls.create, 1);
  await assert.rejects(instance.buy(auth, { ...input, idempotencyKey: "other-key" }),
    (error) => error.code === "conflict");
});

test("unknown, malformed, and no-reason provider failures remain blocked", async () => {
  for (const thrown of [
    Object.assign(new Error(), { status: 400 }),
    Object.assign(new Error(), { recoveryReason: "no_response" }),
  ]) {
    const value = workflow();
    const { instance, calls } = value;
    value.providerPort.createLabel = async () => {
      calls.create++;
      throw thrown;
    };
    await instance.review(auth, { orderId: "order-1", packageValues });
    const quote = await instance.quote(auth, { orderId: "order-1", packageValues });
    const input = {
      orderId: "order-1", packageValues, quoteId: quote.quoteId,
      confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" },
      idempotencyKey: "first",
    };
    await assert.rejects(instance.buy(auth, input), (error) => error.code === "purchase_unknown");
    await assert.rejects(instance.buy(auth, { ...input, idempotencyKey: "second" }), (error) => error.code === "conflict");
    assert.equal(calls.create, 1);
  }
});

test("durable PDF, repeated print, and separate print state do not create or retrieve labels", async () => {
  const value = workflow();
  const { instance, calls, store, orderPort, providerPort } = value;
  const bought = await reviewedBuy(instance);
  assert.equal(bought.result.status, "label_created");
  const bytes = await instance.pdf(auth, { orderId: "order-1" });
  assert.equal(new TextDecoder().decode(bytes), "%PDF-1.4 fixture");
  providerPort.fetchLabelPdf = async () => { throw new Error("must not retrieve"); };
  assert.equal((await instance.pdf(auth, { orderId: "order-1" }))[0], 37);
  assert.equal((await instance.print(auth, { orderId: "order-1" })).status, "print_requested");
  assert.equal((await instance.print(auth, { orderId: "order-1" })).status, "print_requested");
  assert.equal(calls.create, 1);
  assert.equal(calls.retrieve, 1);
  assert.equal(orderPort !== undefined && store !== undefined, true);
});

test("successful reconciliation consumes eligible reason and price mismatch stays unknown", async () => {
  let reconciles = 0;
  const value = workflow({
    provider: {
      createLabel: async () => { throw Object.assign(new Error(), { recoveryReason: "http_500" }); },
      reconcileLabel: async () => {
        reconciles++;
        return { shipmentId: "recovered", pdfUrl, price: 8.6 };
      },
    },
  });
  const { instance } = value;
  await instance.review(auth, { orderId: "order-1", packageValues });
  const quote = await instance.quote(auth, { orderId: "order-1", packageValues });
  const input = {
    orderId: "order-1", packageValues, quoteId: quote.quoteId,
    confirmation: { confirmed: true, service: "PM", amount: 8.6, currency: "USD" }, idempotencyKey: "recover",
  };
  await assert.rejects(instance.buy(auth, input), (error) => error.code === "purchase_unknown");
  assert.equal((await instance.reconcile(auth, { orderId: "order-1" })).status, "label_created");
  await assert.rejects(instance.reconcile(auth, { orderId: "order-1" }), (error) => error.code === "conflict");
  assert.equal(reconciles, 1);
});

test('paid totals preserve exact minor-unit strings and reject dollar coercion', async () => {
  for (const amount of ['0', '4250', '999999999999999999999999999999']) {
    const { instance } = workflow({ orderValue: { ...order, paidTotals: { amount, currency: 'USD' } } });
    assert.equal((await instance.loadOrder(auth, { orderId: 'order-1' })).paidTotals.amount, amount);
  }
  for (const amount of [42.5, 0, '42.50', '-1', '1e3', '', '01']) {
    const { instance } = workflow({ orderValue: { ...order, paidTotals: { amount, currency: 'USD' } } });
    await assert.rejects(instance.loadOrder(auth, { orderId: 'order-1' }), e => e.code === 'validation');
  }
});

test('real racing buy claims permit exactly one dispatch, including different keys', async () => {
  const { instance, calls } = workflow();
  const quote = await instance.quote(auth, { orderId: 'order-1', packageValues });
  const request = { orderId: 'order-1', packageValues, quoteId: quote.quoteId, confirmation: { confirmed: true, service: 'PM', currency: 'USD', amount: 8.6 } };
  const results = await Promise.allSettled(['race-a', 'race-b'].map(idempotencyKey => instance.buy(auth, { ...request, idempotencyKey })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls.create, 1);
});

test('lost pending CAS acknowledgement never dispatches and restart remains blocked', async () => {
  const f = workflow();
  const quote = await f.instance.quote(auth, { orderId: 'order-1', packageValues });
  const original = f.store.compareAndSet;
  f.store.compareAndSet = async (...args) => { await original(...args); throw new Error('lost acknowledgement'); };
  const request = { orderId: 'order-1', packageValues, quoteId: quote.quoteId, idempotencyKey: 'lost', confirmation: { confirmed: true, service: 'PM', currency: 'USD', amount: 8.6 } };
  await assert.rejects(f.instance.buy(auth, request), e => e.code === 'unavailable');
  assert.equal(f.calls.create, 0);
  f.store.compareAndSet = original;
  const restarted = createShipWorkflow(f);
  await assert.rejects(restarted.buy(auth, { ...request, idempotencyKey: 'new' }), e => e.code === 'conflict');
});

test('missing consent, mismatched tenant, and malformed address fail before provider calls', async () => {
  for (const orderValue of [{ ...order, addressConsent: false }, { ...order, shopId: 'other' }, { ...order, destination: { ...order.destination, city: 'unsafe\u0000city' } }]) {
    const f = workflow({ orderValue });
    await assert.rejects(f.instance.quote(auth, { orderId: 'order-1', packageValues }), e => e.code === 'validation');
    assert.equal(f.calls.create, 0);
  }
});

test('invalid labels/prices persist unknown without recovery eligibility', async () => {
  for (const response of [{ shipmentId: 'one', pdfUrl, price: 'garbage' }, { shipmentId: 'one', pdfUrl, price: 9 }, {}]) {
    const f = workflow({ provider: { createLabel: async () => response } });
    await assert.rejects(reviewedBuy(f.instance), e => e.code === 'purchase_unknown');
    const state = await f.instance.inspect(auth, { orderId: 'order-1' });
    assert.equal(state.labelStatus, 'purchase_unknown');
    await assert.rejects(f.instance.reconcile(auth, { orderId: 'order-1' }), e => e.code === 'conflict');
  }
});

test('expired quote denies dispatch but completed replay survives expiry', async () => {
  const f = fixture(); let now = 1000;
  const instance = createShipWorkflow({ ...f, clock: () => now, idFactory: () => 'quote-key' });
  const quote = await instance.quote(auth, { orderId: 'order-1', packageValues });
  const request = { orderId: 'order-1', packageValues, quoteId: quote.quoteId, idempotencyKey: 'key', confirmation: { confirmed: true, service: 'PM', currency: 'USD', amount: 8.6 } };
  now = quote.expiresAt;
  await assert.rejects(instance.buy(auth, request), e => e.code === 'quote_expired');
  now = 1000;
  const result = await instance.buy(auth, request);
  now = quote.expiresAt;
  assert.deepEqual(await instance.buy(auth, request), result);
  assert.equal(f.calls.create, 1);
});

test('durable PDF survives workflow recreation; invalid PDF never clears label', async () => {
  const f = workflow(); await reviewedBuy(f.instance);
  f.providerPort.fetchLabelPdf = async () => new TextEncoder().encode('not a pdf');
  await assert.rejects(f.instance.pdf(auth, { orderId: 'order-1' }), e => e.code === 'pdf_invalid');
  assert.equal((await f.instance.inspect(auth, { orderId: 'order-1' })).labelStatus, 'label_created');
  f.providerPort.fetchLabelPdf = async () => new TextEncoder().encode('%PDF-1.4 fixture');
  await f.instance.pdf(auth, { orderId: 'order-1' });
  f.providerPort.fetchLabelPdf = async () => { throw Error('expired URL'); };
  const restarted = createShipWorkflow(f);
  assert.equal(new TextDecoder().decode(await restarted.pdf(auth, { orderId: 'order-1' })), '%PDF-1.4 fixture');
  assert.equal(f.calls.create, 1);
});

test('reviewing changed package invalidates the prior quote before purchase', async () => {
  const f = workflow();
  const quote = await f.instance.quote(auth, { orderId: 'order-1', packageValues });
  const changed = { ...packageValues, weightLb: '1' };
  await f.instance.review(auth, { orderId: 'order-1', packageValues: changed });
  await assert.rejects(f.instance.buy(auth, { orderId: 'order-1', packageValues: changed, quoteId: quote.quoteId, idempotencyKey: 'stale', confirmation: { confirmed: true, service: 'PM', currency: 'USD', amount: 8.6 } }), e => e.code === 'conflict');
  assert.equal(f.calls.create, 0);
  assert.equal((await f.instance.inspect(auth, { orderId: 'order-1' })).quote, null);
});

test('maximum PDF persists below each actual1MiB CAS JSON cap and verifies chunk digest on reload', async () => {
  const f = workflow();
  const cas = f.store.compareAndSet;
  f.store.compareAndSet = async (key, revision, value) => {
    assert.ok(new TextEncoder().encode(JSON.stringify(value)).length <= 1024 * 1024);
    return cas(key, revision, value);
  };
  await reviewedBuy(f.instance);
  const bytes = new Uint8Array(5 * 1024 * 1024); bytes.set(new TextEncoder().encode('%PDF-1.4'));
  f.providerPort.fetchLabelPdf = async () => bytes;
  assert.equal((await f.instance.pdf(auth, { orderId: 'order-1' })).length, bytes.length);
  f.providerPort.fetchLabelPdf = async () => { throw Error('no refetch'); };
  const restarted = createShipWorkflow(f);
  assert.deepEqual(await restarted.pdf(auth, { orderId: 'order-1' }), bytes);
  const key = [...f.current.keys()].find(key => key.startsWith('ship:pdf:'));
  f.current.get(key).value.base64 = f.current.get(key).value.base64.replace('A', 'B');
  await assert.rejects(restarted.pdf(auth, { orderId: 'order-1' }), e => e.code === 'pdf_invalid');
  assert.equal(f.calls.create, 1);
});

test('canonical Commerce order:UUID identity survives quote/buy/reload/PDF without rewriting', async () => {
  const orderId = 'order:123e4567-e89b-42d3-a456-426614174000';
  const f = workflow({ orderValue: { ...order, orderId } });
  let observed;
  f.orderPort.getPaidOrder = async request => { observed = request.orderId; return { ...order, orderId }; };
  assert.equal((await f.instance.loadOrder(auth, { orderId })).orderId, orderId);
  assert.equal(observed, orderId);
  const quote = await f.instance.quote(auth, { orderId, packageValues });
  await f.instance.buy(auth, { orderId, packageValues, quoteId: quote.quoteId, idempotencyKey: 'canonical', confirmation: { confirmed: true, service: 'PM', amount: 8.6, currency: 'USD' } });
  const restarted = createShipWorkflow(f);
  assert.equal((await restarted.inspect(auth, { orderId })).order.orderId, orderId);
  assert.equal((await restarted.label(auth, { orderId })).shipmentId, 'shipment-1');
  assert.equal((await restarted.pdf(auth, { orderId }))[0], 37);
  assert.equal((await restarted.print(auth, { orderId })).status, 'print_requested');
  assert.equal(f.calls.create, 1);
  for (const invalid of ['order:', 'order:attempt:extra', 'other:attempt', 'order:../x', 'order:unsafe\u0000', 'order:' + 'a'.repeat(95)]) {
    await assert.rejects(restarted.loadOrder(auth, { orderId: invalid }), e => e.code === 'validation');
  }
  await assert.rejects(restarted.loadOrder({ ...auth, actorId: 'actor:forged' }, { orderId }), e => e.code === 'auth_invalid');
});
