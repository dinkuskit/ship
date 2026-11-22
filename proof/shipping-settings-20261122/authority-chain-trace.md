# Authority-chain trace: Shipping settings and the Pitney Bowes paying account

Output of `authority-chain.spec.ts` (run from `service/`:
`npx vitest run --config ../proof/shipping-settings-20261122/vitest.config.mts --silent=false`)
on 22 Nov 2026, against this branch's built plugin (`dist/plugin.mjs`) and hosted
Ship's own Worker and per-store Durable Objects in Cloudflare's Workers runtime.
Store keys are redacted; every password is synthetic and the run checks none
appears in this trace or in any table of the store's Durable Object.

What is real: the plugin's `admin` route and role check, its pass handling and
calls; Ship's routing, ES256 pass verification against the published key set,
scope check, settings and postage-account storage, Pitney Bowes credential
lookup, rate and label purchase code, and the paying account it reads at
purchase time. What stands in: the transport (https://ship.dinkuskit.com is the
Worker's fetch handler; workerd's Request takes neither `cache` nor redirect
"error", so those two options are dropped on the way), DinkusKit.com's
store-passes (signs a pass only for a store key it issued, for that key's
store), Commerce's order push (Ship's real `POST /v1/orders` with a signed
`ship:orders` pass) and Pitney Bowes's sandbox API (answers and records each call).

```
setup: store a = site_proof_a_adcac891, plugin connected with its own DinkusKit key (redacted)
setup: store b = site_proof_b_10262ada, plugin connected with its own DinkusKit key (redacted)
setup: Commerce sent real (not TEST) orders #1001, #1002 and #1003 to store a through Ship's POST /v1/orders
admin (role 50) on /shipping-settings: page load, ship-from saved, box added -> Ship calls: GET /v1/admin/settings, POST /v1/admin/settings/ship-from, POST /v1/admin/settings/boxes
editor (role 40): Connect Pitney Bowes on /shipping-settings -> "Shipping settings are for Administrators"; the same form with no page and forged onto /shipping -> empty answer; Disconnect -> refused. Ship calls +0, Pitney Bowes calls +0, store storage unchanged
admin, wrong password: Pitney Bowes credentials check refused -> "Not saved", no paying account, the password is not in any table of the store's Durable Object
admin connects: POST /v1/admin/settings/postage -> Pitney Bowes credentials check (2 in all) -> Ship keeps shipperId SHIPPER-OWNER-A, connectedBy admin:owner-a@example.test; the password is in no table; the page shows the account and no password
editor buys #1001 on /shipping -> Pitney Bowes shipment SHIPPER_ID = SHIPPER-OWNER-A
demoted administrator (role now 40): Disconnect and Connect another account -> refused; Ship calls +0, Pitney Bowes calls +0, storage unchanged, SHIPPER-OWNER-A still pays
admin replaces the account -> Ship keeps SHIPPER-OWNER-A2; editor buys #1002 -> SHIPPER_ID = SHIPPER-OWNER-A2 (the replaced account pays nothing more)
admin disconnects -> no paying account; admin buys #1003 -> Ship refuses (Connect your Pitney Bowes postage account), Pitney Bowes calls +0; DinkusKit's own sandbox shipper never paid a real order
store b's admin connects SHIPPER-OWNER-B through store b's own pass -> store b keeps it, store a still has no paying account
```

Result: 1 passed.

## The run fails when the boundary breaks

Two deliberate breaks, each reverted after the run:

- The plugin's Administrator check removed from `src/settings.ts`: the run fails
  at the Editor's Connect (`expected ... to contain 'Shipping settings are for Administrators'`).
- Ship's Disconnect made to keep the account (`service/src/store.ts`): the run
  fails at Disconnect (`expected { shipperId: 'SHIPPER-OWNER-A2', … } to be null`),
  before the purchase that would have used the stale account.
