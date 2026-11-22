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

## Authority chain, end to end

`authority-chain.spec.ts` runs the built plugin's `admin` route, for users of
each role, against hosted Ship's own Worker and per-store Durable Objects in
Cloudflare's Workers runtime (`vitest.config.mts` here reuses
`service/wrangler.jsonc`), with Pitney Bowes's sandbox API and DinkusKit.com's
store-passes stood in for. `authority-chain-trace.md` is its output and lists
every stand-in. It shows:

- an Administrator's Connect going plugin -> `POST /v1/admin/settings/postage`
  -> Pitney Bowes's credentials check -> the store's Durable Object keeping the
  Shipper ID with `connectedBy admin:<email>`, and the password in no table;
- an Editor, and the same Administrator after being made an Editor, refused
  before any effect: no Ship call, no Pitney Bowes call, storage unchanged, also
  when the form is sent without a page or onto the Shipments page;
- real orders' labels, bought from the Shipments page, paid by the account
  connected at that moment: the first account, then its replacement only, then
  none after Disconnect (Ship refuses and Pitney Bowes is not asked); DinkusKit's
  own sandbox shipper never pays a real order;
- another store's Connect changing only that store.

Breaking either side (the plugin's Administrator check, or Ship's Disconnect)
makes the run fail, as the trace records.

The routes alone are also covered in `service/spec/admin-settings.spec.ts`
(a `ship:orders` pass refused on every new route, stores isolated, a refused
save changing nothing), and the plugin alone in `tests/settings.test.mjs`.

## Checks

- `bin/verify-ship quick`: 86 pass. `bin/verify-ship full`: passed, service 98 pass.
- Authority chain: 1 pass (see above).
- `npm run typecheck`: clean.
- Registry bundle: 41,442 bytes, against 32,527 on main (cap 131,072).
