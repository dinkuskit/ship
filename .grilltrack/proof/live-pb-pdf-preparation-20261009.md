# Live PB PDF preparation proof

## Scope

Preparation for one authorized synthetic PB sandbox label. No provider
request, label creation, reprint, credential access, funding, production call,
deployment or publication occurred. The live check remains blocked on the
sanctioned provider capability described in `docs/credentials-setup.md`.

## Implemented

`scripts/lib/provider-pdf-observation.mjs` summarizes a response already
obtained by an approved consumer. It has no fetch or file-writing operation.
It distinguishes PDF, redirect, unavailable and unqualified responses, checks
the PDF signature and MIME, bounds the body, and compares SHA-256 with an
optional original digest. Its output contains no body, URL, headers, address
or credentials. Error responses have no digest or retained byte count.

Original expiry is always creation plus 24 hours. An observation before that
deadline reports `deadline-not-observed`; a PDF still accessible after it
reports `accessible-after-deadline`. Other post-deadline responses are recorded
without assuming their cause. The helper cannot attest where supplied bytes
came from or whether a browser rendered them.

## Executed checks

- Four focused tests passed: exact-byte comparison and mismatch, copied-link
  contexts/original deadline, denied/redirected/malformed response exclusion,
  and invalid or oversized input rejection.
- Full unit suite: 90 passed, 3 existing opt-in integration skips, 0 failures.
- JavaScript syntax and whitespace checks passed.

All test input is synthetic. No live access, redirect chain, PDF integrity,
copied-link policy, Registry browser rendering, or provider-side expiry is
qualified by this preparation.

## Next gate

Provide the existing approved wrapper command and non-secret capability
manifest. The consumer must enforce the sandbox endpoint, no-funding scope,
single-create budget and original-transaction reconciliation. Then perform
the Registry UI and same-label checks in
`docs/decisions/live-pb-pdf-qualification.md`, retaining sensitive artifacts
only within the authorized consumer boundary.
