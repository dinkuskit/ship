# Registry artifact verification — 2026-10-08

Scope: official packaging of existing Ship settings and explicit synthetic
package review. Base: `0bafd8cfa3d9cb1e4d09cb32ba46d48bf8b0dd35`.
Branch: `codex/ship-registry-artifact-20261008`.

## Implementation

`src/plugin.ts` imports the existing tested sandbox implementation instead of
maintaining a second UI. The official CLI generates the backend and route,
storage and page metadata. The manifest preserves Order detail and Shipping
routes, adds the already supported explicit proof page, and removes the
unimplemented journey page. npm root/subpath exports remain unchanged.

Publisher `did:plc:ekk4pjmkh3k3ql2kfoex3qt4` reuses public DinkusKit metadata
from Commerce manifest blob `fe1b1ffaeae614b8f1110e425384204f91f4ef8b`.
That is package authorship, not merchant authentication.

## Artifact and installed runtime

- Official `@emdash-cms/plugin-cli@0.13.3` `bundlePlugin`; plugin types 0.6.0.
- Exact verified artifact SHA-256: `4bd0fea6d821f7f73d4fb902e9cacf1061782f1eeb5aff8a9a906a4e37043e07`; 11046 bytes.
- Backend SHA-256: `90f89e8e99296c2e1956e6a1942ed7add9a3913f4b16adb2dc2704afccac7c62`; 18,644 / 131,072 bytes.
- Extracted total: 30,437 / 262,144 bytes; 3 / 20 files. All files individually
  checked; generated metadata matches declared storage, pages and private routes.
- Fresh EmDash 1.2.0 / workerd host has no npm Ship package and no configured
  sandbox entry. Seeded unsigned post-install state and exact emitted backend
  load through the real Registry-source cold-start path at
  `r_s65tejzisv5mwadb`. Only the manifest ID receives the install-time rewrite.
- Shared HTTP behavior checks pass: origin create/edit/reload, invalid-origin
  preservation, settings and package persistence, status privacy, English,
  Arabic/RTL, unsupported-locale fallback and explicit fixture boundaries.
- Anonymous routes deny with 401; reduced-role private routes deny with 403.
  Synthetic role restored. Origin survives process restart without reseeding.
- Chrome UI: synthetic city saved as `Browser Proof City` and verified after
  reload; normal Orders shows unavailable Commerce; explicit package navigation
  shows persisted 3.5 lb dimensions with provider/quote/label gates intact.
  Visible screenshot and DOM evidence were captured in the owning review chat.

## Reproducible gates

`npm ci --ignore-scripts --no-audit --no-fund`, `bin/verify-ship full`,
`npm run verify:registry`, and `actionlint -shellcheck='' -pyflakes=''` pass.
The 83 Node tests report 80 passed and 3 intentional opt-in skips. Full adds
npm package dry-run and official bundle checks; CI installs locked dependencies
and runs the bundle check. Build uses ordinary Node 24.16.0 locally.

Ignored local evidence: `runs/ship-registry-artifact-runs/20261008/` and
`runs/registry-artifact-f5Bl2s/` (final artifact, receipt and host log);
`runs/registry-artifact-xcGeZy/` retains the identical-backend browser fixture.

## Limits and review

The local post-install fixture does not prove Registry signatures, publication,
install-consent or a public listing. No provider request, real order, postage
purchase, PDF, printing, merchant authentication or cross-plugin transport is
added. Native asset/provider/workflow sources and Commerce/Inventory are
unchanged. Merge, publication, deployment and provider activation remain human
gates. Independent canonical review completed as recorded below.


## Accepted review findings

Canonical Codex P0–P3 review of `9ecba6e14f831c3b50238436a22cb8ec9ac7517b`
found two P2 defects, both accepted and corrected:

1. Restored the legacy verifier shebang to line one. All verification scripts
   now pass `node --check`; both full and CI gates include these syntax checks.
   Legacy package installation succeeds and reports the expected missing-runner
   gate when intentionally invoked without a host.
2. Added SIGINT/SIGTERM cleanup for the Registry verifier’s owned process group.
   An actual interrupted fresh host exited with 143 after SIGTERM; probing its
   process group confirmed it was gone. The normal Registry behavior/restart
   proof also passed again after the fix.

No finding was rejected or deferred. No review finding changed product scope.


## Canonical review

Canonical Codex P0–P3 review of
`b0af506b210a954e06f6d74044e3ad411795b376` returned **scoped-clean**:
no actionable findings. The two earlier findings are fixed and verified.
The reviewer assessed source and supplied proof; execution proof belongs to
this task's recorded commands. A final review also covers this metadata update
before the PR is marked ready. Native review and maintainer merge are separate.
