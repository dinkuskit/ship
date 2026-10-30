# Ship registry listing preparation

Status: source prepared and locally checked; not published.

## Source and scope

- Repository: `dinkuskit/ship`.
- Branch: `codex/registry-growth-20261030`.
- Base: `82199fc8a20da66345174339114b6bb266f7ca59`.
- The manifest retains its publisher DID, stable slug, repository, security
  contact, capabilities, allowed hosts, storage and admin configuration.
- Only display metadata, listing copy/artwork and the existing release staging
  needed to preserve them change. No hosted service or plugin runtime changes.
- The stable name becomes **DinkusKit Ship**; beta preparation keeps the
  distinct **DinkusKit Ship (Beta)** label and the existing beta slug.
- Documentation impact: the listing now explains the existing released
  behavior. `docs/website/reference/ship.md` requires no behavior/setup change.

## Artwork provenance

`assets/listing/icon.webp` is an unmodified copy of the existing DinkusKit
website artwork:

- Source: [public/brand/ship.webp](https://github.com/dinkuskit/dinkuskit/blob/920aea3f012a14beb90d1be7264121dd7a8dd105/public/brand/ship.webp).
- Website source revision: `920aea3f012a14beb90d1be7264121dd7a8dd105`.
- SHA-256: `28e215e4c5544e33b53f0f16e8abfc45c525d746c748a63dd320bd2e4cf7c367`.
- Bytes: 8,034. Format/dimensions: WebP, 256 × 256.
- Visually inspected: the existing orange parcel/cube artwork; no user data.
- This is product listing artwork, not runtime/browser evidence.

`assets/listing/connect-ship.png` is an actual browser capture of the initial
Ship Connect screen, not a generated mockup:

- Capture source: local EmDash 1.4.0 (10beb8c5a), Chrome, Ship 0.3.0 bundle
  built from this branch. Synthetic administrator only; no customer data.
- Runtime: real EmDash Cloudflare/workerd sandbox, seeded post-install plugin
  state. This does not claim the Registry install/consent flow was exercised.
- Loaded bundle: 25,590 bytes; SHA-256
  `9811b2420a3336408b42befeaed8a07538bf8902d47dd263a88efa33ae41f499`.
- Image: PNG, 2,220 × 375, 24,522 bytes; SHA-256
  `69f07e58efd5d93a491bbb0e6c622a0a3dd46d7f31d52da5f12e1047aa7ca775`.
- Capture is cropped at screenshot time to the plugin heading, explanatory
  panel, Connect button and website link. It excludes unrelated local fixture
  navigation. No pixels or UI wording were changed.
- Full capture, accessibility tree and loaded-artifact hashes are retained in
  the ignored local run. The image was visually inspected; no error banner,
  customer data, credentials or invented connected state is present.
- This proves only the initial setup display. No Connect click, account
  authorization, shipping request, label purchase or printing was performed.

## Checks

Using Node `v24.22.0` and the locked dependencies:

- `npm ci --ignore-scripts --no-audit --no-fund`: passed.
- `bin/verify-ship quick`: passed, 63 tests, zero failures or skips. Includes
  typecheck, manifest/build validation, feature-map check, bundle cap, and
  stable/beta release preparation regressions.
- `node .github/scripts/prepare-emdash-release.mjs --out-dir .emdash-release`:
  passed as a local dry preparation. Backend: 25,590 bytes, below 131,072 bytes.
- Regression assertions verify referenced section files and the exact icon
  bytes survive both preparation paths, including the prepared output folder.
- `node_modules/.bin/emdash-plugin validate`: passed using CLI `0.13.5`.
- `git diff --check`: passed.
- Manifest comparison excluding only display/profile/artwork fields: unchanged
  runtime/identity configuration.
- Description: 121 graphemes. Sections: description 876, installation 755,
  FAQ 853 characters, all below their caps.

Raw command logs stay in the ignored `runs/registry-growth-20261030/` directory.
This plugin-only change does not execute the hosted-service full verifier.

## Limits and next action

No live store, postage purchase, provider account, profile update, release,
deployment or merge was performed. The copy explicitly says sandbox/practice
labels are not valid postage; it promises no live postage or standalone intake.

The initial repository had no reusable current Ship screenshot. A narrow local
fixture capture supplied the setup image above; no obsolete or fabricated UI
is shipped. Two copied fixture attempts hit a duplicate-React development
failure; the known working local host was handed over exclusively, used to
load the exact Ship bundle, and its original source files restored afterward.

The pinned CLI's dry `release prepare` bundles code but does not upload media.
Profile updates and release media publication require separate approved steps;
the retained image/section files do not prove media visibility in the registry.
See [listing maintenance](../../docs/registry-listing/README.md).

Review, approved media/profile publication, and public-render verification are
still required. A successful local build is not a published listing.
