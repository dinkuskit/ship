# DinkusKit Ship

Parking lot for shipping. The package name is reserved as `@dinkuskit/ship`.
The manifest stays private at `0.0.0`. There is no plugin, rate engine,
label printer, carrier contract, or compatibility promise yet.

## Status

Charter stage. Shape is **not decided**. Do not implement a provider router,
a custom carrier engine, or a Commerce-core shipping checkout until Bobby
locks those questions in [docs/CHARTER.md](docs/CHARTER.md).

Live stores still buy labels through **ShipTheory via Katana**. That path
stays canonical until an explicit cutover. This repo must not touch Woo,
Katana, or ShipTheory accounts.

## What this is not

- Not Inventory. Inventory v1 does not own shipping labels
  (`dinkuskit/inventory` CHARTER: labels stay on the legacy storefront path).
- Not Payments. Payments does not own shipping rates.
- Not a promise that Commerce will or will not ship a built-in basic
  shipping implementation.

Part of [Dinkus](https://github.com/dinkuskit). MIT.
