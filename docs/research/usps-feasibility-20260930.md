# USPS label feasibility, 2026-09-30

Current-primary-doc comparison. No vendor, account, or funding model is
selected. Public claims below are backed by fetched official pages listed in
[CITATIONS.md](../CITATIONS.md). Short paraphrases are preferred.

## Method

Fetched official Stripe, Pitney Bowes, Shippo, EasyPost, USPS, Pirate Ship, and
optional Shiptheory public pages on 2026-09-30. Sanitized URL, date, title,
excerpt, and hash evidence is under ignored `.artifacts/`. No provider account,
API execution, postage buy, or printer-client install.

**Blocker:** `support.easypost.com` and some `support.goshippo.com` articles
returned Cloudflare challenges to automated fetch. Exact EasyPost Wallet
overage cents and some Shippo adjustment-page details remain **unknown**.

## Stripe checkout money is not postage

Stripe shipping rates are the price presented to the shopper and applied to a
purchase ([shipping rates](https://docs.stripe.com/api/shipping_rates)). Hosted
Checkout can collect a shipping address with `allowed_countries`, attach up to
five `shipping_options`, and report `amount_total`, `shipping_cost`, and
`total_details.amount_shipping`
([Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create);
[charge for shipping](https://docs.stripe.com/payments/during-payment/charge-shipping)).
That shopper charge is Commerce money. Actual postage is a later Ship backend
purchase. Paid Checkout totals stay immutable even when postage differs.

## Provider shortlist

| Path | Public API | Embedded purchase | Multi-merchant docs | Test labels | Reprint vs new buy | Unavailable |
| --- | --- | --- | --- | --- | --- | --- |
| Pitney Bowes Shipping APIs | Yes | Yes, behind integrator UI | Individual or Bulk postage accounts | Sandbox prints test labels, no real money | Reprint by `shipmentId`; retry by original transaction id | No |
| Shippo | Yes | Native UI or Shipping Elements | Direct, white-label Platform, gray-label OAuth | `shippo_test_` keys; test calls free | Retrieve existing transaction; refund unused label | No |
| EasyPost | Yes | API; Forge white-label | Forge centralized or decentralized billing | Test labels not valid for shipment | Convert/retrieve label; refund unused | No |
| Direct USPS APIs | Yes | Merchant or platform systems | COP Label Provider authorization; platform enrollment and platform payment documented | TEM host `apis-tem.usps.com` uses production credentials | Formats PDF/TIFF/SVG/JPG/ZPL; recovery details incomplete here | No |
| Pirate Ship | **No** | n/a | Store import integrations only | n/a | n/a | **Official help: no public API** |

Pirate Ship support, dated 13 June 2024: “Pirate Ship doesn't offer an API.”
Mark unavailable. Do not invent an adapter. Direct-USPS commercial eligibility
for DinkusKit remains **unknown**.

## Pitney Bowes (mandatory compare)

Developer Hub signup gives Sandbox. Production upgrade requires a payment
method and a separate merchant set; Sandbox merchants do not carry over
([overview](https://docs.shippingapi.pitneybowes.com/overview.html)). Published
retail plan: $0/month, up to 3,000 labels/month free, then listed overages:
$.05 per label print (>3K), $.02 per tracking only (>3K), $.01 per address
validation only (>3K), and $.02 per rate only (>3K)
([apis.html](https://www.pitneybowes.com/us/apis.html)). That retail/free plan
is **not** documented as platform-resale permission. Enterprise is custom.
Platform setup fees and platform monthly minimums are **unknown** (contact-only).
Merchant subscription fees for own postage accounts are contact-only
([merchant accounts](https://docs.shippingapi.pitneybowes.com/merchant-accounts.html)).

**Individual Postage Account:** merchant-funded postage. Shippers complete
registration through a unique `signupURL` generated via the Merchant Portal
(`pbshippingmerchant.pitneybowes.com`), choosing their own payment method
(U.S. credit card, Pitney Bowes Line of Credit, or ACH / bank account). The
developer/platform retrieves the Merchant Shipper ID via the Authorize a
Merchant API (`POST /v1/developers/{developerId}/merchants/credentials`) using
the merchant's credentials
([merchant accounts](https://docs.shippingapi.pitneybowes.com/merchant-accounts.html);
[faqs-merchants](https://docs.shippingapi.pitneybowes.com/faqs-merchants/overview.html)).

**Bulk Postage Account:** platform pays postage and bills merchants separately;
platform registers known shippers via the Register Known Shipper API
(`POST /v2/developers/{developerId}/merchants/registration`), and Bulk setup
is contact-gated via Client Support
([merchant accounts](https://docs.shippingapi.pitneybowes.com/merchant-accounts.html)).
Auto-refill is default. Negative balance blocks labels. APV adjustments can
debit or credit the postage account up to 30 days after shipment
([APV](https://docs.shippingapi.pitneybowes.com/faqs-shipping/automated-package-verification.html);
[payments](https://docs.shippingapi.pitneybowes.com/faqs-merchants/payments.html)).
If a merchant closes an account, Pitney Bowes recommends that the platform hold
the merchant’s account balance for at least one month (30 days) to cover any
incoming APV underpayments
([APV](https://docs.shippingapi.pitneybowes.com/faqs-shipping/automated-package-verification.html)).
Transaction reports include `APV-POSTAGE OVERPAID` / `UNDERPAID`,
`CREDIT ADJUSTMENT` / `DEBIT ADJUSTMENT`, and `POSTAGE REFUND` request or
resolution
([transaction reports](https://docs.shippingapi.pitneybowes.com/api/get-transactions-reports.html)).

`X-PB-TransactionId` must be unique
([1130002](https://docs.shippingapi.pitneybowes.com/error-solutions/1130002.html)).
Uncertain create: retry by original transaction id for 24 hours. Existing
label: reprint by `shipmentId`, three attempts, lost/spoiled only
([retry](https://docs.shippingapi.pitneybowes.com/api/get-shipments-retry.html);
[reprint](https://docs.shippingapi.pitneybowes.com/api/get-shipments.html)).
USPS void: unused prepaid label within 30 days; USPS may take 14 days;
First-Class Mail letters and flats are not refundable
([void](https://docs.shippingapi.pitneybowes.com/api/delete-shipment.html)).
HTTP is usable without copying an SDK. Official API terms dated 26 June 2026
are a service agreement, not an OSS license
([API license](https://www.pitneybowes.com/us/sendtech-terms/api-license.html)).

## Shippo

Direct API is one account. Platforms choose white-label Platform Accounts
(platform bills merchants) or gray-label OAuth (merchant-owned Shippo billing).
USPS, UPS, and Canada Post “require e-commerce marketplaces to use Managed
Shippo accounts.” Platform upgrade is a contact step
([integration paths](https://docs.goshippo.com/guides/integration-paths);
[platform accounts](https://docs.goshippo.com/platform-accounts/platform-accounts)).
Whether DinkusKit is a “marketplace” under that rule is unresolved. A
free/starter plan is not that permission.

Published API starter: 30 labels/month free, then 7¢/label
([pricing](https://goshippo.com/pricing/api)). Postage is billed separately
from label fees. Test tokens make calls free
([quickstart](https://docs.goshippo.com/guides/api-quickstart)). Platform
pricing for Platform Accounts (white-label/managed) is custom / contact-based;
platform setup fees and platform monthly minimums are **unknown** (not published).
Refund unused labels within 90 days (USPS use-by 30 days)
([refunds](https://docs.goshippo.com/billing-and-invoices/refunding-labels)).
If a webhook exists, labels purchased through Shippo send tracking events;
`track_updated`, `transaction_created`, and `transaction_updated` are
documented
([tracking](https://docs.goshippo.com/tracking/tracking);
[webhooks](https://docs.goshippo.com/tracking/webhooks)). Official carrier-
adjustment support pages exist; live fetch was Cloudflare-blocked, so invoice
timing and webhook coverage for those adjustments are **unknown**. JavaScript
SDK is MIT; that license is not a service contract
([shippo-javascript-sdk](https://github.com/goshippo/shippo-javascript-sdk)).
Idempotent-purchase header behavior is **unknown**; retrieve-existing-
transaction is the documented reprint path.

## EasyPost

Forge is the documented white-label path. Centralized: platform wallet pays
child-user postage. Decentralized: referral customers fund their own wallets
([Forge](https://www.easypost.com/products/forge/);
[centralized](https://docs.easypost.com/guides/get-started-with-forge/self-managed-billing-guide);
[decentralized](https://docs.easypost.com/guides/get-started-with-forge/easypost-managed-billing-guide)).
Fetched pricing: Free Access up to 3,000 labels, postage not included; Bring
Your Own Carrier Accounts (BYOCA) is $20/month plus per-label fee; Forge
is contact/custom ([pricing](https://www.easypost.com/pricing/)). Platform setup
fees and platform monthly minimum fees for Forge are **unknown**. Exact
overage cents: **unknown**. Legal API grant is limited, non-sublicensable
([legal](https://legal.easypost.com/)). Test labels are not shippable
([test environment](https://support.easypost.com/hc/en-us/articles/360044353331-Test-Environment)).
USPS refunds: request within 30 days, processing at least 15 days
([shipping refund](https://docs.easypost.com/docs/shipments/shipping-refund)).
A `Tracker` is created automatically when a `Shipment` is purchased; updates
arrive as webhook `Event`s (`tracker.created` / `tracker.updated`)
([trackers](https://docs.easypost.com/docs/trackers);
[events](https://docs.easypost.com/docs/events)). `shipment.invoice.created` /
`shipment.invoice.updated` Events and a `shipment_invoice` Report type are
documented ([reports](https://docs.easypost.com/docs/reports)). The official
support page on shipment invoices
([adjustments](https://support.easypost.com/hc/en-us/articles/360044651451-Shipment-Invoices-Adjustments-to-your-original-label-costs))
describes adjustments to original label costs; automated curl fetches remain
Cloudflare-blocked, so whether those invoices automatically change the live
wallet balance is preserved as **unknown** from a script-based fetch.
easypost-node is MIT; that license is not a service contract
([LICENSE](https://github.com/EasyPost/easypost-node/blob/master/LICENSE)).

## Direct USPS benchmark

Current Labels APIs replace retired Web Tools
([API catalog](https://developers.usps.com/apis)). Official 15 September 2026
PostalPro guide: the merchant gets CRID, MID, and EPA in the Customer
Onboarding Portal, then authorizes a Label Provider to use the merchant
account, including NSA rates
([merchant onboarding](https://postalpro.usps.com/merchant-onboarding-guide)).
The April 2025 platform tech sheet documents platform COP enrollment, merchant
authorization, merchant-EPA payment, and platform payment, plus rate-holder
roles for platform or merchant NSA rates
([platform tech sheet](https://developers.usps.com/sites/default/files/2025-04/USPS%20API%20Platform%20Integration_Tech%20Sheet.pdf)).
Getting started: Labels APIs need additional approval and configuration, USPS
Ship enrollment for outbound and return labels, and an EPA. TEM
(`apis-tem.usps.com`) uses production credentials
([getting started](https://developers.usps.com/getting-started);
[api-examples](https://github.com/USPS/api-examples)).

Do not claim there are no multi-merchant docs. Whether DinkusKit is
commercially eligible as a Label Provider or platform remains **unknown**.
Published API label fees and exact uncertain-purchase recovery are **unknown**.
Treat as merchant-owned or platform-authorization benchmark, not a silent v1
default. HTTP is usable without copying an SDK.

## Tracking and postage adjustments

No shared refund or APV window exists across providers. Each row is
provider-specific.

| Path | Tracking | Adjustments | Refund timing (not shared) |
| --- | --- | --- | --- |
| Pitney Bowes | Transaction reports can return tracking status; first 30 days after ship date | Reports include APV over/under, dispute, and manual debit/credit | Unused USPS prepaid void within 30 days; USPS may take 14 days; report shows request then ACCEPTED/DENIED |
| Shippo | Auto track events for labels purchased through Shippo if a webhook exists; `track_updated` | Official carrier-adjustment support pages exist; live details **unknown** | Unused refund request within 90 days; USPS use-by 30 days; PENDING can wait on tracking |
| EasyPost | Automatic `Tracker` at shipment purchase; `tracker.*` Events | `shipment.invoice.*` Events and `shipment_invoice` reports; balance effect **unknown** from live fetch | USPS request within 30 days; processing at least 15 days; `refund.successful` Event |
| Direct USPS | Tracking APIs are in the default product; Labels need extra approval | Platform sheet: assessments disputed in Business Customer Gateway; merchant transaction report | Unused-label refund timing **unknown** from fetched pages |

## OSS SDK and HTTP

| Artifact | Verified license | Notes |
| --- | --- | --- |
| Shippo JavaScript SDK | MIT | License ≠ Shippo service or platform contract |
| easypost-node | MIT | License ≠ EasyPost legal API grant |
| Pitney Bowes HTTP | No SDK copy required | Official API license (26 June 2026) is a commercial agreement |
| USPS HTTP | No SDK copy required | Public examples; no SDK selected |

Worker runtime compatibility with EmDash/Workers remains to prove. Do not
select dependencies in this cycle.

## Print inside the product

v1 requires the merchant to print after an explicit Buy label. Smallest
documented path: provider returns PDF (or PNG), DinkusKit shows it, browser
print dialog. A browser print dialog is not proof of physical print. ZPL is
optional for a later authenticated local client. A local client is research,
not a new v1 gate.

### Provider label output formats

| Provider | Documented output formats | Delivery and conversion details | Official source |
| --- | --- | --- | --- |
| Pitney Bowes | PDF, PNG, ZPL2 | URL (available for 24 hours after creation) or Base64; 203 DPI and 300 DPI resolution options | [PB considerations](https://docs.shippingapi.pitneybowes.com/carriers/pitney-bowes.html) |
| EasyPost | PNG, PDF, ZPL, EPL2 | Default label output is PNG (via `label_url`); conversion endpoint (`GET /v2/shipments/{id}/label?file_format={format}`) converts 4x6 PNG to PDF, ZPL, or EPL2 | [EasyPost shipments](https://docs.easypost.com/docs/shipments) |
| Shippo | PDF, PNG, ZPLII | Returned via `label_url`; supports `PDF_4x6`, `PDF_4x8`, `PDF_A4`, `PDF_A5`, `PDF_A6`, `PDF_2.3x7.5`, `PNG`, `PNG_2.3x7.5`, `ZPLII`; other thermal formats (e.g. EPL) **unknown** / not documented | [Shippo SDK enum](https://github.com/goshippo/shippo-javascript-sdk) |
| Direct USPS | PDF, TIFF, SVG, JPG, ZPL203DPI, ZPL300DPI | Domestic Labels 3.0 supports PDF, TIFF, SVG, JPG, ZPL203DPI, and ZPL300DPI; International Labels 3.0 supports PDF and TIFF | [USPS APIs catalog](https://developers.usps.com/apis) |

Browser print dialogs natively render PDF or PNG for standard desktop and office printers. Raw thermal formats (ZPL/EPL) cannot be rendered or sent directly by standard browser printing without specialized local client software. Invoking the browser print dialog does not confirm physical print success.

**Optional public reference examples** (not a DinkusKit commitment):
Shiptheory documents packing-status triggers, automatic shipping rules, a
background print client, and distinct manual print
([Katana example](https://support.shiptheory.com/support/solutions/articles/24000075062-how-to-print-shipping-labels-from-katana);
[automatic printing](https://support.shiptheory.com/support/solutions/articles/6000116912-automatic-printing);
[manual printing](https://support.shiptheory.com/support/solutions/articles/24000097843-manual-printing-in-shiptheory)).
Those pages do not prove a specific store’s webhook or postage backend. No
client was installed and no device was touched.

Offline client, queued jobs, and reconnects must not buy a second label.
Reprint uses the durable label identity. Duplicate packed events are later
automation; v1 still needs idempotent purchase identity because a double-click
or unknown response can happen now.

## Official USPS limits (recommended v1)

Domestic parcels: max 70 lb. Ground Advantage max length+girth 130 in (108–130
oversized). Other domestic parcels often max 108 in
([Ground Advantage](https://www.usps.com/ship/ground-advantage.htm);
[parcel standards](https://faq.usps.com/articles/Knowledge/Parcel-Size-Weight-Fee-Standards)).
DIM uses volume over 1 cu ft; current Ground Advantage page divides by 139.
Nonstandard length/volume/characteristic fees apply. HAZMAT is a distinct
compliance domain.

Approved human scope remains U.S. domestic USPS first. The following are
**proposed implementation restrictions, not selected:** exclude territories,
APO/FPO/DPO, customs, and HAZMAT from first kernel. Ground Advantage
officially serves states, military bases, territories, and Freely Associated
States; APO still needs a customs form. Do not treat those exclusions as
already locked.

## Credential handling (design only)

Non-secret public record may store account identifiers, environment, and
label/tracking/refund ids. Server secret binding and token lifecycle stay off
the merchant browser and off this repository. OAuth or similar flows still
require storing or accessing server secrets; this cycle does not claim
otherwise. No `.env`, account, or key is created now. Proof work must not
call production postage endpoints or spend real money. USPS TEM still uses
production credentials per official getting-started text, so “no production
keys” is not a possible TEM rule.
