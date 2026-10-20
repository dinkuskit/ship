# Releasing the Ship plugin

The authoritative plan lives in
[`dinkuskit/dinkuskit` `docs/plans/release-process.md`](https://github.com/dinkuskit/dinkuskit/blob/main/docs/plans/release-process.md)
(GrillTrack `release-changesets-061` through `release-beta-cut-071`). This file
is the per-repo operating summary; the release files are Commerce's, copied
with only the package names changed, as `release-beta-cut-071` asks.

Only the plugin at the repository root is released this way. The hosted
service under `service/` is deployed to ship.dinkuskit.com from Ronald's Mac on
his typed go, never by a workflow.

## Day to day

1. Every pull request adds a changeset: `npm run changeset` for a change to
   the plugin, `npx changeset --empty` for docs, tests, CI or the hosted
   service only. On 0.x, bug fixes are `patch` and everything else is
   `minor`. CI (`changeset-check.yml`) rejects a missing changeset and any
   `major` bump.
2. Merging to `main` makes the release bot open or update the `ci: release`
   pull request. It bumps `package.json`, syncs `emdash-plugin.jsonc`, and
   writes `CHANGELOG.md`.
3. Review the release PR like any other (ClawSweeper exact-head gate
   applies: comment `@clawsweeper review`). **Merging it is the publish
   yes**: the publish job creates the `vX.Y.Z` tag and the GitHub Release,
   then `.github/workflows/emdash-release.yml` publishes the same version to
   the EmDash Registry through the delegated release service.
4. Never hand-push a tag and never publish by hand. If tagging succeeded but
   Registry publication failed, run the Release workflow on `main` with
   **publish-only** checked after the necessary source repair is reviewed.

The supported Registry-only recovery command is:

```sh
gh workflow run release.yml --repo dinkuskit/ship --ref main -f publish-only=true
```

## Beta status

**Ship is on stable releases**: `dinkus-ship@0.1.0` is the first final
(ship#52), so `.changeset/pre.json` is gone and the next `ci: release` PR
proposes the next `x.y.z` for `dinkus-ship`. Betas ran first (`0.1.0-beta.N`
on `dinkus-ship-beta`) until every Running journey passed on the beta store.
`tests/release.test.mjs` proves the next version routes to `dinkus-ship`. A
later beta cycle starts with `npx changeset pre enter beta`, and its final
leaves pre mode again with `npx changeset pre exit` before the release PR.

A prerelease version (`x.y.z-beta.N`) publishes under the separate
`dinkus-ship-beta` Registry package, never under `dinkus-ship`: the Registry
has no prerelease filter, so a beta under the real name would become the
latest version for every store. `scripts/prepare-emdash-release.mjs` rewrites
only the slug and display name for a beta; code and declared access are
byte-identical to the stable build. `scripts/release-selector.mjs` prints the
selector for the checkout's version the way the publish routes it, so CI's dry
preparation and `bin/verify-ship full` check a beta version as it is published. One beta store runs every plugin's newest
beta; the journey "Buy a label in the store admin" must pass there before a
final release.

## One-time setup still required (owner)

- Create the release GitHub App credentials for this repository
  (`RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` repository secrets), as for
  Commerce.
- In the [release-service dashboard](https://releases.emdashcms.com/publisher),
  choose **Authorize publishing** for the `dinkus-ship` and `dinkus-ship-beta`
  package profiles, then approve this repository's workflow connection on its
  first run.

Registry publishing uses GitHub OIDC and the delegated release service, so no
Atmosphere credential is stored in this repository. Approvals are only
requested when a release expands plugin permissions.

## Publish signal (known upstream issue)

As in Commerce: the delegated release service currently ends successful
publishes in `RELEASE_CONFLICT`
([emdash#4159](https://github.com/emdash-cms/emdash/issues/4159)), so the
publish job trusts `verify-registry-release.mjs`, which reads the publisher
PDS record and passes only when it carries exactly the bundle prepared in the
same run. Remove the `continue-on-error` gate swap once the upstream issue is
fixed.
