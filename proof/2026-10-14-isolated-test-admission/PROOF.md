# Isolated Ship sandbox admission — source proof

Date: 2026-10-14. Owner: Ship source lane. Repository: dinkuskit/ship.
Branch: codex/ship-isolated-test-admission-20261014.
Fresh base: fbb437bdd865258940b5dce16c431ae19cb71ede.
Candidate identity is the commit containing this file and the PR's exact head;
external review evidence must match that immutable base/head pair.

## Result

Source implementation and deterministic local verification passed. No merge,
deploy, DNS/resource creation, grant, runtime config, secret operation, browser
operation, order/payment/label action or email was performed for this slice.

- `cd service && npm run typecheck`: passed on Node 22.
- `cd service && npm test`: 64 tests passed in four files, workerd/SQLite DO runtime.
- `cd service && npm run build`: passed, Wrangler dry run only.
- `cd service && npm run build:sandbox`: passed, separate config dry run only.
- `npm test`: 90 passed, three pre-existing opt-in skips, zero failures.
- `npm run verify:bundle`: passed; artifact SHA-256
  `731c455601e7e94261d7f8110ad9c462270cdb5a363d79f3557a2bb6ec955557`,
  11450 bytes; backend 18644 bytes; total 31042 bytes; three files.
- `git diff --check`: passed.

The new isolation cases prove matching signed claims/header admission,
legacy rejection of additive claims, protected-ID/foreign-ID/nonTEST denial,
empty admission, no state writes on rejected intake, scoped events/receipts and
acknowledgements, stale code/session/refresh refusal, populated legacy storage
and stale-generation refusal, owner HTML use of verified deployment admission,
and zero email queue/sends even with an EMAIL binding and sender configured.
External fetches in negative/owner practice fixtures are limited to synthetic
JWKS; PB transports are not contacted by those cases.

The existing legacy tests cover production-compatible intake, owner sessions,
postage workflow and shipped email. Existing workerd Content-Type warnings
from fixture response inspection do not cause failed tests.

## Limits and next gate

The local signers/JWKS, owner identities, canonical order IDs, tracking and
email sender are synthetic. The protected real canonical ID is deliberately
not committed. No claim of provider-ledger absence, cross-DO deduplication,
live deploy readiness or instant grant revocation is made. Commerce owns the
atomic disable/completion/ack CAS and compiled cross-repo integration proof.
That integration is pending the other exact candidates.

Required CI, comprehensive Spark/OpenClaw and native ClawSweeper reviews are
pending on the pushed candidate. Source changes after review invalidate prior
head evidence. At most two review repair cycles are authorized. Merge and any
runtime activation remain separate owner gates.

Generated command output is retained locally in
`runs/isolated-test-admission-20261014/` (service-validation.txt,
root-validation.txt and build-output.txt). The durable contract is
[isolated-ship-sandbox-v1](../../docs/contracts/isolated-ship-sandbox-v1.md).
