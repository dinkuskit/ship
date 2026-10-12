# Ship sign-in repair — 2026-10-12

## Scope

Base: ebcea265bb1c7338f0cb09085f5d6e49187fca18. Repository: dinkuskit/ship.
The owner requested deployment and authorized repairing the failed signed-in check. The owner separately approved enabling Ship on the playground store. No skill was created.

## Failure and fix

The deployed sign-in callback returned 502. Temporary value-free classification isolated the failure to a redirect-related TypeError in the token fetch, before token parsing or signature checks. Switching token fetch from redirect `error` to `manual` restored sign-in. Non-2xx responses remain refused, and redirects are never followed, preserving code confidentiality.

The fetch stub previously accepted unsupported runtime Request options. Constructing a native Request inside the stub reproduced 28 failing owner tests with the original code. The fix passes all 52 service tests, including a redirect refusal test. Typecheck and dry-run build pass under Node 22.23.3. Temporary diagnostics have been removed.

The deployment config now retains `global_fetch_strictly_public`, needed for same-zone Worker calls to DinkusKit.com. The first attempt with this flag alone did not resolve sign-in; the redirect mode change was also necessary.

## Browser proof

- Signed into the playground store and reached Settings.
- Postage box displayed the sandbox explanation and Create your Pitney Bowes account link.
- Clicking the link opened the PB sandbox Merchant Portal Create Account page with the configured developer ID.
- PB reported the signed-in email already has an account for this developer; no account, payment method, or label was created.
- Existing PB secrets and session secret were retained. PB_ENVIRONMENT remains sandbox.

Sanitized browser screenshots and raw local test output remain in the ignored deployment run directory. No tokens, credentials, cookies, auth logs, or sign-in codes are included in this proof.

## Limits

No live postage, merchant connection, purchase, email send, or refund was tested. Source merge remains a human gate.
