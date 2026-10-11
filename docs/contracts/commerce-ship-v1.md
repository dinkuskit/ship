# Minimal Commerce ↔ Ship contract (document, not code)

> **Superseded for the wire format (2026-10-10).** Commerce now pushes each
> order version to the hosted service at `https://ship.dinkuskit.com`
> (GrillTrack `ship-hosted-service-001`, `ship-order-intake-001`; ledger records
> follow in a later PR). The exact
> fields are in [service/README.md](../../service/README.md) and Commerce's
> `docs/contracts/commerce-handoffs.md`. Name mapping: `orderId` is
> `commerce_order_id`, `version` is `order_revision`, and the store pass's
> `site_id` is `shop_id`. The ownership, idempotency and money-separation
> rules below still apply.

Recommended v1 document contract. Ship must not require Inventory. Commerce
remains source of paid money. Pitney Bowes is the selected provider direction
for the next integration boundary, with merchant-managed and merchant-funded
accounts; this document still does not authorize provider connection or
postage purchase. Every new numeric, origin, package, and service limit below
is **proposed, not approved**, except the one-store U.S. origin shape noted
below.

## Ownership

| Concern | Owner |
| --- | --- |
| Order identity, line items, paid totals | Commerce |
| Shopper shipping charge (free or flat-rate) | Commerce |
| Checkout address collection | Commerce (for example Stripe hosted Checkout) |
| Postage quote, purchase, label, tracking ingest | Ship, when installed |
| Manual fulfillment without Ship | Commerce |
| On-hand stock | Inventory, if present; never required |

Current-source caveat (October 8): Commerce canonical paid orders live in
checkout attempt snapshots and have no per-order revision, fulfillment destination,
consent evidence or shop identity. Aggregate CAS is not an order revision.
The fields below describe a future contract, not current authority. The installed
fixture seam is documented [separately](installed-ship-workflow.md).

## Identity, tenant, and idempotency

- `commerce_order_id` (stable)
- `order_revision` (monotonic; Ship records the revision it acted on)
- `shop_id` / merchant tenant
- `ship_operation_id` (Ship-generated purchase attempt identity)
- `idempotency_key` (caller-supplied; required on buy)
- Provider shipment/transaction/label ids once known

A buy is tenant-authorized and merchant-attended. The idempotency key is
scoped to tenant plus order. Same key plus same request fingerprint retries
the same operation. Same key plus a different fingerprint is rejected. A new
buy uses a new `ship_operation_id`. A reprint or status poll reuses the
durable label identity. Unknown provider responses stay `purchase_unknown`
until reconciled by that provider’s retry/retrieve rules. Unknown remains
blocked from a new buy until reconciled. Do not create a second purchase to
resolve unknown.

## Address and consent

Ship accepts a fulfillment destination only after Commerce records shopper
address consent (Checkout collection or an explicit merchant edit).

Minimized recipient data, each field sent for a reason:

- name, address lines, city, region, postal code: the label
- country (`US` for approved v1)
- the shopper's email: Ship sends the shipped email
- the box lines (item name, quantity, weight, price paid per unit): package
  weight, packing slips and declared value

Never send payment instruments, billing address, order totals, tax, phone
or the full customer profile. The rule follows Shopify's: only the minimum
personal data required.

## Package, origin, service

Exact units are **contract proposals**, not approved product locks. Do not
impose integer ounces; lightweight parcels need decimal precision.

Proposed fields:

- weight: decimal value plus `weight_unit` (`oz` or `lb`)
- dimensions: length, width, height plus `dimension_unit` (`in`)
- paid money: unsigned decimal MINOR-UNIT STRING from canonical `order.total.minor`,
  plus ISO `currency`; zero-total completed orders need no processor paymentId
- postage money: provider decimal dollars plus ISO `currency`; postage and fees
  never rewrite paid Commerce totals
- `packaging_type` (proposed first kernel: rectangular parcel)
- origin: street, city, region, postal, country; merchant ship-from identity
- `carrier` (`usps` for approved v1)
- `service` (token plus human label)
- `quote_id`, `quote_amount`, `quote_currency`, `quote_expires_at`

The settings slice admits exactly one merchant-managed U.S. ship-from origin
per store, with bounded name/company, address lines, city, two-letter state
code, ZIP, and explicit `US` country. Structural saving is not provider
verification. Per attended purchase, exactly one origin and one rectangular
parcel remain proposed, not approved. **Proposed service allowlist, not approved:** USPS Ground
Advantage and Priority Mail only.

## Funding and confirmation

- `funding_identity` (opaque: merchant postage account, platform wallet, or
  merchant-owned and merchant-funded; subsidy amounts unapproved)
- `merchant_confirmation` required: tenant-authorized Buy label click, actor,
  timestamp
- Quote shown to the merchant immediately before confirmation; expired quotes
  cannot be purchased

Automatic purchase on packed/ready is out of v1.

## Money

Commerce sends Ship only the price paid per unit on each line (v1). The
order-level fields below stay in Commerce and are not sent.

Commerce fields, immutable after payment:

- `amount_subtotal`
- `shopper_shipping_amount`
- `amount_tax` (if any)
- `amount_total`
- `currency`

Ship fields, never written back onto paid totals:

- `quoted_postage_amount`
- `purchased_postage_amount`
- `provider_fee_amount` (if itemized)
- `refund_amount`
- `adjustment_amount` (APV or carrier)

Shopper shipping charge and postage are distinct. Decimal money units above
are proposals.

## Outcomes

Durable purchase outcomes: `not_started`, `quoted`, `purchase_pending`,
`purchase_unknown`, `label_created`, `purchase_failed`, `void_requested`,
`voided`, `refund_pending`, `refunded`, `refund_denied`.

Separate print attempts: `print_not_started`, `print_offered`,
`print_requested`, `print_confirmed` (only if a client reports physical
print), `print_failed`. A purchased label is not proof of print. Opening a
browser print dialog cannot claim successful physical print.

Carrier fulfillment, separate from print: `label_created`, `dispatched`,
`delivered`, plus provider tracking detail. Do not collapse these.

## Recommended v1 limits (official USPS)

Approved scope: U.S. domestic USPS only.

Proposed first-kernel limits (not selected; using official USPS numbers as
inputs):

- destination country `US`
- one proposed U.S. ship-from origin
- one rectangular parcel
- proposed services: Ground Advantage, Priority Mail
- weight ≤ 70 lb (decimal weight allowed)
- Ground Advantage: length+girth ≤ 130 in
- Priority Mail: length+girth ≤ 108 in unless a later lock expands it
- label format default `PDF` 4×6; PNG optional; ZPL later
- browser PDF print offered; dialog ≠ physical print

**Also proposed, not selected:** exclude territories, APO/FPO/DPO, customs
forms, and HAZMAT. Those would narrow approved domestic-first scope and need
an explicit later lock.

## Credentials (design only)

Public non-secret record: tenant, environment, account identifiers, and
label/tracking/refund ids. Server secret binding and token lifecycle stay on
the server. This contract does not claim OAuth or similar works without
storing or accessing server secrets. No `.env` or credential is created here.

## Out of contract

Inventory events, automatic purchase, unattended print, international, UPS,
FedEx, provider selection, live Stripe changes, and runtime proof.
