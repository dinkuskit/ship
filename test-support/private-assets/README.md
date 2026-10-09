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

See the [upstream issue draft](../../docs/decisions/upstream-private-assets-issue-draft.md)
and [qualification proof](../../.grilltrack/proof/private-asset-qualification-20261008.md).

The optional `--provider-link` mode also bundles Ship's sandbox-pure provider
link helper, seeds a synthetic stored operation through a fixture-only private
route, and verifies its Block Kit response, authorization denials and expiry.
`--provider-link --serve` holds the owned local host for browser inspection;
enter a line to stop it. The PB-shaped URL is deliberately inert and must not be
used as live provider evidence. This fixture never binds real Commerce or Ship
provider authority. It remains unsigned seeded install state with dev-bypass.
