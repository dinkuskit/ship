# Live sandbox PDF qualification

## Current boundary

The local Registry/passkey proof is merged. Live provider PDF access is still
unqualified. The next bounded check is one newly created sandbox USPS PM/PKG
label in PDF/8x11 format, using synthetic shipment details and no real postage
or funding. It must use an approved provider capability; the repository does
not supply that capability or resolve credentials.

The credential setup document currently records the approved wrapper as
missing. No provider call may proceed by reading credentials directly,
guessing an account or selector, or adding an alternative authentication path.
The missing prerequisite is access routing, not permission for another label.

## Required capability

Before creating the test label, the operator must have an existing sanctioned
wrapper and its non-secret capability manifest. The manifest must identify the
fixed consumer, sandbox-only endpoint, approved authentication mode, exact
registered selectors, and sanitized output contract. Resolved credentials stay
inside that consumer. Creating a new account, changing permissions or setting
up a new credential service is a separate owner action.

The consumer must enforce a single-create budget, persist the original
transaction identity before calling the provider, and reconcile an ambiguous
outcome using that identity. A timeout must never cause a new transaction or a
blind second create. No funding or production endpoint is permitted.

## Evidence to collect

Use the same test label throughout:

1. Record its original creation time and absolute expiry privately. Keep the
   provider URL, raw provider response, shipment details and PDF out of public
   artifacts and tool output.
2. Use the installed Registry UI and normal sign-in flow to open the actual
   provider PDF. Record the actual network result and verify PDF bytes rather
   than treating an inert link as success.
3. Compare the downloaded bytes with the original authorized response using
   length and SHA-256. Repeat retrieval without creating or reprinting a label.
4. Observe redirects without silently following a new origin. Record only
   sanitized host classifications, status and the decision to stop or follow
   under the approved capability's network policy.
5. Try the same synthetic copied link after sign-out and from a separate
   unauthenticated browser context. Report whether the provider permits access;
   successful authenticated issuance does not establish later access control.
6. Revisit the same original URL after its real deadline, without renewal or
   reprint. Before that time, report expiry as pending. Clock-based unit tests
   establish local link omission only, not observed provider expiry.

`scripts/lib/provider-pdf-observation.mjs` is reusable response summarization
support for the future approved consumer. It performs no network request and
receives no credentials or URL. It records a bounded PDF's size and digest,
comparison with an optional original digest, response classification and the
relationship between observation time and original expiry. Error-page bytes
are neither returned nor hashed. A summary alone proves neither the origin of
the bytes nor a successful browser render; the consumer must provide that
provenance and visible evidence independently.

## Completion and limits

Live qualification remains blocked until the sanctioned capability is
available. Preparing or testing the summarizer does not qualify a provider
label. A copied link that remains accessible after logout or expiry is a real
result to report, not a reason to renew the label or relabel the test a pass.
The signed-in hosted backup remains design only, tied to the same original
absolute expiry. No fallback, deployment or publication is introduced here.
