# Vendor, account, and funding decision brief

Dated 2026-09-30. **A recommendation is not a selection.** No label kernel
until vendor, account, and funding are decided. Sources:
[research](../research/usps-feasibility-20260930.md),
[CITATIONS.md](../CITATIONS.md).

## Recommendation (investigate first)

**Investigate Shippo Platform eligibility first**, with **gray-label OAuth
(merchant-owned Shippo billing)** preferred if Shippo will grant it, and
**white-label Platform Accounts** only if marketplace rules require managed
accounts.

Why this is the first ask, not a lock:

- Official docs separate single-account Direct API from platform white-label
  and merchant-owned OAuth.
- Embedded purchase inside a product is documented (native UI or Shipping
  Elements).
- Test tokens exist; test calls are free; no live postage is required to start
  docs-only follow-up.
- Retrieve-existing-transaction and unused-label refund are documented.
- Published starter fees exist (30 free labels/month, then 7¢), with postage
  still owed to whoever funds the carrier account.

This does **not** create a Shippo account or contact vendor staff.

## Fallback if Shippo eligibility rejects

1. **EasyPost Forge, decentralized / EasyPost-managed billing** so each
   merchant wallet pays postage. Avoid centralized Forge unless the product
   owner later accepts platform working capital.
2. **Pitney Bowes Individual Postage Accounts** so each merchant funds postage
   through Merchant Portal. Strongest fetched uncertain-purchase recovery
   (retry by transaction id, reprint by shipment id). Bulk Postage Account is
   the platform-funds/rebill model and should stay a last resort because of
   APV holdback and refill exposure.
3. **Direct USPS APIs** as merchant-owned or Label-Provider benchmark if every
   aggregator rejects platform or plugin use. Official COP and platform docs
   describe merchant CRID/MID/EPA, Label Provider authorization (including NSA
   rates), platform enrollment, and platform payment. Labels need extra
   approval, USPS Ship outbound/returns, and EPA. TEM uses production
   credentials. DinkusKit commercial eligibility remains **unknown**.

**Pirate Ship is unavailable.** Official help states there is no public API.

## Who bears cost if a path is later selected

| Cost | Merchant-owned funding (OAuth / Individual PB / decentralized Forge / direct USPS merchant EPA) | Platform-owned funding (Shippo white-label / Forge centralized / PB Bulk / USPS platform payer) |
| --- | --- | --- |
| Postage at buy | Merchant | Platform, then rebill |
| Provider label/API fees | Merchant or platform per contract (**often unknown**) | Platform, then rebill |
| Refund of unused postage | Credits the funding account; timing is provider-specific | Same, on the platform wallet |
| APV / weight-dimension adjustments | Merchant postage account when documented | Platform wallet; must rebill or hold merchant balance |
| Working capital | Merchant | Platform |

Paid Commerce totals never absorb these amounts.

## Exact unresolved commercial questions

1. Is optional Registry-installed Ship a “marketplace” that USPS rules force
   onto managed per-merchant accounts (Shippo’s published claim)?
2. Will Shippo grant Platform and/or OAuth credentials to this product? Days
   and conditions are unpublished.
3. Will EasyPost grant Forge, and at what custom price? Wallet overage cents
   were not fetchable (Zendesk Cloudflare 403).
4. Will Pitney Bowes treat DinkusKit as a third-party integrator whose
   *client* must own the developer account? Production upgrade, Bulk setup,
   and merchant subscription fees are contact-gated. No contact is authorized
   now.
5. Direct USPS: will USPS treat DinkusKit as an eligible Label Provider or
   platform? Official COP and platform docs exist; commercial eligibility,
   NSA/contract rates for this product, and label-API approval conditions
   remain unpublished for DinkusKit.
6. Who pays provider per-label fees after free tiers, and are those tiers
   per merchant or per platform?
7. Refund timing, APV/adjustment timing, and merchant-payout timing are
   **separate**. There is no shared window across providers. PB documents
   unused-void within 30 days and USPS review that may take 14 days, plus APV
   up to 30 days. Shippo unused-refund request is 90 days (USPS use-by 30).
   EasyPost USPS refund request is 30 days with processing at least 15 days.
   Net working-capital amount is unknown.
8. Credential custody: non-secret public identifiers versus server secret
   binding and token lifecycle. OAuth still needs server secrets.

Retail or free developer plans (PB $0/3,000; Shippo 30 free; EasyPost 3,000
Free Access) are **not** platform resale permission. Verified OSS licenses
(Shippo JS MIT; easypost-node MIT) are **not** service contracts. PB and USPS
HTTP can be used without copying an SDK; PB API terms are a commercial
agreement. Worker runtime compatibility with EmDash/Workers remains to prove.
No dependency is selected.

## Phased proof plan

No live proof is claimed. This remains a recommendation and a phased plan.

1. **Offline docs and schema (this cycle).** Charter, research, contract,
   brief, and ledger validate. JSON manifests parse. Independent source
   review of the documents. CI later, if added, checks docs/schema only.
2. **Provider sandbox only after separate credential and account
   authorization.** No production postage endpoints and no real money.
   USPS TEM shares production credentials per official getting-started text,
   so a later TEM lane cannot use a blanket “no production keys” rule; it
   still must not buy postage or hit production postage endpoints. No keys
   are touched now. Record unknown-response and double-click recovery against
   that provider’s retry/retrieve rules. Record expired-quote rejection.
   Disclose sandbox fidelity limits.
3. **Installed DinkusKit/EmDash UI, still non-live unless separately
   authorized.** Prove attended purchase and same-label reprint, tenant
   isolation, unknown response, double-click, expired quote, immutable paid
   totals, and distinct `label_created` / print-attempt / `dispatched` /
   `delivered` mapping. Browser-visible evidence is required. Optional fixture
   scope: one proposed U.S. origin, one rectangular parcel, Ground Advantage
   or Priority Mail. A browser print dialog is not physical-print proof.
4. **Bounded live buy/void/print only after its own human spend and device
   approval.** One attended Buy label, one void or refund, one reprint of the
   same label with no second purchase, one real-format print inside
   DinkusKit. Not authorized now.
5. **Independent review.** Bind review to an immutable source identity after
   a later authorized commit. This cycle records inspection proof only. Do
   not claim clean formal review.

GrillTrack implement/verify for this track refers to these documents, not
working labels.
