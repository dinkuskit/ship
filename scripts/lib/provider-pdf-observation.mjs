import { createHash } from "node:crypto";
import { PROVIDER_PDF_TTL_MS } from "../../src/provider-pdf-link.js";

const contexts = new Set([
  "authenticated-registry-ui",
  "repeated-download",
  "signed-out-copy",
  "isolated-unauthenticated",
]);
const MAX_PDF_BYTES = 5 * 1024 * 1024;

// Called by a sanctioned test consumer after retrieval. This module neither
// fetches nor stores a URL, response body, cookie, or credential. A successful
// observation is evidence about that response, not proof of browser rendering.
export function summarizeProviderPdfObservation({
  context, createdAt, observedAt, status, contentType, bytes,
  referenceSha256, redirectObserved = false,
}) {
  if (!contexts.has(context)) throw new Error("Unsupported observation context");
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 ||
      !Number.isSafeInteger(observedAt) || observedAt < createdAt ||
      !Number.isSafeInteger(createdAt + PROVIDER_PDF_TTL_MS)) {
    throw new Error("Invalid original creation or observation time");
  }
  if (!Number.isInteger(status) || status < 100 || status > 599 ||
      typeof redirectObserved !== "boolean") throw new Error("Invalid response metadata");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("Invalid or oversized response body");
  }
  if (referenceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(referenceSha256)) {
    throw new Error("Invalid reference digest");
  }
  const pdfMime = typeof contentType === "string" &&
    /^application\/pdf(?:\s*;|$)/i.test(contentType.trim());
  const pdfSignature = bytes.byteLength >= 5 &&
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  const isPdf = status === 200 && pdfMime && pdfSignature && !redirectObserved;
  // Do not hash error pages: they may echo request URLs or credentials.
  const sha256 = isPdf ? createHash("sha256").update(bytes).digest("hex") : null;
  const expiresAt = createdAt + PROVIDER_PDF_TTL_MS;
  return {
    scope: "response-summary-only",
    context,
    createdAt,
    observedAt,
    originalExpiresAt: expiresAt,
    atOrAfterOriginalDeadline: observedAt >= expiresAt,
    status,
    responseKind: redirectObserved || (status >= 300 && status < 400) ? "redirect"
      : isPdf ? "pdf" : [401, 403, 404, 410].includes(status) ? "unavailable" : "unqualified",
    redirectObserved,
    pdfBytes: isPdf ? bytes.byteLength : null,
    sha256,
    matchesOriginalBytes: referenceSha256 === undefined || !isPdf ? null : sha256 === referenceSha256,
    expiryEvidence: observedAt < expiresAt ? "deadline-not-observed"
      : isPdf ? "accessible-after-deadline" : "post-deadline-response-observed",
  };
}
