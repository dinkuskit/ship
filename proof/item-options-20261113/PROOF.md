# Item options on the Shipments and Ship order pages

commerce#264: an order with a Wrong Turn Tee in M and in L showed two identical
"Wrong Turn Tee" lines in both Ship views. Commerce now sends each line's
choices as `options` (dinkuskit/commerce#271, GrillTrack
`commerce-ship-line-options-20261113` in Commerce). Ship keeps it and shows it.

All names and addresses are made up (example.test).

- **Store admin Shipments order page** (EmDash 1.4.0 admin, Ship's built
  plugin handler against a fake hosted Ship): `before-admin-order-*.png` is
  this branch before the change, `after-admin-order-*.png` shows
  "Wrong Turn Tee · Size: M" and "· Size: L" in the Item cell (a Block Kit table
  cell holds one line of text, so the choice follows a dot).
- **Ship's own order page** (`orderPage` from `service/src/pages.ts`, rendered
  with a fixture and captured in Chromium): `before-hosted-order-*.png` is the
  same order without `options`, as Ship shows every order today;
  `after-hosted-order-*.png` shows the choice in grey under the name in
  **In the box**.

Tests: `service/spec/intake.spec.ts` (kept, trimmed; a line break, over 200
characters or a non-string is dropped and the order is still taken),
`service/spec/pages.spec.ts` (grey line, escaped), `tests/admin.test.mjs`
(Item cell text; `null` and missing `options` show the name alone).

## Upgrade compatibility

No storage schema changes: `options` is one more optional key inside the order
record JSON, and nothing is migrated. Proven in the Workers test runtime
(`@cloudflare/vitest-plugin`, real Durable Object SQLite storage):

- `service/spec/admin.spec.ts` "orders, labels and settings stored before item
  options keep working...": a store with an order, a bought label, a ship-from
  address and a box; a row written in the previous format (no `options` key,
  checked) is read through `GET /v1/admin/orders/:id` with `options: null`; the
  earlier order keeps its bought label and settings; a later Commerce version
  with options comes back through the admin routes; the old label still prints
  through its five-minute link and cancels.
- `service/spec/owner.spec.ts`: Ship's own signed-in order page
  (`GET /stores/:site/orders/:id`) shows `Size: M` / `Size: L` under the tee
  names, and an order without options renders as before.
