# Pitney Bowes USPS sandbox feasibility

Observed September 30, 2026 (America/New_York), through the authenticated
Pitney Bowes Sandbox Developer Hub **Try API** interface.

## Observed results

| Operation | Result |
| --- | --- |
| Sandbox registration and sign-in | Authenticated Developer Hub reached |
| Rate sample USPS Priority Mail shipment | HTTP **200 OK** |
| Rate response | `carrier: usps`, `serviceId: PM`, `parcelType: PKG`, 1 oz, zone 3; `baseCharge` and `totalCarrierCharge`: **8.60** |
| Create sample USPS Priority Mail shipment | HTTP **201 Created** |
| Shipment charge | **USD 8.60**, matching the sample rate |
| Label document response | `SHIPPING_LABEL`, `PDF`, `DOC_8X11`, URL content |
| Open generated PDF | One page rendered in Chrome; USPS Priority Mail layout, sample addresses and barcode visible |
| Sandbox safety markings | **VOID** and **TEST LABEL - DO NOT MAIL** visible |

Requests used the vendor-provided sample shipment data and sandbox merchant.
No live postage purchase, production shipment, funding, or production signup
was performed. API credentials were neither read nor exported; the hosted
console handled authentication.

The PDF's visible rendering and document metadata support a viewable,
printable test-label artifact. Physical printing was **not performed**. A
print-button attempt did not produce an observable print preview, so neither
print-dialog success nor printer output is claimed.

## Local fixture proof boundary

The parent CUA run against the local fixture UI was unconfigured: the quote
step was refused because live credentials were unavailable. No live proof is
claimed. A separate fixture happy-path run reached the synthetic `$8.60`
quote, explicit review checkbox, and `Create test label`, but Chrome exposed
the fixture server's invalid placeholder PDF (`%PDF` header with no catalog,
pages, or valid xref). That fixture defect is repaired by runtime generation
of a one-page catalog/pages/font PDF containing the synthetic proof markings.
The parent must still observe the repaired PDF in Chrome; this record does not
claim that visual verification.

## Scope and evidence limits

This proves that the registered sandbox account can retrieve a USPS Priority
Mail rate and generate a viewable test-label PDF through the vendor's hosted
test console. It does not prove independent application OAuth integration,
production merchant onboarding, production pricing or terms, funding,
refunds, tracking, physical printing, or a provider selection.

This public record transcribes the observed UI responses and visual check.
The original screenshot remains private because it contains sandbox account
identifiers. Account contact details, merchant identifiers, tracking and
shipment identifiers, generated label URLs, and credentials are intentionally
excluded from this repository.

## Official references

- [Sandbox signup](https://developerhub-sandbox.shippingapi.pitneybowes.com/signup/shipping)
- [Getting started](https://docs.shippingapi.pitneybowes.com/getting-started.html):
  default test merchant and Priority Mail test-label workflow; separate
  production registration and approval requirements.

This is bounded vendor research. Ship's open product questions in
[the charter](../../docs/CHARTER.md) remain unselected.
