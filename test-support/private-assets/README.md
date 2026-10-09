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
