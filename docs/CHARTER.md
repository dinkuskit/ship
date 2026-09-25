# DinkusKit Ship charter

Recorded 2026-09-25. Current intention, not law. Bobby has not locked
the product shape.

## Locked negatives

- This repository does not own on-hand, reserved, or location stock.
  That is Inventory.
- This repository does not own payment capture. That is Payments.
- This repository does not mutate WooCommerce, Katana, or ShipTheory.
- Inventory v1 shipping labels remain on the legacy storefront native
  path (`dinkuskit/inventory` docs/CHARTER.md).
- No npm publish. No production cutover.

## Live operations (fact, not a design)

Smoky fulfillment currently uses ShipTheory through Katana. Replacing
that to save money is a later cutover, not this scaffold.

## Open questions (unselected)

1. **What is `dinkuskit/ship`?**
   - A plugin that connects shipping *providers* (ShipTheory, Pirate
     Ship, and later others), or
   - A custom shipping implementation that is not merely a router.

2. **Where does Commerce get shipping?**
   - Commerce ships with a basic built-in implementation, or
   - Commerce relies on a plugin: this package, or a store's own
     plugin behind a Commerce-owned port.

Do not treat a provider list, a rate API, or a checkout UI as decided.

## Next focused grill

Unselected. Do not start a kernel until those two questions are locked
in this file.
