# DinkusKit Ship

Optional Registry-enabled shipping automation for DinkusKit. The package name
is reserved as `@dinkuskit/ship`. The manifest stays private at `0.0.0`. There
is no label kernel, provider adapter, or published plugin yet.

## Status

Product locks for coordinated Commerce v1 are recorded. Vendor, account, and
funding are **not selected**. This repository currently holds charter,
research, and contract documents only.

- [Charter](docs/CHARTER.md)
- [USPS feasibility research, 2026-09-30](docs/research/usps-feasibility-20260930.md)
- [Minimal Commerce–Ship contract](docs/contracts/commerce-ship-v1.md)
- [Vendor, account, and funding brief](docs/decisions/vendor-account-funding-brief.md)
- [Public citations](docs/CITATIONS.md)
- GrillTrack ledger: [`.grilltrack/ledger.json`](.grilltrack/ledger.json)

## Confirmed shape

Commerce owns merchant-configured free or flat-rate checkout shipping charges
and manual fulfillment. Ship owns optional automation. Usable U.S. domestic
USPS label purchase and printing inside DinkusKit is required for coordinated
Commerce v1 even if Ship is optional to install. The merchant reviews address,
package, service, and price, then explicitly buys and prints a label.

A third-party postage API behind the DinkusKit interface is acceptable. No
vendor is selected. Ship cannot depend on Inventory. Paid Commerce totals stay
immutable and distinct from postage.

## What this is not

- Not Inventory.
- Not Payments. Payments does not own shipping rates or postage.
- Not a provider, account, or funding selection.
- Not authorization to buy postage, install a printer client, or change
  devices.

Part of [Dinkus](https://github.com/dinkuskit). MIT.
