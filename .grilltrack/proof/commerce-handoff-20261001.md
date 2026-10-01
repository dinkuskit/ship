# Commerce order/action/interface handoff

Date: 2026-10-01  
Mode: read-only handoff; no Commerce edit.

## Immutable source binding

- Current source SHA: `17f0dd481b16aba9eb2d16f5fc6ad3ea18351705`
- Source availability: present in this repository at review time.
- Canonical contract: `docs/contracts/commerce-ship-v1.md`
- Projection source: `src/commerce-status.js`
- No generated Commerce artifact, host registration, or runtime mount is
  present.

The SHA above identifies the pre-correction source inspected for the handoff.
The correction review records the post-correction immutable source separately;
this handoff does not imply that Commerce was changed.

## Minimal interface

Commerce remains the source of truth for:

- trusted `commerce_order_id`;
- monotonic `order_revision`;
- merchant tenant / `shop_id`;
- immutable paid money and currency;
- shopper shipping charge;
- delivery snapshot and shopper address consent.

Ship may consume a read-only delivery snapshot containing only the minimized
destination, package, origin, and merchant-confirmed service inputs needed for
an attended quote or label action. Ship returns a separate operation result:

```text
quote(order_id, order_revision, delivery_snapshot)
buy_label(order_id, order_revision, quote_id, idempotency_key, confirmation)
get_status(ship_operation_id)
```

The action boundary requires trusted order identity and revision, a
merchant-attended confirmation, a current quote, an idempotency key, and
explicit postage permission. Ship must never rewrite paid Commerce totals.

## Unknowns kept unknown

- `commerce_order_id`: not supplied.
- `order_revision`: not supplied.
- `shop_id`: not supplied.
- delivery snapshot: not supplied.
- trusted caller / actor: not supplied.
- money values and currency: not supplied.
- postage permission: not granted.
- label, tracking, transaction, and print identities: not supplied.

No value is inferred from the PB consumer result. `purchase_unknown` remains
blocked under the existing contract.

## Artifact hashes

These hashes are recorded by the correction review after the bounded local
commit:

- `docs/contracts/commerce-ship-v1.md`: recorded in the review packet.
- `src/commerce-status.js`: recorded in the review packet.
