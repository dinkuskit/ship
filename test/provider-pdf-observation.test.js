import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { summarizeProviderPdfObservation } from "../scripts/lib/provider-pdf-observation.mjs";
import { PROVIDER_PDF_TTL_MS } from "../src/provider-pdf-link.js";

const bytes = Buffer.from("%PDF-1.7\nsynthetic test bytes\n%%EOF");
const original = createHash("sha256").update(bytes).digest("hex");
const input = {
  context: "authenticated-registry-ui", createdAt: 1_000, observedAt: 1_001,
  status: 200, contentType: "application/pdf", bytes, referenceSha256: original,
};

test("sanitized PDF observation compares exact bytes without retaining the body", () => {
  const result = summarizeProviderPdfObservation(input);
  assert.equal(result.responseKind, "pdf");
  assert.equal(result.sha256, original);
  assert.equal(result.matchesOriginalBytes, true);
  assert.equal(result.pdfBytes, bytes.length);
  assert.equal(result.expiryEvidence, "deadline-not-observed");
  assert.equal(JSON.stringify(result).includes("synthetic test bytes"), false);
  assert.equal(summarizeProviderPdfObservation({ ...input, bytes: Buffer.from("%PDF-changed") }).matchesOriginalBytes, false);
});

test("copied-link contexts preserve observed access after the original deadline", () => {
  for (const context of ["signed-out-copy", "isolated-unauthenticated", "repeated-download"]) {
    const result = summarizeProviderPdfObservation({ ...input, context, observedAt: 1_000 + PROVIDER_PDF_TTL_MS });
    assert.equal(result.originalExpiresAt, 1_000 + PROVIDER_PDF_TTL_MS);
    assert.equal(result.atOrAfterOriginalDeadline, true);
    assert.equal(result.expiryEvidence, "accessible-after-deadline");
  }
});

test("denied, redirected, and malformed responses cannot qualify as PDF evidence", () => {
  for (const response of [
    { status: 403, bytes: Buffer.from("private error text") },
    { status: 302 }, { redirectObserved: true },
    { contentType: "text/html" }, { bytes: Buffer.from("not PDF") },
  ]) {
    const result = summarizeProviderPdfObservation({ ...input, ...response });
    assert.notEqual(result.responseKind, "pdf");
    assert.equal(result.sha256, null);
    assert.equal(result.pdfBytes, null);
    assert.equal(result.matchesOriginalBytes, null);
    assert.equal(JSON.stringify(result).includes("private error text"), false);
  }
});

test("refuses invalid time, context, digest and oversized input", () => {
  for (const invalid of [
    { observedAt: 999 }, { createdAt: Number.MAX_SAFE_INTEGER },
    { context: "unclassified" }, { status: 0 }, { redirectObserved: "yes" },
    { referenceSha256: "invalid" }, { bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
  ]) assert.throws(() => summarizeProviderPdfObservation({ ...input, ...invalid }));
});
