# PB sandbox repair review

The prior clean review was invalidated and recorded as `required_fix` in the
ledger. This file now records the repaired candidate for the parent-owned exact
source review; it is not a clean delivery verdict.

- Official public PB docs were checked for OAuth field names, sandbox origin,
  request address/document shapes, shipment options, and DelCon placement.
- Eight deterministic tests pass, including observed PB rate/shipment fixture
  shapes, strict numeric/USD validation, durable thrown-error state, close/new
  store ownership, single-dispatch concurrency, HTTP host/origin/content-type/
  payload/PDF checks, and reload blocking.
- The opt-in `test-support/fixture-server.js` provides the same UI/API routes
  with an injected $8.60 adapter and runtime-generated one-page PDF. The prior
  CUA exposed an invalid placeholder PDF; structural generation is now repaired.
  Parent Chrome visual proof is still pending and is not claimed here.
- No credentials, live API response, account change, production action, or
  fixture happy-flow visual proof is claimed.
- Human gates remain blocked: approved value-free credential wrapper is missing,
  and the native ClawSweeper review gate remains separate and pending.
- Ignored local CUA observation only: `runs/pb-sandbox-interface-runs/20260930/unconfigured.jpg`,
  SHA-256 `42da2f1eb83c1733dcc5c1cba028828f9d4d3b222bbc021da653fcf08efb1e9a`;
  do not publish or commit this media.
- Frozen PR2 remains untouched and requires explicit reconciliation before
  merge or product decisions.
