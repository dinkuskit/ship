# Private asset qualification — 2026-10-08

Scope: supported-interface reproduction and upstream-ready design package, not a
platform feature or Ship label enablement. Production routes remain unchanged.

## Independent verification

- `npm test`: 83 tests, 80 passed, 3 skipped, zero failed.
- `npm run verify:bundle`: official production Ship bundle passed.
- `npm pack --dry-run --ignore-scripts`: 17 files; fixture excluded.
- `node --check` for every `scripts/*.mjs`: passed.
- `npm run verify:private-assets`: official dedicated plugin bundle, seeded
  post-install state, actual EmDash dispatcher and workerd runtime. Exact 610
  bytes received twice, correct PDF/private-no-store/nosniff/sandbox headers,
  no-header cookie GET 403, no-session GET 401, Block Kit link-target cookie GET
  403. This last probe is HTTP, not an observed browser click.
- `pdfinfo` on expected PDF: one 480x200-point page, PDF 1.4, no JavaScript,
  no encryption, 610 bytes.

```json
{
  "pluginId": "r_qe232lamzwtmextd",
  "artifactSha256": "d95f27b487e79cc7f1ce2514c2dda8d22fd95f0178131efa942c6dc1ff2fa2f5",
  "artifactBytes": 1362,
  "exactPdfSha256": "208ad91cba98017461b744194c4f5efa141ea42315cb6c4f59510dcfd4052c24",
  "authenticatedRawTransport": "exact",
  "expectedBytes": 610,
  "receivedBytes": 610,
  "expectedSha256": "208ad91cba98017461b744194c4f5efa141ea42315cb6c4f59510dcfd4052c24",
  "sandboxHttpBody": "exact",
  "repeatedRetrieval": "exact",
  "nodeVersion": "v24.21.0",
  "emdash": "1.2.0",
  "sandboxWorkerd": "0.9.3",
  "workerd": "1.20261001.1",
  "session": "local-dev-bypass",
  "installation": "seeded-post-install-state",
  "missingRequestHeader": "403",
  "missingSession": "401",
  "blockKitLinkNavigation": "403",
  "realSignedRegistryInstall": "not-executed",
  "browserAcceptance": "not-executed"
}
```

The command emits a unique ignored `runs/private-asset-qualification-runs/probe-*`
packet with receipt, expected/received PDF, state and proof. It uses public
`pluginResponse` and official bundling/runtime APIs. No generated internal
module exports or replacement dispatcher are imported. The pinned WASI compiler
packages support disposable local host startup; this does not change EmDash.
Direct host dependency versions are pinned, transitive resolution is not locked.

## Evidence boundaries

The host uses a dev-bypass synthetic session and unsigned seeded post-install
Registry state. Normal sign-in, signed Registry installation, Cloudflare-host
installation, browser viewer/download/Print, permission/object denial matrix,
viewer CSP/lifetime, and real consumer bindings are **not executed**. The fixture
has no provider, order or print-state code; this is not proof that a future Ship
consumer preserves those invariants. No physical printing claim is possible.

## Revalidation and adjudication

Official API routes and Block Kit documentation and public upstream main were
rechecked. Main remains `c16e2a6ad84e42201477954fac0ee283616e4259`.
The cited BlockResponse fields and JSON admin handler still lack a private asset
handoff. PR #3190 remains merged; #3073 closed/unmerged; #1314 closed.
A private/asset issue search returned 31 results, all retrieved; no exact feature
was identified. This is a bounded search, not exhaustive absence proof.

ACP supplied an initial fixture and draft. Parent rejected generated internal
route-wire imports and cancelled that turn; terminal task and worker cleanup
were confirmed before parent edits. An apparent empty response was a fixture
conversion error (`Uint8Array.from(ArrayBuffer)`), corrected to
`new Uint8Array(ArrayBuffer)`. It is **not an upstream transport defect**.
The parent also replaced malformed PDF bytes, removed overwrite/delete-on-rerun,
corrected runtime plugin identity derivation to use the source profile, bounded
HTTP calls and removed browser-success overclaims. Strict exact-byte rerun passed.

## Next gate

EmDash core/admin maintainers must qualify the proposed host-resolved private
route handoff, choose API form and passive viewer isolation/lifetime/filename
policy. The reviewable issue draft is prepared, not posted. Platform implementation
requires that owner decision. A later versioned platform capability must pass
real Registry/browser acceptance before Ship consumer integration; domain
shop/user/paid-order/revision/consent/CAS/provider bindings remain separate.

Required CI, comprehensive exact-revision OpenClaw and native ClawSweeper results
are recorded in PR/ignored review receipts after commit. This document alone is
not review clearance. Merge remains the maintainer's gate.
