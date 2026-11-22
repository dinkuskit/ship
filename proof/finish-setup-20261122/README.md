# Finish setup on the Shipments page (step (b) of store-connect-order-135)

Decisions (DinkusKit.com ledger): `store-connect-approve-once-125`,
`store-connect-ship-on-at-setup-126`, `connect-shows-siblings-133`,
`connect-uninstall-cancels-key-134`.

## Pictures (22 Nov 2026)

The Block Kit JSON beside each picture is what the built plugin
(`dist/plugin.mjs`, from this branch) answered for an Administrator's page load,
with synthetic stand-ins for DinkusKit.com and hosted Ship. It was drawn with
EmDash's own `BlockRenderer` (`@emdash-cms/blocks`) and the admin stylesheet
(`@emdash-cms/admin/dist/styles.css`) and captured with Playwright's Chromium.
No store, DinkusKit.com or Ship service was contacted.

- `finish-setup.png`: a store DinkusKit.com already knows. The page says "Almost
  ready: this store is already connected to DinkusKit" with one **Finish setup**
  button. An Editor is asked to get an Administrator.
- `orders-connected-to.png`: the orders list with the line "Connected to Acme
  Goods on DinkusKit. DinkusKit plugins on this store: Commerce, Payments and Ship."

## Checks

`tests/admin.test.mjs` covers the following.
- Finish setup:
  - It is offered only when DinkusKit.com says so.
  - An Editor's press starts nothing.
  - An Administrator's press reaches the orders with no Approve. DinkusKit.com read the receipt on the proof route, the verifier matches, the key is saved and nothing is left waiting.
  - `owner_approval_required` falls back to the Approve link and Check.
  - Other refusals save nothing.
- The connected-to line is read with this plugin's own key and a `store:connection` pass. It is left off when there is no answer or the answer names an unknown plugin.
- `service_not_enabled` now asks for Connect again, which turns Ship on.
- The `plugin:uninstall` hook cancels only this plugin's key.

Results:
- `npm test`: 76 pass.
- `npm run typecheck`: clean.
- Registry bundle: 32,527 bytes, against 28,523 on main.
