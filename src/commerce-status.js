// Read-only, source-bound projection for a future Commerce host mount.
// This module intentionally has no Commerce dependency and no mutation path.
export function projectCommerceShippingStatus(state) {
  return Object.freeze({
    surface: "ship-pb-sandbox-interface",
    mode: "synthetic-usps-pm-only",
    live: false,
    contract: Object.freeze({
      order: Object.freeze({
        destination: "read-only destination projection",
        package: "read-only package projection",
      }),
      statuses: Object.freeze(["pending", "unknown", "label_created"]),
      testPdf: "local test-label PDF reference only",
    }),
    operations: Object.freeze(Object.fromEntries(Object.entries(state?.operations || {}).map(([key, operation]) => [
      key,
      Object.freeze({ status: operation.status, fingerprint: operation.fingerprint }),
    ]))),
  });
}
