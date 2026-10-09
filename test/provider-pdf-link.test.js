import test from "node:test";
import assert from "node:assert/strict";
import {
  createProviderPdfLink,
  createProviderPdfLinks,
  PROVIDER_PDF_TTL_MS,
} from "../src/provider-pdf-link.js";

const pdfUrl = "https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/abc.pdf";
const operation = {
  status: "label_created",
  operationId: "operation1",
  pdfUrl,
  createdAt: 1_000,
};

test("creates a Block Kit external link from an authorized stored operation", () => {
  const link = createProviderPdfLink({ operation, now: operation.createdAt + 1 });
  assert.deepEqual(link, {
    type: "link",
    label: "View label",
    target: { kind: "external", url: pdfUrl },
  });
  assert.deepEqual(createProviderPdfLinks({ operation, now: operation.createdAt + 1 }), { view: link });
});

test("uses creation plus 24 hours as an absolute expiry without renewal", () => {
  const justBeforeExpiry = createProviderPdfLink({
    operation,
    now: operation.createdAt + PROVIDER_PDF_TTL_MS - 1,
  });
  assert.ok(justBeforeExpiry);
  assert.equal(createProviderPdfLink({
    operation,
    now: operation.createdAt + PROVIDER_PDF_TTL_MS,
  }), null);
  assert.equal(createProviderPdfLink({
    operation: { ...operation, createdAt: operation.createdAt },
    now: operation.createdAt + PROVIDER_PDF_TTL_MS,
  }), null);
});

test("fails closed for forged URLs, missing trusted metadata, and non-label operations", () => {
  for (const candidate of [
    { ...operation, pdfUrl: "https://example.test/label.pdf" },
    { ...operation, pdfUrl: `${pdfUrl}?token=secret` },
    { ...operation, createdAt: undefined },
    { ...operation, status: "purchase_pending" },
    { ...operation, operationId: "bad/id" },
  ]) {
    assert.equal(createProviderPdfLink({ operation: candidate, now: 1_001 }), null);
  }
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 999]) {
    assert.equal(createProviderPdfLink({ operation, now }), null);
  }
  for (const createdAt of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 2_000]) {
    assert.equal(createProviderPdfLink({ operation: { ...operation, createdAt }, now: 1_001 }), null);
  }
});

test("link construction is passive and never calls fetch or mutates the operation", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("link reads must not fetch"); });
  const before = structuredClone(operation);
  const link = createProviderPdfLink({ operation, now: 1_001 });
  assert.equal(typeof globalThis.fetch, "function");
  assert.deepEqual(operation, before);
  assert.equal(link.target.url, pdfUrl);
});
