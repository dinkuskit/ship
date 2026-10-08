# DinkusKit Ship

Optional Registry-enabled shipping automation for DinkusKit. The package name
is reserved as `@dinkuskit/ship`. The manifest stays private at `0.0.0`. The local package contains an injected label workflow and a bounded PB adapter
experiment; it has no published plugin or production provider binding.

## Status

Product locks and historical decisions are recorded below. The private local
sandbox package now renders Ship settings through pinned EmDash 1.2.0.
Commerce orders are unavailable until the authorized Core handoff exists;
provider actions remain disabled. This is not a signed Registry release.

- [Charter](docs/CHARTER.md)
- [USPS feasibility research, 2026-09-30](docs/research/usps-feasibility-20260930.md)
- [Minimal Commerce–Ship contract](docs/contracts/commerce-ship-v1.md)
- [Vendor, account, and funding brief](docs/decisions/vendor-account-funding-brief.md)
- [Public citations](docs/CITATIONS.md)
- GrillTrack ledger: [`.grilltrack/ledger.json`](.grilltrack/ledger.json)

## Install type

DinkusKit plugins ship as EmDash Registry plugins: sandboxed and installed
from the plugin Registry, which is how most EmDash sites add plugins. The
Registry build is the supported product, and features are designed, tested and
documented for it first. A native entry (code a site registers in its own
configuration or Astro routes) is a developer and test setup only. It may not
offer features the Registry build lacks, except temporary gaps listed here with
the work that closes them. The project owner set this rule on 2026-10-08.

Ship's installable plugin is the sandboxed package described by
`emdash-plugin.jsonc`. `src/native/` holds a local UI proof that the package
does not use. Native-only gaps:

- The `./workflow`, `./installed` and `./host-label-assets` exports need a
  host-owned integration and an authenticated native Astro mount for stored
  label view, download and print. A Registry path for these is not designed
  yet, and label printing does not reach Registry installs until it exists.

## Confirmed shape

Commerce owns merchant-configured free or flat-rate checkout shipping charges
and manual fulfillment. Ship owns optional automation. Usable U.S. domestic
USPS label purchase and printing inside DinkusKit is required for coordinated
Commerce v1 even if Ship is optional to install. The merchant reviews address,
package, service, and price, then explicitly buys and prints a label.

A third-party postage API behind the DinkusKit interface is acceptable. Pitney
Bowes is selected, with merchant-owned and merchant-funded postage accounts.
Ship cannot depend on Inventory. Paid Commerce totals stay
immutable and distinct from postage.

## What this is not

- Not Inventory.
- Not Payments. Payments does not own shipping rates or postage.
- Provider connection and account setup remain separate work.
- Not authorization to buy postage, install a printer client, or change
  devices.

## Bounded PB sandbox interface experiment

This branch contains a local, package-private merchant lab for the explicitly
scoped Pitney Bowes USPS sandbox experiment. It is not a product-shape lock or
production implementation. The browser can request a synthetic domestic US
Priority Mail quote, review its service and price, and create a clearly marked
sandbox test label whose PDF is proxied by the server.

The server owns credentials and uses only these fixed origins:

- `https://shipping-api-sandbox.pitneybowes.com` for OAuth and shipping calls
- `https://stg-labels-cls.gcs.pitneybowes.com` only for validated label PDFs

Custom origins, production URLs, redirects, and missing credentials fail closed.
No credential values, provider responses, or private URLs are written to
errors or proof. Runtime task state belongs under the ignored
`runs/pb-sandbox-interface-runs/20260930/` directory.

### Local launch

Credentials must be injected by an approved local wrapper or selector; do not
put them in this repository, shell history, or chat. The current approved
wrapper is missing, so the normal server intentionally starts unconfigured:

```sh
npm run dev
```

Open `http://127.0.0.1:4317/`; it will show `Credentials not configured` and
mutation endpoints fail closed. A future approved wrapper must provide
`PB_SANDBOX_API_KEY`, `PB_SANDBOX_API_SECRET`, and `PB_SANDBOX_SHIPPER_ID`
without exposing their values to this project.

Run the canonical local gate with `npm run verify:full` (or
`npm run verify:quick` during edits). See
[Ship verification](skills/ship-verification/SKILL.md) for modes and installed-host
prerequisites. Run deterministic contract/state tests alone with `npm test`. They use fake transport
only and are labelled fixture verification, not live API proof. The adapter
factory accepts an injected adapter for a test-only harness; no fake fallback
is used by the main server.

For attended CUA proof of quote → review → test label, run the opt-in fixture
server separately on port 4328:

```sh
npm run fixture:proof
```

This serves a synthetic $8.60 USPS PM result and a generated PDF marked
`FIXTURE PROOF - NO LIVE PB API`. It exercises the same UI routes, including
separate View PDF and Download PDF links. To prove the unresolved path instead,
run `FIXTURE_MODE=unknown npm run fixture:proof`; this records no live call and
leaves the operation blocked as `unknown`. The ordinary development server
never enables either fixture mode.

The value-free credential packet is in
[docs/credentials-setup.md](docs/credentials-setup.md). The exact live blocker
is the absent approved wrapper.

### Local EmDash package seam

`emdash-plugin.jsonc` and `src/plugin.js` are the smallest package seam for a
future EmDash host. The package export is the supported local package path:

```sh
node --input-type=module -e 'import("@dinkuskit/ship").then(({ default: plugin }) => console.log(Object.keys(plugin.routes)))'
```

The private POST/JSON routes `admin`, `settings`, and `status` do not call
Pitney Bowes. The Block Kit admin settings action persists display preferences
and one merchant-managed U.S. ship-from address in plugin-scoped storage.
The address requires a name or company, street, city, recognized U.S. postal
region, five-digit ZIP or ZIP+4, and country `US`. Each text field is limited
to 100 characters. Invalid submissions preserve the previously saved record.
Saving the origin is structural local configuration only; it does not verify
provider readiness. Merchant-owned Pitney Bowes postage accounts are the
settled account direction; merchant payment of provider fees is preferred,
while subsidy amounts remain unapproved. English and Arabic copy use the
host's attested locale and direction. Unmounted orders fail closed. Synthetic order examples
require the explicit isolated test fixture selector. Publisher identity and
security contact remain absent; signed Registry release and publication are
separate gates.

`npm test` checks route contracts and deterministic fixtures. To prepare a
config-managed sandbox host from a fresh packed package:

```sh
npm run prepare:sandbox
cd runs/sandbox-host-local/host
npm run dev
```

The loopback host runs on port 4343. Stop an existing task-owned host before
starting another on that port. Use the installed runner, host directory, and
URL with `verify:sandbox`:

```sh
EMDASH_SANDBOX_RUNNER_MODULE=file:///absolute/host/node_modules/@emdash-cms/sandbox-workerd/dist/sandbox/index.mjs \
EMDASH_SANDBOX_HOST_DIR=/absolute/host \
EMDASH_SANDBOX_HOST_URL=http://127.0.0.1:4343 npm run verify:sandbox
```

Run that command from this repository. Verification compares the current
packed package with the host-installed files, exercises the actual private
admin dispatcher, checks origin and preference storage independently, validates
invalid-origin preservation, and checks Arabic RTL responses.
This proves local config-managed sandbox execution, not signed Registry
installation or Commerce/provider integration. See the dated proof under
`proof/2026-10-03-emdash-sandbox-host/`.

Historical native preparation files remain in source, but no native package
subpath is supported or exported. The installed sandbox entry is the current
package contract.

Part of [Dinkus](https://github.com/dinkuskit). MIT.

## October 8 installed workflow candidate

Additive `./workflow` and `./installed` exports support a host-owned private
workflow with trusted paid-order/actor ports and durable CAS label operations.
The default sandbox export still has no Commerce/provider connection. The
[installed contract](docs/contracts/installed-ship-workflow.md) specifies route
schemas, fixture boundaries and missing production authority. The optional
`./host-label-assets` export provides `createHostLabelAssets` and
`createLabelLinks` for an explicitly configured, authenticated native Astro
mount. It exposes only operation-bound stored PDF view/download and an explicit
browser print attempt; it cannot buy, reconcile or fetch missing provider bytes.
Installing the default sandbox entry does not mount this native route.
Independent local fixture proof covers Chrome rendering, exact stored-byte
download and the print-attempt status; no print dialog or physical printing is
confirmed. No real postage, production Commerce integration, deployment or
Registry mounting is proven by these exports.
