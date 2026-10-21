# DinkusKit Ship

Shipping labels for DinkusKit stores on EmDash: the hosted Ship service at
ship.dinkuskit.com buys USPS labels from Pitney Bowes, and the Ship plugin puts
the everyday steps on a Shipping page in the store admin.

Two parts live here:

- **The Ship plugin** (this directory, Registry names `dinkus-ship` and
  `dinkus-ship-beta`): a sandboxed EmDash plugin with one admin page,
  "Shipping". Editors and Administrators see the paid orders Commerce sent to
  Ship, see USPS prices, press Buy label, Print label (the PDF opens in a new
  tab) and Cancel label. It keeps no label data: every click reads from, or buys
  through, hosted Ship, so the two can never disagree. GrillTrack
  `ship-registry-plugin-001`, [the decision](docs/decisions/ship-registry-plugin.md),
  [the wire contract](docs/contracts/ship-plugin-v1.md).
- **The hosted Ship service** ([`service/`](service/README.md)): the Cloudflare
  Worker behind ship.dinkuskit.com. It takes Commerce's orders, buys, keeps and
  cancels labels, sends the shipped email, and serves the owner's own pages
  (Sign in with DinkusKit.com): Settings, the owner's Pitney Bowes postage
  account, refunds and label history. It is the full path and the fallback
  when the plugin is not installed.

## How a label gets bought from the store admin

1. The owner pastes the **Store ID** and **store key** from the Set up Commerce
   box on DinkusKit.com into the plugin's settings (the same ones Commerce has).
2. The plugin trades the key at `https://dinkuskit.com/api/store-passes` for a
   5-minute `ship:admin` pass and reuses that pass across clicks while it lasts,
   so the key is traded about once per five minutes. The key never goes to Ship
   or a store page.
3. With the pass, the plugin asks Ship for the orders, prices, the label, a
   print link or a cancel. Ship buys from Pitney Bowes with DinkusKit's developer
   keys and the store's own postage account; TEST orders get free sandbox labels
   (or practice labels) and never live postage.
4. Commerce picks the label up from Ship within a few minutes and marks the
   order Completed with the tracking number, exactly as from Ship's own page.

## Develop

Node 24 (see `.nvmrc`; `>=24.15.0 <25`, the lowest Node 24 EmDash's registry
verifier runs on). To move an existing Node 22 checkout, switch Node (mise, nvm
and fnm read `.nvmrc`; `node --version` must print v24.x) and run `npm ci`
again here and in `service/`, since `node_modules` installed under Node 22
fails the engine check. Cloud sessions get Node 24 from the environment's
setup script; the session hook installs nothing on another Node.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test            # builds the plugin, runs the 128 KiB Registry bundle check, then the tests
bin/verify-ship full   # the above plus the hosted service's checks and a dry release preparation
```

`src/plugin.ts` is the Registry entry; `src/admin.ts` routes the Shipping
page's clicks, `src/pages.ts` draws the Block Kit pages and `src/ship.ts` talks
to DinkusKit.com and Ship. The manifest is `emdash-plugin.jsonc`. The plugin
CLI's declaration build needs TypeScript's JavaScript API, so this directory
pins TypeScript 6; the service under `service/` type-checks on TypeScript 7.

Releases go through Changesets and the EmDash Registry: see
[RELEASING.md](RELEASING.md).

## Install type

DinkusKit plugins ship as EmDash Registry plugins: sandboxed and installed from
the plugin Registry. The Registry build is the supported product. The old
local sandbox test plugin that used to live in this directory was removed when
the real plugin was built (decision 7 of `ship-registry-plugin-001`); its dated
proofs stay under `proof/` as history.

## Decisions and history

- [Ship plugin in the store admin](docs/decisions/ship-registry-plugin.md)
- [Charter](docs/CHARTER.md)
- [USPS feasibility research, 2026-09-30](docs/research/usps-feasibility-20260930.md)
- [Minimal Commerce–Ship contract](docs/contracts/commerce-ship-v1.md)
- [Vendor, account, and funding brief](docs/decisions/vendor-account-funding-brief.md)
- [Public citations](docs/CITATIONS.md)
- GrillTrack ledger: [`.grilltrack/ledger.json`](.grilltrack/ledger.json)

Commerce owns merchant-configured checkout shipping charges and manual
fulfillment. Ship owns labels. Ship cannot depend on Inventory. Paid Commerce
totals stay immutable and distinct from postage. Pitney Bowes is the postage
provider: one DinkusKit developer account, each owner their own postage account
(decision 2a).
