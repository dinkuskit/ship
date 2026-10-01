# DinkusKit Ship

Parking lot for shipping. The package name is reserved as `@dinkuskit/ship`.
The manifest stays private at `0.0.0`. There is no plugin, rate engine,
label printer, carrier contract, or compatibility promise yet.

## Status

Charter stage. Shape is **not decided**. Do not implement a provider router,
a custom carrier engine, or a Commerce-core shipping checkout until Bobby
locks those questions in [docs/CHARTER.md](docs/CHARTER.md).

Live stores still buy labels through **ShipTheory via Katana**. That path
stays canonical until an explicit cutover. This repo must not touch Woo,
Katana, or ShipTheory accounts.

## What this is not

- Not Inventory. Inventory v1 does not own shipping labels
  (`dinkuskit/inventory` CHARTER: labels stay on the legacy storefront path).
- Not Payments. Payments does not own shipping rates.
- Not a promise that Commerce will or will not ship a built-in basic
  shipping implementation.

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

Part of [Dinkus](https://github.com/dinkuskit). MIT.
