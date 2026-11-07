# Reuse the quick job's plugin build

Base: `c14d5dfb2720222990879d703e5d03f554893763`.

## Change

The CI Registry-plugin job installed dependencies and built the plugin again
for dry release preparation. The Repository-contract job already installs and
builds that plugin through `bin/verify-ship quick`.

The candidate moves the existing script-syntax loop before quick and the
existing dry preparation after quick in that same job. It removes the duplicate
CI plugin job. The required `bin/verify-ship quick` job name, permissions,
events, concurrency and timeout remain unchanged. The separate workflow
validation and hosted-service jobs are unchanged. A syntax, quick or dry
preparation failure fails the required job.

No verifier, test, package pin, service configuration or release workflow changes.
No cross-run cache or artifact handoff is introduced. The empty changeset
requests no version bump. Docs impact: not applicable, internal CI only.

## Build reuse proof

At the base source on Node 24.22.0 with the locked dependencies:

```sh
npm run build
# Snapshot source/config inputs and the complete dist tree.
node --test tests/*.test.mjs
# Repeat the snapshot.
node .github/scripts/prepare-emdash-release.mjs --out-dir .emdash-release
# Repeat the snapshot again.
```

All 67 Node cases passed, including all 15 release-authority scenarios. All
three snapshots matched: five output files, including paths, types, modes,
sizes and content; and tracked source/config inputs. An opaque project config
was bound through its unchanged Git blob/mode and clean status, without reading
its contents. The first inventory attempt refused that path and was retained;
it was not counted as a successful proof.

- Complete `dist` SHA-256: `eb58dd47b58479d4b2d7d869ab8e787f0c6148b0cb15152006c969d122fc247a`
- Input inventory SHA-256: `0e455f94677f556a9435bad2081f43653eb820fc37a27b79911b8b08811a492e`

The real dry preparation produced the Registry tarball from those unchanged
outputs. Existing preparation checks still reject missing or mismatched builds.

## Validation and pending measurement

`bin/verify-ship full` passed after the workflow edits: 67 Node cases, 86 service
cases, feature-map validation, typechecking, plugin size checks, both service
dry builds, dry Registry preparation and release-authority proof. Both actual
deployment bundles passed raw startup/SQLite checks with `outboundExceptJwks: 0`.
The capture elapsed was 59.203 seconds; this validates behavior and is not a CI
speed comparison because the local full command is unchanged.

The copied syntax loop passed. Parsed workflow comparison confirmed that only
the duplicate job and the two moved steps changed; other jobs and workflow
controls match the base. Exact pinned actionlint remains a hosted check; no
local binary was available.

Hosted B,C,C,B qualification remains pending. Require at least 15 seconds and
20% lower median summed allocated job time across CI and Repository contract,
with combined completion time regressing no more than `max(2 seconds, 5%)`.
Retain all test identities and failures. Queue, job allocation, elapsed time and
any billing claim are separate; no measured CI or monetary saving is claimed yet.
