# DinkusKit Ship

Optional Registry-enabled shipping automation for DinkusKit. The package name
is reserved as `@dinkuskit/ship`. The manifest stays private at `0.0.0`. There
is no label kernel, provider adapter, or published plugin yet.

## Status

Product locks for coordinated Commerce v1 are recorded. Vendor, account, and
funding are **not selected**. This repository currently holds charter,
research, and contract documents only.

- [Charter](docs/CHARTER.md)
- [USPS feasibility research, 2026-09-30](docs/research/usps-feasibility-20260930.md)
- [Minimal Commerce–Ship contract](docs/contracts/commerce-ship-v1.md)
- [Vendor, account, and funding brief](docs/decisions/vendor-account-funding-brief.md)
- [Public citations](docs/CITATIONS.md)
- GrillTrack ledger: [`.grilltrack/ledger.json`](.grilltrack/ledger.json)

## Confirmed shape

Commerce owns merchant-configured free or flat-rate checkout shipping charges
and manual fulfillment. Ship owns optional automation. Usable U.S. domestic
USPS label purchase and printing inside DinkusKit is required for coordinated
Commerce v1 even if Ship is optional to install. The merchant reviews address,
package, service, and price, then explicitly buys and prints a label.

A third-party postage API behind the DinkusKit interface is acceptable. No
vendor is selected. Ship cannot depend on Inventory. Paid Commerce totals stay
immutable and distinct from postage.

## What this is not

- Not Inventory.
- Not Payments. Payments does not own shipping rates or postage.
- Not a provider, account, or funding selection.
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

Run deterministic contract/state tests with `npm test`. They use fake transport
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

The routes are private POST/JSON routes named `admin`, `settings`, and
`status`. They return JSON-serializable, read-only synthetic settings and do
not call Pitney Bowes. The manifest requests no capabilities, hosts, or
storage. Publisher identity is intentionally absent, so Registry validation,
release, install, and publication remain separate gates.

The local proof is `npm test`; it checks the manifest and route shape alongside
the fixture-backed quote → review → test-label workflow. It is not proof of a
Registry runner, an EmDash host install, a provider hook, or Commerce runtime
integration.

The native EmDash entry is exported as `@dinkuskit/ship/native`. A local host
must install the package from an `npm pack` tarball and import that entry;
ancestor-relative imports of `src/native/index.ts` are not supported install
proof.

Part of [Dinkus](https://github.com/dinkuskit). MIT.
