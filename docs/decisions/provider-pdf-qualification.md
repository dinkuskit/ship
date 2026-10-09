# Provider PDF link qualification

Bobby authorized provider-link qualification first on October 9, 2026. This
reopens the earlier exclusion of external label links for this bounded slice;
it does not approve production privacy, launch, provider connection or postage.
The default Registry entry remains unavailable without trusted bindings.

## Provider facts and current gap

PB's [create-label API](https://docs.shippingapi.pitneybowes.com/api/post-shipments-pb-expedited-delivery.html)
documents PDF URLs available for 24 hours after label creation. Its
[retry API](https://docs.shippingapi.pitneybowes.com/api/get-shipments-retry.html)
checks an uncertain original transaction for up to 24 hours after the initial
request; it is not ordinary viewing. The
[reprint API](https://docs.shippingapi.pitneybowes.com/api/get-shipments.html)
is for lost or spoiled data and allows three attempts. Neither API establishes
an expiry-renewal guarantee. These sources were checked October 9.

No current approved test-label receipt is available. September's recorded PB
console test is outside the documented lifetime. Current anonymous/session
access, redirects, response headers, exact bytes, and provider-side expiry are
therefore **unqualified**, not failed. No PB request was made by this slice.

## Implemented boundary

`src/provider-pdf-link.js` creates a Block Kit external link only from a stored
`label_created` operation, with a valid operation ID, credential-free HTTPS URL
on the existing **sandbox** PB label host/path, and a bounded creation time.
No production host is assumed. Missing, invalid, future-dated or expired metadata
produces no link. This is a pure sandbox-compatible helper with no network call.

The workflow now preserves the original operation's `createdAt` and computes
`pdfExpiresAt` on purchase completion and recovery. The timestamp is the
**original local request start**, not an invented provider timestamp; its
24-hour deadline is conservative if PB creates the label later. Recovery,
copying, rendering and clicking never reset it. Legacy records without an
anchor stay unavailable; this slice does not backfill a fresh deadline.

The opt-in `createShipPlugin` trusted link port receives only the label returned
by `workflow.label` after host/user and order authorization. Browser URL, actor,
shop and expiry values are not forwarded as authority. Link rendering does not
purchase, recover, retrieve missing PDF bytes, record printing, or dispatch.
Unavailable links are described honestly. Download and printing use the
provider/browser controls; one-click print remains deferred. The earlier
optional native stored-byte adapter is separate supporting work.

A rendered page cannot disable an already copied PB URL. An external URL may
act as a bearer capability: session/object checks protect **issuance**, not
subsequent copies. Provider access controls and redirects need the real test
below. This code is qualification machinery, not a private-link security claim.

## Evidence layers

- `npm test` checks helper expiry/URL validation and installed factory behavior.
- `npm run verify:provider-pdf-link:runtime` exercises the packed package in the
  configured EmDash/workerd fixture. It uses a custom fixture runner and local
  dev-bypass session, not a Registry install. It checks authorization, canonical
  stored operations, repeated reads with unchanged state/provider counters,
  and expired-link omission. It does not contact PB.
- `npm run verify:provider-pdf-link:registry` uses the official plugin CLI to
  bundle the dedicated private-assets fixture, then the standard workerd runner
  to load seeded **Registry-source post-install state**. It checks production
  helper output through actual Block Kit route validation, missing session/CSRF,
  wrong selectors, repeated output and expiration. The fixture URL is inert;
  neither synthetic output nor its browser rendering proves live PB access.
- Parent CUA inspection of that Registry-source fixture rendered the link with
  `target=_blank` and `rel=noopener noreferrer`; after synthetic expiry, it
  showed the unavailable message and zero label links. The inert URL was never
  opened. This is synthetic browser rendering proof only.
- Signed Registry installation and ordinary sign-in remain unexecuted. Existing
  helpers seed install state; no signed release for this candidate was published.
  EmDash's documented ordinary sign-in requires a passkey or configured provider;
  the local fixture uses dev-bypass instead. No device credential, account or
  external email change is authorized here. See
  [installation](https://docs.emdashcms.com/plugins/installing/) and
  [authentication](https://docs.emdashcms.com/guides/authentication/).

Trusted Commerce shop/user, paid-order destination/revision/consent, durable
storage and provider bindings remain prerequisites. Neither fixture supplies
those bindings to the shipped default Registry entry.

## Smallest future provider check

Obtain one currently valid, explicitly authorized **sandbox** PM/PKG/8x11 test
label through the existing safe human/provider harness, plus its original
creation time. If that requires creating or reprinting a shipment, obtain that
specific sandbox-operation approval first. Do not inspect credentials or paste
the URL into public proof. No production postage is needed.

For that same label, capture sanitized status/MIME/length/SHA-256 and redirect
host results for ordinary browser open, exact download and repeated retrieval;
compare bytes against the original authorized response. Check whether a copied
link works after sign-out and in a separate unauthenticated browser context.
Check the same original URL after its deadline without retry/reprint or renewal.
Retain only non-secret results and hash evidence. This determines whether the
provider path meets the intended access and expiry policy. Missing evidence
alone does not authorize a fallback implementation.

## Hosted backup — design only

Only after actual primary-path failure and a separately scoped handoff, consider
a signed-in `dinkuskit.com` download page. Every request must reauthorize the
organization, store and object. It must use the **same original absolute PB
expiry**, never another 24 hours from copy or click; absent trustworthy original
expiry means unavailable. This is delivery policy, not a guarantee of physical
file deletion, recall of downloaded copies, or revocation of PB's own URL.
No hosted download service, fallback switch, deployment or account change is
implemented here.
