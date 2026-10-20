# Releasing the Ship plugin

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack `release-changesets-061` through `release-beta-cut-071`). This file
is the per-repo operating summary. The release files are Payments' (`dinkuskit/payments`),
copied with only the package names and repository constants changed, so Payments,
Commerce and Ship all release the same way: Changesets plus a dedicated beta EmDash
Registry slug, so every release is proven in a real EmDash beta store before stable
publication.

Only the plugin at the repository root is released this way. The hosted
service under `service/` is deployed to ship.dinkuskit.com from Ronald's Mac on
his typed go, never by a workflow.

## Release Identity

| Channel | EmDash Registry Slug | Installed Plugin ID (`derivePluginId`) | Package Version Format |
| --- | --- | --- | --- |
| **Beta** | `dinkus-ship-beta` | `r_nhb4yqdnowdmkxyu` | `X.Y.Z-beta.N` (e.g. `0.1.1-beta.1`) |
| **Stable** | `dinkus-ship` | `r_ehdlg5cxkb3ffqvr` | `X.Y.Z` (e.g. `0.1.1`) |

- Every release builds the sandbox plugin bundle (`dist/plugin.mjs`, from `npm run build`) and verifies that its size stays strictly under `128 KB` (`131,072` bytes); `scripts/check-registry-bundle.mjs` enforces the same limit on the official Registry packaging during the build.
- Historical git tags before `v0.1.0` are never backfilled; the stable tag baseline is `v0.1.0` (`dinkus-ship@0.1.0`, ship#52, the first final).
- Ship stays on 0.x until the 1.0.0 gate: `changeset-check.yml` rejects a `major` changeset and the Release workflow runs `.github/scripts/check-no-major.mjs` before tagging.
- Every GitHub Actions `uses:` reference in `.github/workflows/*.yml` is pinned to a full 40-character commit SHA.
- Both release buttons are on **Release** (`.github/workflows/release.yml`): `action: cut-beta` and `action: promote`. `.github/workflows/emdash-release.yml` is a `workflow_call`-only helper. Cut beta replaces Changesets pre mode: there is no `.changeset/pre.json` any more, and a beta is never versioned on `main`.

## Delegated Registry Publishing (No Stored PDS Credentials)

Registry publishing uses GitHub OIDC, Sigstore build provenance (`actions/attest-build-provenance`), and the EmDash delegated release service (`emdash-cms/emdash/apps/release-action` targeting `https://releases.emdashcms.com`), so no Atmosphere/PDS handle or app-password secret is stored in this repository.

1. `.github/scripts/prepare-emdash-release.mjs` copies the built sandbox bundle (`dist/plugin.mjs`) into an isolated temporary directory as its only source file, with a manifest whose slug and display name are rewritten for a beta (`dinkus-ship-beta`, `Ship Beta`) and kept for a stable release, and invokes the official `emdash-plugin release prepare <slug@version>` command there, producing `.emdash-release/<slug>-<version>.tar.gz` plus the `publisher-did`, `bundle-file`, and `selector` outputs. Code and declared access are byte-identical between a beta and the stable build from the same commit; the hosted service under `service/` never reaches the bundle.
2. `actions/attest-build-provenance` signs build provenance over the prepared bundle tarball (`id-token: write`, `attestations: write`).
3. `emdash-cms/emdash/apps/release-action` submits the bundle and provenance to `https://releases.emdashcms.com` for `publisher-did` (`did:plc:ekk4pjmkh3k3ql2kfoex3qt4`).
4. Because the delegated release service can currently end successful publishes in `RELEASE_CONFLICT` ([`emdash-cms/emdash#4159`](https://github.com/emdash-cms/emdash/issues/4159)), the publish step uses `continue-on-error: true` and `.github/scripts/verify-registry-release.mjs` acts as the fail-closed gate by resolving the publisher PDS endpoint directly and verifying that the `com.emdashcms.experimental.package.release` record for `<slug>:<version>` carries the exact multihash checksum and byte size of the prepared tarball.

### One-time setup still required (owner)

- The release GitHub App credentials for this repository (`RELEASE_APP_ID` and
  `RELEASE_APP_PRIVATE_KEY` repository secrets), as for Commerce and Payments.
- The `LIVE_JOURNEYS_TOKEN` repository secret (Step 3).
- The `dinkus-ship-beta` package profile already exists under `@smokyco.bsky.social`
  (`did:plc:ekk4pjmkh3k3ql2kfoex3qt4`): the `0.1.0-beta.N` betas published to it. If it
  ever has to be recreated, stage a beta manifest directory from a built checkout and
  create the profile record with the publisher's interactive `emdash-plugin` login session:
  ```bash
  npm ci
  npm run build
  node .github/scripts/prepare-emdash-release.mjs --slug dinkus-ship-beta --version 0.1.1-beta.1 --out-dir /tmp/ship-beta-profile
  ./node_modules/.bin/emdash-plugin profile setup --dir /tmp/ship-beta-profile --yes
  ```
- In the [EmDash release-service publisher dashboard](https://releases.emdashcms.com/publisher), choose **Authorize publishing** for `dinkus-ship-beta` (and `dinkus-ship` if not already authorized), then approve the `dinkuskit/ship` `.github/workflows/release.yml` workflow connection when the dashboard first asks. Both buttons (Cut beta and Promote) live on `release.yml`, and `.github/workflows/emdash-release.yml` is only ever called from it, so one connection covers both listings. A connection made earlier through `emdash-release.yml` (from before Cut beta moved to `release.yml`) is no longer used. The dashboard shows a pending connection only while a run's publish step is waiting for it, for up to 30 minutes. If that time runs out, press Cut beta again with the same `beta_version`: a re-run of the same run reuses its expired request and fails with `WORKFLOW_CONNECTION_CONFLICT`.

Approvals are only requested when a release expands plugin permissions.

## Step 1: Every PR Includes a Changeset

Every pull request targeting `main` (except automated `ci: release` PRs on `changeset-release/main`) must add at least one `.changeset/*.md` file:

```bash
npm run changeset
```

On 0.x, choose `patch` for fixes and `minor` for everything else; `changeset-check.yml` (`.github/scripts/check-changeset.mjs`) rejects a missing changeset and any `major` bump. For documentation, tests, CI, or hosted-service-only changes that should not bump the package version, create an explicit empty changeset (`npx changeset --empty`), which produces a `.changeset/*.md` file with empty frontmatter (`---\n---`) that satisfies the check and is excluded from version bump calculation.

## Step 2: Cut Beta (`dinkus-ship-beta`)

Merging normal PRs to `main` does **not** automatically publish a beta or open a release PR.

When `main` has pending version-bumping `.changeset/*.md` files and you are ready to cut a beta:

1. Press **Run workflow** on **Release** (`.github/workflows/release.yml`) on `main` with `action: cut-beta` (leave `beta_version` blank to auto-compute the next `X.Y.Z-beta.N`, or supply an explicit `X.Y.Z-beta.N` override).
   - Its **Cut beta** job calls `.github/workflows/emdash-release.yml` through `workflow_call` with `release_mode: beta`. That workflow has no button of its own. Its gate, `.github/scripts/emdash-dispatch-gate.mjs` (`validateEmDashDispatchGate`), allows only `refs/heads/main`, `release_mode: beta` and `-beta.N` versions before minting any GitHub App token or performing Registry I/O. Stable versions, a missing `release_mode` and non-`main` dispatches are rejected immediately.
2. The workflow:
   - Computes the target `X.Y.Z` from pending changesets on `main` and determines the next `X.Y.Z-beta.N` across existing git tags and all `dinkus-ship-beta` release records on the manifest publisher’s PDS. This reads every page of the public `com.atproto.repo.listRecords` inventory, including versions not yet visible in the discovery catalog, and fails closed on lookup, identity, schema, or pagination errors. The retired aggregator host and discovery listing policy are not used to allocate version numbers.
   - Tags the `main` commit `vX.Y.Z-beta.N` using the release GitHub App token (`RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY`).
   - Prepares `.emdash-release/dinkus-ship-beta-X.Y.Z-beta.N.tar.gz` via `emdash-plugin release prepare` with `slug: "dinkus-ship-beta"`, `name: "Ship Beta"`, and `version: "X.Y.Z-beta.N"`, while keeping the repository root `emdash-plugin.jsonc` at `dinkus-ship`.
   - Signs build provenance with `actions/attest-build-provenance`, submits the release to `https://releases.emdashcms.com` via `emdash-cms/emdash/apps/release-action`, and verifies the publisher PDS release record (`verify-registry-release.mjs`).

## Step 3: Run Beta Store `@running` Journeys

Cut beta starts them itself. Once the beta is published, Release's **Start the live journeys on the beta store** job presses **Live journeys** in [SaariusSkills](https://github.com/saariuslystoned/SaariusSkills/actions/workflows/live-journeys.yml) with `beta: dinkus-ship-beta X.Y.Z-beta.N`. That run waits for the Registry to offer the beta, updates the beta store (beta.sm0ky.dev, `installedPluginId: r_nhb4yqdnowdmkxyu`) to it in place, and runs the `@running` journeys there; for Ship that is "Buy a label in the store admin". Its run is named `Live journeys for dinkus-ship-beta X.Y.Z-beta.N`, and its page shows each journey's pass or fail and the plugin versions tested. When it passes, Step 4's `proof_ref` is that run's address followed by the beta version, for example `https://github.com/saariuslystoned/SaariusSkills/actions/runs/<run id> (X.Y.Z-beta.N @running pass)`; the address alone has no version in it, and the promotion gate refuses a proof that doesn't name the beta. If an update asks for new permissions the run stops and its page says what was asked; update the plugin by hand from the store's Plugins page, then press Run workflow again with the same `beta`.

The press needs the `LIVE_JOURNEYS_TOKEN` repository secret: a fine-grained GitHub token whose only access is **Actions: Read and write** on `saariuslystoned/SaariusSkills`. Without it the job fails after the publish, and the journeys can be started by hand with the same `beta` input.

## Step 4: Promote Verified Beta to a `ci: release` PR

Once `dinkus-ship-beta@X.Y.Z-beta.N` has passed the beta-store `@running` journeys:

1. Press **Run workflow** on **Release** (`.github/workflows/release.yml`) on `main` with `action: promote` and:
   - `beta_version`: `X.Y.Z-beta.N` (e.g. `0.1.1-beta.1`)
   - `proof_ref`: the recorded `@running` pass proof reference naming `X.Y.Z-beta.N`
2. The promotion gate verifies that:
   - `vX.Y.Z-beta.N` exists and points to the current `main` HEAD (no new changesets or commits landed on `main` after the beta was cut; if `main` advanced, cut and verify `beta.(N+1)` first).
   - `dinkus-ship-beta@X.Y.Z-beta.N` is published in the EmDash Registry (failing closed on Registry HTTP/network/malformed errors).
   - `proof_ref` names `X.Y.Z-beta.N`.
3. The workflow runs `npm run release:version` (`changeset version` + `npm install --package-lock-only --ignore-scripts`) and opens/updates the `ci: release vX.Y.Z` pull request from `changeset-release/main` with a `Release-Beta-Proof:` trailer binding the beta version, commit SHA, and proof reference. The version lives in `package.json` only; `emdash-plugin.jsonc` carries no `version`, so the release PR touches nothing but `package.json`, `package-lock.json`, `CHANGELOG.md` and the folded changesets.

## Step 5: Review and Merge `ci: release` PR to Publish Stable

1. Run `@clawsweeper review` on the `ci: release vX.Y.Z` PR.
2. When Ryan merges the `ci: release vX.Y.Z` PR into `main`, `.github/workflows/release.yml` runs on the `push` to `main`:
   - Verifies the `Release-Beta-Proof:` record, enforces that `git diff --name-only v<betaVersion> HEAD` contains only `package.json`, `package-lock.json`, `CHANGELOG.md`, and `.changeset/*.md`, and semantically verifies that `package.json` and `package-lock.json` only updated the package's own `version` field (`X.Y.Z`). Any source, workflow, dependency, script, or lockfile resolution modification since the approved beta tag aborts before tagging or publishing.
   - Creates and pushes git tag `vX.Y.Z` (or resumes cleanly if `vX.Y.Z` already exists on `HEAD` from a prior partial run).
   - Creates the GitHub Release for `vX.Y.Z` from the matching `CHANGELOG.md` section if not yet created.
   - Delegates to `.github/workflows/emdash-release.yml` via `workflow_call` (which retains caller `github.event_name == 'push'` on `refs/heads/main` and passes `release_mode: stable` plus `version`) to prepare the bundle, attest and publish `dinkus-ship@X.Y.Z` (`r_ehdlg5cxkb3ffqvr`) through the EmDash delegated release service when the Registry does not index it yet, and verify the Registry record against the bundle either way, so a re-run after a failed check cannot pass without it.

Never hand-push a tag and never publish by hand. If tagging succeeded but Registry publication failed, re-run the failed Release run on `main`: the publish job resumes from the existing tag and the Registry job verifies the record.

## Publish signal (known upstream issue)

As in Commerce and Payments: the delegated release service currently ends successful
publishes in `RELEASE_CONFLICT`
([emdash#4159](https://github.com/emdash-cms/emdash/issues/4159)), so the
publish job trusts `verify-registry-release.mjs`, which reads the publisher
PDS record and passes only when it carries exactly the bundle prepared in the
same run. Remove the `continue-on-error` gate swap once the upstream issue is
fixed.
