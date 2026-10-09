# Private asset reproduction

Run `npm ci --ignore-scripts --no-audit --no-fund` then
`npm run verify:private-assets` at repository root (Node >=22.16, npm and Python 3).
The runner installs public dependencies, builds this fixture using the official
plugin CLI and creates a unique disposable loopback EmDash 1.2.0/workerd host.
It preserves every run under `runs/private-asset-qualification-runs/probe-*`.
A nonzero exit means the reproduction did not qualify; inspect its receipt or
failure before drawing conclusions. No automatic cleanup deletes earlier runs.

It tests a valid deterministic private PDF through actual sandbox dispatch,
repeated exact bytes, security headers, and missing-session/header denials.
It does not publish or install from a signed Registry, use normal sign-in,
launch a browser, implement a viewer, or call a shipping provider. The host
seeds unsigned post-install state and uses local dev-bypass authentication.
The fixture is excluded from the production Ship package.

For the separate local Registry installation and normal-auth qualification,
run `npm run verify:local-registry-auth` after `npm ci --ignore-scripts`.
It builds this fixture through the official CLI, initializes a fresh local
EmDash 1.2.0 database, and drives registration and login through Chromium's
virtual WebAuthn authenticator. It exercises Registry verification, capability
consent and installation instead of seeding `_plugin_state`. It then checks
visible/expired provider links and denial after logout. Browser requests are
restricted to the two owned loopback origins; the PB-shaped URL is never opened.

Results, screenshots, version pins and artifact checksums are written under
`runs/local-registry-auth-runs/run-*`. A failed step exits nonzero. The host uses
EmDash's published `internal/testing/registry` hook for local authoritative
records and an optional-provenance fixture policy. This verifies local Registry
conformance, checksum validation and installation, not live PDS authority,
cryptographic publisher provenance or public Registry publication. Virtual
WebAuthn proves the normal session path, not a physical passkey device.
See [the follow-up proof](../../.grilltrack/proof/local-registry-auth-20261009.md).

See the [upstream issue draft](../../docs/decisions/upstream-private-assets-issue-draft.md)
and [qualification proof](../../.grilltrack/proof/private-asset-qualification-20261008.md).

The optional `--provider-link` mode also bundles Ship's sandbox-pure provider
link helper, seeds a synthetic stored operation through a fixture-only private
route, and verifies its Block Kit response, authorization denials and expiry.
`--provider-link --serve` holds the owned local host for browser inspection;
enter a line to stop it. The PB-shaped URL is deliberately inert and must not be
used as live provider evidence. This fixture never binds real Commerce or Ship
provider authority. That original `--provider-link` runner uses unsigned seeded install state and dev-bypass; the separate local Registry runner above does not.
