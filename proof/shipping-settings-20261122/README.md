# Shipping settings and Label history in the store admin (step (c) of store-connect-order-135)

Decisions (DinkusKit.com ledger): `ship-settings-in-admin-129` and
`ship-pitney-connect-in-admin-138` (the owner approved on 2026-11-22: connect
the Pitney Bowes account inside EmDash).

## Pictures (22 Nov 2026)

The Block Kit JSON beside each picture is what the built plugin
(`dist/plugin.mjs`, from this branch) answered, with synthetic stand-ins for
DinkusKit.com's store passes and hosted Ship's routes (the same stand-ins as
`tests/settings.test.mjs`). It was drawn with EmDash's own `BlockRenderer`
(`@emdash-cms/blocks`) and the admin stylesheet and captured with Playwright's
Chromium at 1,100 and 390 pixels wide. The green "Toast" line stands in for
EmDash's toast. No store, DinkusKit.com or Ship service was contacted.

- `settings-new-store.png`: a connected store with nothing set yet: Ship from,
  Pitney Bowes postage with **Create your Pitney Bowes account** and the
  username and password form, Shipped email and Box sizes.
- `settings-box-added.png`: after saving the ship-from address, the reply-to
  email and two boxes, each with **Remove**.
- `settings-refused.png`: a box without a width: Ship's reason under
  "Not saved", the typed box kept.
- `settings-pitney-connected.png` and `-390.png`: after **Connect Pitney
  Bowes**: the account named, **Disconnect Pitney Bowes**, no password field.
- `settings-editor.png`: an Editor is told the page is for Administrators.
- `settings-before-ship-deploy.png`: until ship.dinkuskit.com has the new
  routes, the page links to Ship's own Settings.
- `shipments-footer.png`: the Shipments page's buttons: Refresh, **Label
  history**, **Shipping settings** and Open Ship.
- `label-history.png` and `-390.png`: every label, newest first, with
  **Load more**; the order number opens the order.

## Authority

The new hosted routes are proved against Ship's real Worker in
`service/spec/admin-settings.spec.ts` (Cloudflare's Workers test pool, the
real pass check against a published key set): a `ship:orders` pass is refused
on every settings and history route, another store's pass sees only its own
settings, a refused save changes nothing, a Pitney Bowes connect needs the
admin's email and keeps no password, and the settings answer never carries the
Shipper ID, who connected it or the developer id. The plugin's side, in
`tests/settings.test.mjs`, shows the store key going only to DinkusKit.com, the
pass only to Ship, nothing sent for an Editor or an unconnected store, and only
each form's own fields sent.

## Checks

- `bin/verify-ship quick`: 86 pass. `bin/verify-ship full`: passed, service 98 pass.
- `npm run typecheck`: clean.
- Registry bundle: 41,442 bytes, against 32,527 on main (cap 131,072).
