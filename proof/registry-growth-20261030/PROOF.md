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
- Description: 121 graphemes. Sections: description 876, installation 761,
  FAQ 853 characters, all below their caps.

Raw command logs stay in the ignored `runs/registry-growth-20261030/` directory.
This plugin-only change does not execute the hosted-service full verifier.

## Limits and next action

No live store, postage purchase, provider account, profile update, release,
deployment or merge was performed. The copy explicitly says sandbox/practice
labels are not valid postage; it promises no live postage or standalone intake.

No current installed Ship screenshot was available in the repository. Its
current unit fixture exercises Block Kit JSON, and historical screenshot
references point to older ignored runs. A current sanitized installed capture
remains outstanding; no obsolete or fabricated UI is shipped as a screenshot.

The pinned CLI's dry `release prepare` bundles code but does not upload media.
Profile updates and release media publication require separate approved steps;
the retained image/section files do not prove media visibility in the registry.
See [listing maintenance](../../docs/registry-listing/README.md).

Review, approved media/profile publication, and public-render verification are
still required. A successful local build is not a published listing.
