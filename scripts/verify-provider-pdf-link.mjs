#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createProviderPdfLink,
  PROVIDER_PDF_TTL_MS,
} from "../src/provider-pdf-link.js";

// Pure helper qualification only. The installed EmDash/workerd qualification
// is separate: npm run verify:provider-pdf-link:runtime.
const createdAt = 1_760_000_000_000;
const storedOperation = {
  shopId: "fixture-shop",
  orderId: "order:fixture",
  status: "label_created",
  operationId: "fixture-operation",
  createdAt,
  pdfUrl: "https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/fixture.pdf",
};

const authorized = operation =>
  operation.shopId === "fixture-shop" && operation.orderId === "order:fixture"
    ? operation
    : null;

const operation = authorized(storedOperation);
const link = createProviderPdfLink({ operation, now: createdAt + 1 });
assert.deepEqual(link, {
  type: "link",
  label: "View label",
  target: { kind: "external", url: storedOperation.pdfUrl },
});
assert.equal(
  createProviderPdfLink({ operation, now: createdAt + PROVIDER_PDF_TTL_MS }),
  null,
);
assert.equal(
  createProviderPdfLink({
    operation: { ...storedOperation, pdfUrl: "https://example.test/forged.pdf" },
    now: createdAt + 1,
  }),
  null,
);

const result = {
  qualification: "pure-helper-fixture",
  blockKitLink: "external",
  authorization: "host-owned fixture gate",
  providerUrl: "PB sandbox label allowlist only",
  expiry: "creation + 24h absolute",
  clickBehavior: "link construction only; no fetch, renewal, purchase, recovery, print or dispatch mutation",
  signedRegistryInstall: "not executed",
  ordinaryLocalSignin: "not executed",
  liveProviderEvidence: "not executed",
  runtimeQualification: "see npm run verify:provider-pdf-link:runtime",
  privacyAndRedirectAccess: "unqualified",
};
console.log(JSON.stringify(result, null, 2));
