# Installed Ship journey setup

This is reusable setup for the forthcoming paid-order label journey. It packs
Ship with lifecycle scripts disabled, installs that tarball, resolves its
advertised package export, compares all installed bytes with the unpacked
artifact, and supplies disposable pinned EmDash 1.2.0 host preparation.

Run the focused package checks:

```sh
node --test test/ship-journey/installed-package.test.js
```

Run the required **setup-only** host install and local database initialization:

```sh
node scripts/verify-ship-journey.mjs --setup
```

`--setup` explicitly enables the host test. Ordinary Node tests skip that large
dependency install. Dependencies come from npm; no provider request, credential,
account, Registry operation, or server launch occurs. Disposable directory
cleanup is limited to directories created by the invoking process.

Without `--setup`, the command exits **2** with `JOURNEY_GATE=blocked`, even when
package checks pass. Successful setup is not successful journey coverage.
The paid-order tenant checks, confirmation, concurrent buy/retry, unknown
reconciliation, same-label PDF/reprint, and actual EmDash desktop/mobile UI
remain dependent on the workflow factory exports and tested route schema.
No production Commerce port, atomic storage, provider, physical print,
delivery, or Registry integration is established by these helpers.

Future installed proof must inject synthetic host-bound ports into the same
packaged workflow through a test-only standard entry. The packaged default's
absent-port denial must be checked separately. Fixture ports and transport must
remain explicitly labeled and must never be production selectors.
