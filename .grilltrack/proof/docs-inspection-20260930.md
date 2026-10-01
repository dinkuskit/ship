# Document inspection proof, 2026-09-30 correction pass

Renderer: document hierarchy and surrounding content.
Fidelity: docs-only. No provider account, API execution, postage purchase,
printer client, device, Registry, deploy, or key handling.

## Hierarchy

- README.md links charter, research, contract, brief, citations, ledger
- docs/CHARTER.md supersedes 2026-09-25 wording and links ledger plus the
  three decision documents
- Research, contract, and brief cross-link
- package.json remains private `0.0.0`

## Source-intent checks

- Confirmed Commerce vs Ship ownership and USPS-inside-DinkusKit v1 gate
  appear in charter and README
- U.S. domestic first; international/UPS/FedEx later
- Explicit merchant Buy label; automatic purchase and unattended print are
  later and distinct
- Third-party API acceptable; no vendor selected
- Ship cannot depend on Inventory
- Paid totals immutable and distinct from postage
- `label_created` / `dispatched` / `delivered` separate from print attempts
- Browser print dialog cannot claim physical print
- Pirate Ship marked unavailable from official help
- Territory/APO/HAZMAT exclusions labeled proposed, not locked
- Direct USPS COP Label Provider / platform / TEM facts updated; DinkusKit
  eligibility unknown
- Tracking/APV compared per provider; no shared refund window
- Verified licenses only: Shippo JS MIT, easypost-node MIT; PB API terms
  linked; HTTP usable without copying an SDK
- Public charter no longer recites WooCommerce/Katana/Shiptheory operations
  or Inventory v1 legacy path
- Proposed contract: one U.S. origin, one rectangular parcel, Ground
  Advantage/Priority Mail allowlist, decimal weight, tenant+order
  idempotency, unknown blocks new buy
- Proof plan remains phased recommendation; TEM production-credential caveat
  recorded; no runtime proof
- CLI implement/verify refers to these documents only

## Parent review

Recorded as findings / `required_fix` against
`sha256:41c016b30555b1e15b4522bfa9f8b3a6cb96983e614ab7db2c662f91878158a2`.
All six parent findings accepted. No clean formal review claimed.

## Blocker recorded

`support.easypost.com` and some `support.goshippo.com` pages are unstable
under automated fetch (Cloudflare). Exact EasyPost overage cents and some
adjustment-page details remain unknown.

## Completeness update (added facts)

- Pitney Bowes enrollment and account closure: Individual account enrollment via custom `signupURL` generated in Merchant Portal (`pbshippingmerchant.pitneybowes.com`) with merchant payment methods (U.S. credit card, PB Line of Credit, ACH), Authorize a Merchant API (`POST /v1/developers/{developerId}/merchants/credentials`) to fetch Merchant Shipper ID; Bulk account registers known shippers via Register Known Shipper API (`POST /v2/developers/{developerId}/merchants/registration`) with platform funding/rebills; close-merchant APV holdback recommendation of at least one month (30 days) to cover underpayments.
- Pitney Bowes published retail overages: $0/mo free up to 3,000 labels/mo, then $.05 per label print (>3K), $.02 per tracking only (>3K), $.01 per address validation only (>3K), and $.02 per rate only (>3K); platform setup and monthly minimum fees unknown / contact-only.
- EasyPost pricing: BYOCA published at $20/month plus per-label fee; Forge white-label setup and monthly minimum fees unknown / custom.
- EasyPost shipment adjustments: official support page documents that shipment invoices reflect carrier adjustments to original label costs; automated fetch remained Cloudflare-blocked, preserving unknown live wallet balance effect.
- Shippo pricing: postage billed separately from label fees; Platform Accounts custom; platform setup and monthly minimum fees unknown / not published.
- Label output formats table: Pitney Bowes (PDF, PNG, ZPL2, 24h URL), EasyPost (PNG default, PDF/ZPL/EPL2 conversion), Shippo (PDF, PNG, ZPLII; other thermal formats unknown), USPS (Domestic: PDF, TIFF, SVG, JPG, ZPL203DPI, ZPL300DPI; International: PDF, TIFF); no browser physical print or browser ZPL rendering claims.
