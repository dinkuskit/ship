# Releasing the Ship plugin

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack `release-changesets-061` onward; the cadence is `release-beta-cadence-078` and the release branches `release-branches-079`). This file
is the per-repo operating summary. The release files are Payments' (`dinkuskit/payments`),
copied with only the package names and repository constants changed, so Payments,
Commerce and Ship all release the same way: Changesets plus a dedicated beta EmDash
Registry slug, so every release is proven in a real EmDash beta store before stable
publication. The model is OpenClaw's release process: betas and stable releases come from a
`release/X.Y.Z` branch, so `main` never waits for a beta.

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
- All release buttons are on **Release** (`.github/workflows/release.yml`), pressed on `main`: `action: cut-beta`, `add-fix` and `promote`. A button run never publishes; it pushes a version tag, and that tag's run publishes (`vX.Y.Z-beta.N` to `dinkus-ship-beta`, `vX.Y.Z` to `dinkus-ship`). `.github/workflows/emdash-release.yml` is a `workflow_call`-only helper that only the tag run calls. There is no `.changeset/pre.json`, and a beta is never versioned on `main`.

## Delegated Registry Publishing (No Stored PDS Credentials)

Registry publishing uses GitHub OIDC, Sigstore build provenance (`actions/attest-build-provenance`), and the EmDash delegated release service (`emdash-cms/emdash/apps/release-action` targeting `https://releases.emdashcms.com`), so no Atmosphere/PDS handle or app-password secret is stored in this repository.

1. `.github/scripts/prepare-emdash-release.mjs` copies the built sandbox bundle (`dist/plugin.mjs`) into an isolated temporary directory as its only source file, with a manifest whose slug and display name are rewritten for a beta (`dinkus-ship-beta`, `Ship Beta`) and kept for a stable release, and invokes the official `emdash-plugin release prepare <slug@version>` command there, producing `.emdash-release/<slug>-<version>.tar.gz` plus the `publisher-did`, `bundle-file`, and `selector` outputs. Code and declared access are byte-identical between a beta and the stable build from the same commit; the hosted service under `service/` never reaches the bundle.
2. `actions/attest-build-provenance` signs build provenance over the prepared bundle tarball (`id-token: write`, `attestations: write`).
3. `emdash-cms/emdash/apps/release-action` submits the bundle and provenance to `https://releases.emdashcms.com` for `publisher-did` (`did:plc:ekk4pjmkh3k3ql2kfoex3qt4`).
4. Because the delegated release service can currently end successful publishes in `RELEASE_CONFLICT` ([`emdash-cms/emdash#4159`](https://github.com/emdash-cms/emdash/issues/4159)), the publish step uses `continue-on-error: true` and `.github/scripts/verify-registry-release.mjs` acts as the fail-closed gate by resolving the publisher PDS endpoint directly and verifying that the `com.emdashcms.experimental.package.release` record for `<slug>:<version>` carries the exact multihash checksum and byte size of the prepared tarball.

### One-time setup still required (owner)

- The release GitHub App credentials for this repository (`RELEASE_APP_ID` and
  `RELEASE_APP_PRIVATE_KEY` repository secrets), as for Commerce and Payments.
- The `DINKUS_LIVE_JOURNEYS_TOKEN` dinkuskit org secret (Step 3).
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
- In the [EmDash release-service publisher dashboard](https://releases.emdashcms.com/publisher), choose **Authorize publishing** for `dinkus-ship-beta` (and `dinkus-ship` if not already authorized), then approve the `dinkuskit/ship` `.github/workflows/release.yml` workflow connection when the dashboard first asks. Every button lives on `release.yml`, and `.github/workflows/emdash-release.yml` is only ever called from it, so one connection covers both listings. A connection made earlier through `emdash-release.yml` (from before Cut beta moved to `release.yml`) is no longer used. The dashboard shows a pending connection only while a run's publish step is waiting for it, for up to 30 minutes. If that time runs out, press **Run workflow** with **Use workflow from** set to the version tag and `action: retry-publish`; don't re-run the old run, which reuses its expired request and fails with `WORKFLOW_CONNECTION_CONFLICT`. The connection was first approved for runs on `refs/heads/main`; publishes now run from version tags, so the first tag run asks again. Approve it for version tags (`refs/tags/*`).
- A repository ruleset on `release/*` branches and `v*` tags that lets only the release GitHub App push, create or delete them.

Approvals are only requested when a release expands plugin permissions.

## Step 1: Every PR Includes a Changeset

Every pull request targeting `main` (except automated `ci: release` PRs on `changeset-release/main`) must add at least one `.changeset/*.md` file:

```bash
npm run changeset
```

On 0.x, choose `patch` for fixes and `minor` for everything else; `changeset-check.yml` (`.github/scripts/check-changeset.mjs`) rejects a missing changeset and any `major` bump. For documentation, tests, CI, or hosted-service-only changes that should not bump the package version, create an explicit empty changeset (`npx changeset --empty`), which produces a `.changeset/*.md` file with empty frontmatter (`---\n---`) that satisfies the check and is excluded from version bump calculation.

## When to Cut a Beta

(`release-beta-cadence-078`.) Press Cut beta when a batch is worth giving a store: a finished feature, or a fix a store owner would notice. There is no calendar. Ordinary PRs merge to `main` with their changesets and ship nothing on their own. Docs, tests and CI-only changes never get a beta, and Cut beta refuses when nothing version-bumping has merged since the last release. One release is on test at a time: Cut beta refuses while an earlier `release/X.Y.Z` has no `vX.Y.Z` tag yet, and so does Add fix to beta when it would start a patch branch. Every change, including a fix for a beta on test, is a normal PR to `main` that ClawSweeper reviews; no PR ever targets a release branch.

## Step 2: Cut Beta (`dinkus-ship-beta`)

Press **Run workflow** on **Release** with `action: cut-beta` (leave `beta_version` blank to auto-compute the next `X.Y.Z-beta.N`, or supply an explicit one).

- `X.Y.Z` is the version `main`'s pending changesets would release; `N` is one more than the highest `vX.Y.Z-beta.*` git tag or `dinkus-ship-beta` release record on the manifest publisher's PDS. This reads every page of the public `com.atproto.repo.listRecords` inventory, including versions not yet visible in the discovery catalog, and fails closed on lookup, identity, schema, or pagination errors.
- It checks the version stays on 0.x (`.github/scripts/check-no-major.mjs`; a computed or given `1.0.0` or higher is refused), runs the unit tests, typecheck and build, creates `release/X.Y.Z` at `main`'s newest commit, and tags `vX.Y.Z-beta.N` there with the release GitHub App token (`RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY`). `main` keeps taking merges from here on; they wait for the next release.
- The tag's run checks that the tag sits on `release/X.Y.Z`, then calls `.github/workflows/emdash-release.yml` with `release_mode: beta`. Its gate (`.github/scripts/emdash-dispatch-gate.mjs`, `validateEmDashDispatchGate`) allows only a `refs/tags/vX.Y.Z[-beta.N]` ref whose version and mode match, before any Registry I/O. It prepares `.emdash-release/dinkus-ship-beta-X.Y.Z-beta.N.tar.gz` via `emdash-plugin release prepare` with `slug: "dinkus-ship-beta"`, `name: "Ship Beta"` and `version: "X.Y.Z-beta.N"`, signs build provenance, submits the release to `https://releases.emdashcms.com`, and verifies the publisher PDS release record (`verify-registry-release.mjs`).

## Step 3: Run Beta Store `@running` Journeys

The beta tag's run starts them itself. Once the beta is published, its **Start the live journeys on the beta store** job presses **Live journeys** in [dinkuskit/live-journeys](https://github.com/dinkuskit/live-journeys/actions/workflows/live-journeys.yml) with `beta: dinkus-ship-beta X.Y.Z-beta.N`. That run waits for the Registry to offer the beta, updates the beta store (beta.sm0ky.dev, `installedPluginId: r_nhb4yqdnowdmkxyu`) to it in place, and runs the `@running` journeys there; for Ship that includes "Buy a label in the store admin". Its run is named `Live journeys for dinkus-ship-beta X.Y.Z-beta.N`, and its page shows each journey's pass or fail and the plugin versions tested. When it passes, Step 5's `proof_ref` is that run's address followed by the beta version, for example `https://github.com/dinkuskit/live-journeys/actions/runs/<run id> (X.Y.Z-beta.N @running pass)`; the address alone has no version in it, and the promotion gate refuses a proof that doesn't name the beta. If an update asks for new permissions the run stops and its page says what was asked; update the plugin by hand from the store's Plugins page, then press Run workflow again with the same `beta`.

The press needs the `DINKUS_LIVE_JOURNEYS_TOKEN` org secret, shared by every dinkuskit plugin repo: a fine-grained GitHub token owned by dinkuskit whose only access is **Actions: Read and write** on `dinkuskit/live-journeys`. Without it the job fails after the publish, and the journeys can be started by hand with the same `beta` input.

## Step 4: A Fix Found on the Beta (Add Fix to Beta)

Merge the fix to `main` through its normal reviewed PR. Then press **Run workflow** with `action: add-fix`, `release_version: X.Y.Z`, and `fix_commit` set to the fix's merge commit on `main`. It copies that exact commit onto `release/X.Y.Z` (`git cherry-pick -x`, so the copy names its source) and tags the next `vX.Y.Z-beta.N`, whose run publishes it and starts the journeys again. It refuses a commit that isn't on `main`, one already on the branch, and one that doesn't copy cleanly; then nothing is pushed. A release-file fix is copied the same way, so the branch runs it too.

## Step 5: Promote Verified Beta to a `ci: release` PR

Once the newest beta on `release/X.Y.Z` has passed the beta-store `@running` journeys, press **Run workflow** with `action: promote`, `beta_version: X.Y.Z-beta.N` and `proof_ref` (the recorded `@running` pass naming `X.Y.Z-beta.N`). The gate verifies that `vX.Y.Z-beta.N` is the tip of `release/X.Y.Z` (if a fix was added since, promote that newer beta once it passes), that `vX.Y.Z` is not released yet, and that `dinkus-ship-beta@X.Y.Z-beta.N` is in the EmDash Registry (failing closed on Registry errors). It then runs `npm run release:version` (`changeset version`, then `scripts/sync-lock-version.mjs` copies the new version into `package-lock.json` and changes nothing else) on the branch, refuses if the branch's changesets make a different version, and opens or updates the one `ci: release vX.Y.Z` pull request to `main` from `changeset-release/main`. That PR carries only the version, the `X.Y.Z` CHANGELOG section and the removal of the changesets that release used, with a `Release-Beta-Proof:` trailer binding the beta version, commit SHA and proof. Changesets merged to `main` after the cut stay pending for the next release.

## Step 6: Review and Merge `ci: release` PR to Publish Stable

1. Run `@clawsweeper review` on the `ci: release vX.Y.Z` PR.
2. When Ronald merges it into `main` (squash or merge commit), Release runs on the `push` to `main`. It writes the same version, CHANGELOG section and changeset removals onto `release/X.Y.Z` and refuses to tag unless the branch then differs from the approved beta tag only in `package.json`, `package-lock.json`, `CHANGELOG.md` and `.changeset/*.md`, with `package.json` and `package-lock.json` changing only the package's own `version`; `emdash-plugin.jsonc` carries no `version`, so it never changes. Then it tags `vX.Y.Z` on the branch. If the run stops after committing onto the branch but before the tag, re-run it: it resumes from that commit.
3. The `vX.Y.Z` tag's run checks the same thing again, creates the GitHub Release from the matching `CHANGELOG.md` section if missing, and calls `.github/workflows/emdash-release.yml` with `release_mode: stable` to prepare, attest and publish `dinkus-ship@X.Y.Z` (`r_ehdlg5cxkb3ffqvr`) when the Registry does not index it yet, and verify the Registry record against the bundle either way. If a tag run fails, re-run it or press **Run workflow** with **Use workflow from** set to the tag and `action: retry-publish`.

## A Bug in a Released Version

Merge the fix to `main`, then press **Run workflow** with `action: add-fix`, `release_version` set to the next patch (`X.Y.(Z+1)`) and `fix_commit` set to the fix's merge commit. With no `release/X.Y.(Z+1)` yet, it makes that patch branch from the `vX.Y.Z` tag, copies the fix and tags `X.Y.(Z+1)-beta.1`. Journeys, then Promote and the release PR as above. A patch branch takes only patch changesets; Promote refuses one whose changesets make a minor release. Patch branches work for versions released through release branches; a fix for an earlier release ships in the next release from `main`.

Never hand-push a tag and never publish by hand.

## Publish signal (known upstream issue)

As in Commerce and Payments: the delegated release service currently ends successful
publishes in `RELEASE_CONFLICT`
([emdash#4159](https://github.com/emdash-cms/emdash/issues/4159)), so the
publish job trusts `verify-registry-release.mjs`, which reads the publisher
PDS record and passes only when it carries exactly the bundle prepared in the
same run. Remove the `continue-on-error` gate swap once the upstream issue is
fixed.
