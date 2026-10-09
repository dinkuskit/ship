export const PROVIDER_PDF_TTL_MS = 24 * 60 * 60 * 1000;
const LABEL_HOST = "stg-labels-cls.gcs.pitneybowes.com";

const validOperationId = value =>
  typeof value === "string" && /^[A-Za-z0-9._-]{1,25}$/.test(value);

// Deliberately duplicated as a sandbox-pure policy: this helper is bundled into
// host/workerd closures and must not import Node-dependent provider code.
function isSafePdfUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === LABEL_HOST && url.port === "" &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/usps\/[^/]+\/outbound\/label\/[^/]+\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Build a passive Block Kit external link from a trusted, already-created
 * operation. This never fetches the provider URL and never renews its life.
 *
 * The operation must come from the host-owned authorized workflow/storage
 * boundary. Browser input is only used as an opaque operation selector by
 * that boundary; it is never accepted as the provider URL or expiry.
 */
export function createProviderPdfLink({
  operation,
  now = Date.now(),
  label = "View label",
} = {}) {
  if (!operation || operation.status !== "label_created" ||
      !validOperationId(operation.operationId) ||
      !isSafePdfUrl(operation.pdfUrl) ||
      !Number.isSafeInteger(operation.createdAt) || operation.createdAt < 0 ||
      !Number.isSafeInteger(now) || now < operation.createdAt) {
    return null;
  }
  const expiresAt = operation.createdAt + PROVIDER_PDF_TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || now >= expiresAt) return null;
  return {
    type: "link",
    label,
    target: { kind: "external", url: operation.pdfUrl },
  };
}

export function createProviderPdfLinks(options = {}) {
  const view = createProviderPdfLink(options);
  return view ? { view } : null;
}
