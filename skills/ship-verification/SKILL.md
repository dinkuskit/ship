---
name: ship-verification
description: Verify Ship's deterministic sandbox package and explicitly gated installed-host proof.
---

# Ship verification

The default gate has no external provider or credential prerequisite. Use Node
with the built-in test runner and fetch support; the tests inject fake transport
and use task-owned loopback servers and disposable storage.

```sh
bin/verify-ship quick
bin/verify-ship full
```

`quick` (the default) runs all Node tests: private package routes, Block Kit
settings persistence, attested locale/RTL, isolated order fixtures, package
validation, operation idempotency and unknown outcomes, loopback HTTP guards,
and sandbox transport/PDF restrictions. `full` adds a package dry-run and the official offline bundle check.
A dry-run or bundle check is not installed sandbox execution.

## Official Registry artifact

Use Homebrew Node 24 for the official rolldown toolchain:

```sh
PATH=/opt/homebrew/Cellar/node@24/24.16.0/bin:$PATH npm run build
PATH=/opt/homebrew/Cellar/node@24/24.16.0/bin:$PATH npm run verify:registry
```

`verify:registry` calls the published `bundlePlugin` API, records the emitted
tarball byte count and SHA-256, and rejects the official caps of 131072 bytes
per backend file, 262144 bytes total, and 20 files. It checks the generated
manifest/backend in a disposable local `registry/<id>/<version>` storage
prefix, loads it through EmDash’s Registry-source cold start, and runs the
shared behavior checks including denial and restart persistence. No npm Ship
entry is installed in that host. The seeded local state is explicitly unsigned
and does not prove Registry signatures, install consent or publication.
`npm run verify:bundle` performs only offline artifact checks. The emitted
artifact, file inventory and host receipt are retained under the reported
ignored run directory.

Both modes resolve the repository from the script path. Success exits 0 and
prints `verify-ship: <mode> passed`; unsupported modes exit 64. Child failures
stop the gate. Keep complete output, fix the first failing contract, and rerun.

## Installed sandbox proof

`bin/verify-ship sandbox` adds the existing `verify:sandbox` script after full.
Prepare a disposable host using the README's local sandbox procedure. Supply
`EMDASH_SANDBOX_RUNNER_MODULE`, `EMDASH_SANDBOX_HOST_DIR`, and the HTTP loopback
`EMDASH_SANDBOX_HOST_URL` described there. This mode checks fresh packed bytes
against the host installation, authorization denial, private admin dispatch,
settings/package persistence, and locale behavior. It changes only disposable
host settings. Without a supported runner it exits 2 and reports
`SANDBOX_GATE=blocked`; do not convert that into a pass.

The origin checks cover create/edit/reload, invalid-input preservation and
status privacy. Set `EMDASH_SANDBOX_PERMISSION_PROOF=1` only for a task-owned
host under this repository's ignored `runs/` directory. That focused check
temporarily lowers the synthetic development user's role, requires HTTP 403
for private routes, restores the original administrator role in `finally`,
and checks that denied writes preserved the saved origin. Without that opt-in,
the verifier prints `insufficient_role_denial=not_run`.

Current host pins and migration limitations live in README and the dated
EmDash migration proof. Tests do not establish signed Registry installation,
Commerce integration, live Pitney Bowes calls, postage purchase, printing, or
production readiness. Never inject credentials or contact a provider to run
the default verification gate.
