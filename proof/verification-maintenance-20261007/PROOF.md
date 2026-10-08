# Verification maintenance proof — 2026-10-07

Repository: `dinkuskit/ship`. Base: `9e5af740849a840d5229b84765b1aeabd68994bb`.
Branch: `codex/verification-maintenance-20261007`.
Isolated worktree: `ship-verification-20261007` alongside the main checkout.

Added the canonical verifier and local skill with deterministic quick/full and explicit installed-host sandbox mode.

Command: `../bin/verify-ship full (from docs/)`. PASS: 29 deterministic tests and npm package dry-run. Installed sandbox mode was not run; it requires a disposable host.

Raw output is retained locally in ignored `runs/verification-maintenance-runs/20261007/full.log`.
Invalid mode rejection matched the documented status. `git diff --check` passed.
Relative invocation and child failure propagation were smoke-tested with a temporary npm stub: every command ran in the owned repository, child exit 23 was preserved, and no success message appeared on failure.

Accepted maintenance findings are reflected in the skill/script changes.
Production/Registry compatibility claims were rejected: these local gates do
not prove live provider traffic, deployment, postage purchase or publishing.
No product decision or GrillTrack ledger was changed.
