# DinkusKit Ship service

The hosted Ship service for ship.dinkuskit.com. It runs as a Cloudflare Worker with one SQLite Durable Object per store, like the Payments and Coupons services. GrillTrack decisions: `ship-hosted-service-001` and `ship-order-intake-001` (approved by Ronald; their ledger records land in a follow-up PR).

Status: order intake for Commerce, the owner's label page, and Pitney Bowes sandbox labels (prices, buy, cancel for a refund) are built. Not built yet:

- live Pitney Bowes postage (until the sandbox settings below are set, a real order answers "Pitney Bowes is not connected to Ship yet");
- the shipped email.

Nothing here is deployed.

## What Commerce calls

Every call carries `Authorization: Bearer <pass>`. The pass is a store pass from DinkusKit.com:

- ES256, checked against `ACCOUNT_JWKS_URL`;
- issuer `ACCOUNT_ISSUER`, audience `ACCOUNT_AUDIENCE` (`dinkus-ship`);
- scope `ship:orders`;
- at most an hour old.

The store is the pass's `site_id`, never anything in the request.

| Call | Answer |
| --- | --- |
| `POST /v1/orders` with one `dinkuskit.commerce.ship-order/v1` record | `200 { orderId, version }` once Ship has this version or a newer one. `422` when Ship can never label this version: a country other than US, or a record that doesn't match the schema. |
| `GET /v1/labels` | `200` with labels Commerce has not acknowledged, oldest first, at most 100: `[{ eventId, orderId, version, carrier, tracking }]` |
| `POST /v1/labels/ack` with `{ eventId }` | `200`. A repeat, or an id Ship never issued, is still a success. |
| `GET /` | The service name as plain text |

Other failures:

- `401` for a missing or invalid pass;
- `403` for a pass without `ship:orders` or a usable `site_id`;
- `413` for a body over 256 KiB;
- `503` until the three `ACCOUNT_*` settings are set.

### What Ship keeps from an order

- `orderId`, `number`, `version`, `status` (`processing` or `completed`), `test` and `completed`.
- `shipTo`: name, line1, optional line2, city, optional region, postalCode, and country `US`.
- `email`.
- `storeName`, optional: the store's EmDash Site title (`ctx.site.name`), used as the shipped email's sender name. A missing or unusable one is dropped and never refuses the order.
- `lines`: catalogItemId, name, quantity, optional `weightOz`, and optional `unitPrice` (`{ currency: "USD", minor }`, the whole cents paid per unit before any order-level discount). Commerce starts sending `unitPrice` in the PR after commerce#98.

Ship drops every other field. Billing address, payment details, totals, tax and phone are never kept.

The latest version of each order wins. An older version arriving late is answered `200` and changes nothing.

Ship keeps an address that a label can't use yet, such as one with no state, and the label page will ask the owner to fix it in Commerce. Fixing it sends Ship a new version.

## Run it

Node 22.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test        # Workers runtime tests (vitest with @cloudflare/vitest-plugin)
npm run build   # wrangler deploy --dry-run
```

## The owner's label page

Commerce's "Create shipping label" opens `https://ship.dinkuskit.com/stores/{site_id}/orders/{orderId}`.

- **Sign-in:** Sign in with DinkusKit.com. DinkusKit.com's side is merged in dinkuskit/dinkuskit#31 (`src/account/ship-sign-in.ts`); the shared contract is the project's `ship-hosted/signin-contract.md`. Owners and employees with label permission get in.
  - Ship sends the browser to `ACCOUNT_SIGNIN_URL?site_id&state&code_challenge&code_challenge_method=S256`; DinkusKit.com returns to the fixed `https://ship.dinkuskit.com/auth/callback` with `code` and `state`, or `error` (`access_denied`, `store_unavailable`, `ship_not_enabled`, `invalid_request`).
  - Ship posts `{ code, code_verifier }`, later `{ grant_type: "refresh_token", refresh_token }`, to `ACCOUNT_TOKEN_URL` and gets `{ access_token, token_type, expires_in: 300, refresh_token }`. The access token is an ES256 pass: audience `dinkus-ship`, scope `ship:labels`, `site_id`, `sub`, `uid`, `email`. Every refusal is `400 invalid_grant`; `503` means DinkusKit.com cannot sign right now.
  - Ship stays signed in for as long as the person stays signed in to DinkusKit.com: the browser cookie names a session kept in the store's Durable Object with the rotating refresh token, and Ship checks again at least every 5 minutes. A `4xx`, or a pass that fails its signature or claim checks, signs Ship out. Anything else (a `5xx`, a key set that won't load, a timeout) is treated as DinkusKit.com being down: Ship keeps the session for at most 20 minutes after the last good check and never extends it.
- **Pages:** orders waiting to ship; one order with box, weight (items plus box, editable) and service (USPS Ground Advantage by default, Priority Mail, Priority Mail Express); Buy label, Print (PDF), Cancel label.
- **Real orders** get a USPS label from Pitney Bowes, paid from the store's own PB postage account (decision 2a: DinkusKit holds one PB developer account; each store owner has an Individual Postage Account under it). Sandbox only for now.
  - "See prices" asks PB what each service costs for the chosen box and weight (`POST /shippingservices/v1/rates`). PB service ids: Ground Advantage `UGA`, Priority Mail `PM` (with free Delivery Confirmation so it is tracked), Priority Mail Express `EM`; parcel type `PKG`; letter-size PDF.
  - "Buy label" sends `POST /shippingservices/v1/shipments` with a new `X-PB-TransactionId` and the store's `SHIPPER_ID`. Ship keeps a copy of the PDF, because PB's link lasts about a day, and queues the tracking number for Commerce.
  - PB answering with a refusal (for example, not enough postage) buys nothing; the owner sees PB's reason. If PB's answer is lost, Ship does not know whether it bought a label. The next press of "Buy label" looks the purchase up by its transaction id first (`GET /shippingservices/v1/shipments?originalTransactionId=`). If PB has no record, Ship asks the owner before buying a new one.
  - "Cancel label" voids it with PB (`DELETE /shippingservices/v1/shipments/{id}?cancelInitiator=SHIPPER`). USPS refunds the postage account within about 14 days. Cancelling never changes the Commerce order.
- **TEST orders** get a practice label marked "TEST - NOT POSTAGE" with a TEST tracking number. Pitney Bowes is never called. The label still goes to Commerce through `GET /v1/labels`, so the TEST order shows as shipped.
- **Settings:** ship-from address, the owner's box sizes, and the shipped email's reply-to address (filled with the first signer-in's email). The sender name is the store's EmDash Site title, which Commerce sends as `storeName`.
- Forms are accepted only from Ship's own pages (`Origin` check); pages send a strict Content-Security-Policy.

## Deploy settings (for Ronald's deploy agents, on his go)

- **Vars:**
  - `ACCOUNT_ISSUER=https://dinkuskit.com/account`
  - `ACCOUNT_AUDIENCE=dinkus-ship`
  - `ACCOUNT_JWKS_URL=https://dinkuskit.com/account/.well-known/jwks.json`
  - `ACCOUNT_SIGNIN_URL=https://dinkuskit.com/account/ship-sign-in`
  - `ACCOUNT_TOKEN_URL=https://dinkuskit.com/api/ship-sign-in/token`
- **Secret:** `SHIP_SESSION_SECRET`, 32 or more random characters, set with `wrangler secret put`. The label page answers 503 until it and the two sign-in URLs are set.
- **Route:** `ship.dinkuskit.com`.
- **Pitney Bowes (sandbox):** var `PB_ENVIRONMENT=sandbox`, and secrets `PB_API_KEY`, `PB_API_SECRET` (DinkusKit's PB developer keys) and `PB_SHIPPER_ID` (the sandbox's test merchant), set by Ronald with `wrangler secret put`. They never go in this repository. Until all four are set, real orders cannot get labels and TEST orders still get practice labels. Live postage is not built: it needs Ronald's word, PB's live keys, and a PB sign-up link so each owner can open their own postage account, with that account's shipper id kept per store.
