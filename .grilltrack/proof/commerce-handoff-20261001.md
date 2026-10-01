# Ship contract handoff boundary

Date: 2026-10-01
Mode: read-only handoff; no Commerce edit.

## Immutable Ship contract source

- Ship contract source commit: `8147f626aa391937b41e2b576d34a555c4349ffe`
- Commit subject: `docs: bind handoff to corrected source`
- Source availability: present in this Ship repository at review time.
- Canonical contract: `docs/contracts/commerce-ship-v1.md`
- Projection source: `src/commerce-status.js`

This SHA identifies a Ship repository commit containing Ship's contract
documentation. It is not a Commerce source commit and must not be labeled as
the actual Commerce interface. No Commerce implementation was inspected or
bound by this packet.

For context only, the parent reported actual Commerce `HEAD` as
`51ab023b14490e3bff821e5310dd1c323092df30` at
`/Users/bobbybones/Developer/dinkus/commerce`. That context does not change
inspection permission, establish a source binding, or prove a mount.

## Ship-side contract boundary

The Ship contract describes a proposed read-only boundary around:

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

No actual Commerce interface or Core mount seam is claimed. The actual Core
mount seam is unverified and is not ready for routing.

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

- `docs/contracts/commerce-ship-v1.md`: `200e0ce52e66fabf9f2bd10f3dc5b5a4fce0a945b678bb3c7e60a2429adf7b32`
- `src/commerce-status.js`: `1128c02cc9a0d2a77e7b2c46b1bb1e559af6aa7c73a1ad4d37ee4de79f0aaaaf`
