# DinkusKit Ship charter

Recorded 2026-09-30. Supersedes the 2026-09-25 parking-lot wording in this file.
Current intention, not law. Product locks below are recorded in the GrillTrack
ledger at [`.grilltrack/ledger.json`](../.grilltrack/ledger.json) and its
append-only [`.grilltrack/events.jsonl`](../.grilltrack/events.jsonl). A
recommendation is not a vendor, account, or funding selection.

## Confirmed product locks

These choices were confirmed before this documentation cycle. They are not
reopened here.

- Commerce includes merchant-configured free or flat-rate checkout shipping
  charges and manual fulfillment and tracking.
- Optional Registry-enabled DinkusKit Ship owns automation.
- Usable U.S. domestic USPS label purchase and printing inside DinkusKit is
  required for coordinated Commerce v1 launch, even though Ship installation
  is optional.
- International labels are unavailable in this slice. UPS, FedEx, and broader
  integrations are later work.
- The merchant reviews shipping address, package weight and dimensions,
  service, and price, then explicitly clicks Buy label and prints.
- Automatic purchase on packed or ready events is later work. Automatic
  physical printing is distinct and is not a new unattended v1 gate.
- Pitney Bowes is the selected provider direction for the next integration
  boundary. Accounts remain merchant-managed and merchant-funded; merchant
  payment of extra provider fees is preferred, while subsidy amounts are not
  approved.
- Ship cannot depend on Inventory.
- Commerce owns canonical order and monetary totals. The shopper shipping
  charge and actual postage are distinct. Paid totals are immutable.
- `label_created`, `dispatched`, and `delivered` are separate states.
- This cycle authorizes only neutral charter, research, and contract
  documents. No label kernel or fake APIs. The package remains private `0.0.0`.

See [research](research/usps-feasibility-20260930.md), the
[Commerce–Ship contract](contracts/commerce-ship-v1.md), and the
[vendor, account, and funding brief](decisions/vendor-account-funding-brief.md).

## Locked negatives

- This repository does not own on-hand, reserved, or location stock. That is
  Inventory.
- This repository does not own payment capture. That is Payments.
- No npm publish. No production cutover.
- No provider account, postage purchase, printer-client install, or device
  change is authorized by this charter.

## What is no longer an open shape question

The 2026-09-25 open questions — whether Ship is a provider router or a custom
implementation, and whether Commerce ships a built-in checkout or relies on a
plugin — are superseded by the confirmed locks above. Commerce owns the
checkout shipping charge. Ship owns optional automation, including the USPS
label purchase and print capability required for coordinated Commerce v1.

## Next focused grill

The next integration boundary remains separately gated. Do not connect a
provider, create an account, or start live postage work from this settings
slice. Ship stores one merchant-managed U.S. ship-from address per store;
structural saving does not imply provider readiness.

## Narrow local exception

The package-private PB sandbox interface experiment is permitted only as a
loopback, synthetic, no-funding test surface. It is not a provider router,
Commerce implementation, production contract, or product-shape decision. It
does not select a vendor, account, or funding model, and must not silently
overwrite the reconciled GrillTrack history.
