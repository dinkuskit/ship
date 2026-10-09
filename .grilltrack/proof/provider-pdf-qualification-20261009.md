# Provider PDF qualification — October 9, 2026

Base: `9be08279694a7cdba55bd35b813641eae75aca3f` in `dinkuskit/ship`.
Scope: provider-first qualification, preserving the original expiry and all
unresolved trusted Commerce/host bindings. No live provider or account operation.

## Verified local behavior

- `npm test`: 86 passed, 3 existing opt-in skips, zero failures.
- Node 22.23.3 `scripts/verify-registry-artifact.mjs --bundle-only`: official
  default artifact passed; 18,644-byte backend, 11,190-byte tarball.
- Node 22.23.3 `scripts/verify-ship-journey.mjs --workerd`: passed, including
  actual private HTTP dispatch, stored operation authorization, wrong order,
  missing session/CSRF and lower-role denial, repeated link reads with unchanged
  durable state/provider counters, and expired link omission. This is a packed
  npm/configured fixture with a custom runner; not a Registry installation.
- Node 22.23.3 `scripts/verify-private-assets.mjs --provider-link --serve`:
  official fixture bundle and standard EmDash 1.2.0/workerd runtime passed.
  Fixture artifact SHA-256:
  `5c79b01ba4d78bc31d7cdeeb78b6348d3cbc4df010bd985a80a5ff7d98b5bb44`.
  Actual validated Block Kit output carries the exact inert PB-shaped URL;
  missing session returns 401, missing CSRF returns 403, wrong selector and
  expired record have no link, and repeated reads preserve output.
- CUA observed the Registry-source fixture page in the in-app browser. The link
  rendered with `_blank` and `noopener noreferrer`; after synthetic expiry the
  page showed unavailable/expired and zero label links. Screenshots and sanitized
  run receipts remain under ignored `runs/provider-pdf-qualification-runs/20261009/`.
  The link was not opened and no request reached PB.
- Original request-start expiry is retained across delayed provider completion
  and recovery; no click or recovery begins a new 24-hour window.

The second fixture seeds unsigned Registry post-install state and uses a local
dev-bypass session. Neither that fixture nor the configured workflow proves a
signed Registry installation or ordinary sign-in. Synthetic PDF exact bytes
prove local transport only, not PB delivery or integrity.

## Review and limitations

Parent rejected the first ACP candidate's Node-dependent helper import and
JSON-only qualification. Both were corrected; the helper is sandbox-pure and
both runtime layers were executed. Parent also corrected the runtime evidence
label, added an unavailable UI state, conservative timestamp wording and direct
original-expiry tests. Source and source-intent checks found no remaining local
implementation issue before external review.

No current approved PB test label was available. Actual PB access, anonymous
copied-link behavior, redirect chain, exact PDF integrity and observed provider
expiry remain unqualified. This is not primary-path failure. Hosted fallback is
design only; see the [decision](../../docs/decisions/provider-pdf-qualification.md)
for the smallest future validation and required authority. Production default
bindings remain unavailable. No postage, deployment, publication, secrets,
external account change, external email, physical print or dispatch was performed.

External exact-tuple OpenClaw/native ClawSweeper evidence and CI are tracked in
the PR and ignored review receipts. A clean review is not merge authority.
